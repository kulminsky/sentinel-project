import type { SentinelConfig } from "../../config/schema.js";
import type { Check, CheckExecution, ScanContext } from "../../core/check.js";
import {
  createCheckResult,
  type CheckResult,
  type Severity,
} from "../../core/result.js";
import {
  isJsonMediaType,
  loadOpenApiContract,
  matchOpenApiMediaType,
  matchOpenApiOperation,
  matchOpenApiResponse,
  normalizeMediaType,
  validateOpenApiShape,
  type OpenApiContract,
  type OpenApiLoadResult,
  type OpenApiResponseContract,
  type OpenApiShape,
} from "./openapi.js";

const MAX_RUNTIME_ENDPOINTS = 12;
const MAX_RESPONSE_BYTES = 256 * 1024;
const INTERNAL_RUNTIME_DEADLINE_MS = 55_000;

const RUNTIME_CHECK = {
  id: "api.runtime-contract",
  title: "Live API contract and latency",
  phase: "runtime",
} as const;

const STATIC_CHECK = {
  id: "api.openapi-fallback",
  title: "Static OpenAPI fallback",
  phase: "static",
} as const;

type ApiConfig = NonNullable<SentinelConfig["api"]>;
type ApiEndpoint = ApiConfig["endpoints"][number];

interface ApiResultInput {
  readonly status: "Pass" | "Warn" | "Fail" | "Skipped";
  readonly severity: Severity;
  readonly finding: string;
  readonly recommendation: string;
  readonly subject?: string;
  readonly evidence?: string[];
  readonly durationMs?: number;
  readonly diagnosticCode?: string;
}

type EndpointObservation =
  | {
      readonly state: "response";
      readonly status: number;
      readonly headers: Headers;
      readonly body:
        | {
            readonly state: "ok";
            readonly text: string;
          }
        | {
            readonly state: "too-large";
          }
        | {
            readonly state: "invalid-encoding";
          };
      readonly latencyMs: number;
    }
  | {
      readonly state: "timeout" | "transport";
    };

interface ContractIssue {
  readonly severity: "High" | "Medium";
  readonly category: string;
  readonly failure: boolean;
}

class ApiRequestTimeoutError extends Error {}
class InvalidResponseEncodingError extends Error {}

function createApiResult(
  metadata: typeof RUNTIME_CHECK | typeof STATIC_CHECK,
  input: ApiResultInput,
): CheckResult {
  return createCheckResult({
    checkId: metadata.id,
    title: metadata.title,
    level: "API / Backend",
    phase: metadata.phase,
    ...input,
  });
}

function execution(
  results: readonly CheckResult[],
  incomplete = false,
): CheckExecution {
  return {
    results,
    incomplete,
  };
}

function endpointSubject(endpoint: ApiEndpoint, baseUrl: string): string {
  const pathname = new URL(endpoint.path, baseUrl).pathname;
  const safePathname = [...pathname]
    .map((character) =>
      ["(", ")", "[", "]", "<", ">", "`"].includes(character)
        ? `%${character.charCodeAt(0).toString(16).toUpperCase()}`
        : character,
    )
    .join("");

  return `${endpoint.method} ${safePathname}`;
}

function containsUnsafeHeaderCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

function authenticationHeaders(
  context: ScanContext,
  endpoint: ApiEndpoint,
): Headers | undefined {
  if (!endpoint.useAuthentication) {
    return new Headers();
  }

  const authentication = context.config.api?.authentication;
  if (authentication === undefined) {
    return undefined;
  }

  const headers = new Headers();

  try {
    for (const [name, reference] of Object.entries(authentication.headers)) {
      const value = context.resolveEnvironmentReference(reference.env);
      if (
        value === undefined ||
        value.trim().length === 0 ||
        containsUnsafeHeaderCharacter(value)
      ) {
        return undefined;
      }

      headers.set(name, value);
    }
  } catch {
    return undefined;
  }

  return headers;
}

async function readBoundedResponseBody(response: Response): Promise<
  | {
      readonly state: "ok";
      readonly text: string;
    }
  | {
      readonly state: "too-large";
    }
  | {
      readonly state: "invalid-encoding";
    }
> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > MAX_RESPONSE_BYTES
  ) {
    try {
      await response.body?.cancel();
    } catch {
      // A bounded result does not depend on body cleanup succeeding.
    }

    return {
      state: "too-large",
    };
  }

  if (response.body === null) {
    return {
      state: "ok",
      text: "",
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", {
    fatal: true,
  });
  const parts: string[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        try {
          parts.push(decoder.decode());
        } catch {
          throw new InvalidResponseEncodingError();
        }
        return {
          state: "ok",
          text: parts.join(""),
        };
      }

      totalBytes += next.value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return {
          state: "too-large",
        };
      }

      try {
        parts.push(decoder.decode(next.value, { stream: true }));
      } catch {
        throw new InvalidResponseEncodingError();
      }
    }
  } catch (error: unknown) {
    try {
      await reader.cancel();
    } catch {
      // Request failure classification must remain sanitized.
    }

    if (error instanceof InvalidResponseEncodingError) {
      return {
        state: "invalid-encoding",
      };
    }

    throw new Error("Response body could not be read.");
  } finally {
    reader.releaseLock();
  }
}

function isHttpStatus(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
  );
}

async function observeEndpoint(
  context: ScanContext,
  endpoint: ApiEndpoint,
  headers: Headers,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<EndpointObservation> {
  const startedAt = performance.now();
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  signal.addEventListener("abort", abortFromParent, { once: true });
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new ApiRequestTimeoutError());
    }, timeoutMs);
  });
  const requestPromise = Promise.resolve().then(async () => {
    if (signal.aborted || controller.signal.aborted) {
      throw new ApiRequestTimeoutError();
    }

    const api = context.config.api!;
    const response = await context.fetch(new URL(endpoint.path, api.baseUrl), {
      method: endpoint.method,
      headers,
      redirect: "manual",
      signal: controller.signal,
    });
    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));

    if (!isHttpStatus(response.status)) {
      throw new Error("Malformed response status.");
    }

    const body =
      endpoint.method === "HEAD"
        ? await (async () => {
            try {
              await response.body?.cancel();
            } catch {
              // Status and latency remain observable after cleanup failure.
            }
            return {
              state: "ok" as const,
              text: "",
            };
          })()
        : await readBoundedResponseBody(response);

    return {
      state: "response" as const,
      status: response.status,
      headers: response.headers,
      body,
      latencyMs,
    };
  });

  try {
    return await Promise.race([requestPromise, timeoutPromise]);
  } catch (error: unknown) {
    return {
      state:
        error instanceof ApiRequestTimeoutError || controller.signal.aborted
          ? "timeout"
          : "transport",
    };
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    signal.removeEventListener("abort", abortFromParent);
  }
}

function loadResultDescription(result: OpenApiLoadResult): {
  readonly finding: string;
  readonly recommendation: string;
  readonly diagnosticCode: string;
  readonly incomplete: boolean;
} {
  switch (result.state) {
    case "invalid":
      return {
        finding:
          "The configured OpenAPI document could not be interpreted as a valid shallow contract.",
        recommendation:
          "Correct the OpenAPI JSON or YAML structure, then retry Sentinel.",
        diagnosticCode: "OPENAPI_INVALID",
        incomplete: false,
      };
    case "inventory-incomplete":
      return {
        finding:
          "The bounded repository inventory could not confirm whether the configured OpenAPI document is present.",
        recommendation:
          "Reduce the target inventory size or place the contract within the inspected boundary, then retry Sentinel.",
        diagnosticCode: "OPENAPI_INVENTORY_INCOMPLETE",
        incomplete: true,
      };
    case "missing":
      return {
        finding:
          "The configured OpenAPI document is not present in the target.",
        recommendation:
          "Add the configured OpenAPI document or correct api.openApiPath.",
        diagnosticCode: "OPENAPI_MISSING",
        incomplete: false,
      };
    case "too-large":
      return {
        finding:
          "The configured OpenAPI document exceeded Sentinel's bounded inspection limit.",
        recommendation:
          "Provide a contract within the documented size limit and retry Sentinel.",
        diagnosticCode: "OPENAPI_TOO_LARGE",
        incomplete: true,
      };
    case "unreadable":
      return {
        finding:
          "The configured OpenAPI document could not be read through the repository safety boundary.",
        recommendation:
          "Restore a readable, non-symlinked contract inside the target and retry Sentinel.",
        diagnosticCode: "OPENAPI_UNREADABLE",
        incomplete: true,
      };
    case "unsupported-version":
      return {
        finding:
          "The configured API contract is not a supported OpenAPI 3.0 or 3.1 document.",
        recommendation: "Provide an OpenAPI 3.0 or 3.1 JSON or YAML contract.",
        diagnosticCode: "OPENAPI_VERSION_UNSUPPORTED",
        incomplete: false,
      };
    case "available":
      throw new Error(
        "Available OpenAPI documents need no failure description.",
      );
  }
}

function higherSeverity(
  current: "High" | "Medium",
  candidate: "High" | "Medium",
): "High" | "Medium" {
  return current === "High" || candidate === "High" ? "High" : "Medium";
}

function responseHasBody(
  body: Extract<EndpointObservation, { state: "response" }>["body"],
): boolean {
  return body.state !== "ok" || body.text.length > 0;
}

function collectRuntimeContractIssues(
  endpoint: ApiEndpoint,
  observation: Extract<EndpointObservation, { state: "response" }>,
  contract: OpenApiContract | undefined,
  baseUrl: string,
): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const pathname = new URL(endpoint.path, baseUrl).pathname;
  const contentType = observation.headers.get("content-type");
  let openApiResponse: OpenApiResponseContract | undefined;
  let shape: OpenApiShape | undefined;

  if (observation.status !== endpoint.expectedStatus) {
    issues.push({
      severity: "High",
      category: "the status did not match the configured expectation",
      failure: true,
    });
  }

  if (contract === undefined) {
    issues.push({
      severity: "Medium",
      category: "the OpenAPI contract was unavailable",
      failure: false,
    });
  } else {
    const operation = matchOpenApiOperation(
      contract,
      endpoint.method,
      pathname,
    );

    if (operation.state !== "found") {
      issues.push({
        severity: "High",
        category:
          operation.state === "ambiguous"
            ? "the endpoint matched multiple OpenAPI operations"
            : "the endpoint was absent from the OpenAPI contract",
        failure: true,
      });
    } else {
      openApiResponse = matchOpenApiResponse(
        operation.operation,
        observation.status,
      );
      if (openApiResponse === undefined) {
        issues.push({
          severity: "High",
          category: "the observed status was not documented by OpenAPI",
          failure: true,
        });
      } else if (openApiResponse.unsupported) {
        issues.push({
          severity: "Medium",
          category: "the OpenAPI response used unsupported constructs",
          failure: false,
        });
      } else if (openApiResponse.mediaTypes.size > 0) {
        const mediaMatch =
          contentType === null
            ? undefined
            : matchOpenApiMediaType(openApiResponse, contentType);
        if (mediaMatch === undefined) {
          issues.push({
            severity: "Medium",
            category: "the response content type did not match OpenAPI",
            failure: true,
          });
        } else {
          shape = mediaMatch.shape;
          if (shape?.state === "absent") {
            issues.push({
              severity: "Medium",
              category: "the OpenAPI response media type had no schema",
              failure: false,
            });
          } else if (shape?.state === "unsupported") {
            issues.push({
              severity: "Medium",
              category:
                "the OpenAPI response schema used unsupported constructs",
              failure: false,
            });
          } else if (contentType !== null && !isJsonMediaType(contentType)) {
            issues.push({
              severity: "Medium",
              category:
                "the matched non-JSON response schema is outside Sentinel's shallow shape validation",
              failure: false,
            });
          }
        }
      } else if (contentType !== null || responseHasBody(observation.body)) {
        issues.push({
          severity: "Medium",
          category: "the response returned content not documented by OpenAPI",
          failure: true,
        });
      }
    }
  }

  if (
    endpoint.expectedContentType !== undefined &&
    (contentType === null ||
      normalizeMediaType(contentType) !==
        normalizeMediaType(endpoint.expectedContentType))
  ) {
    issues.push({
      severity: "Medium",
      category: "the content type did not match the configured expectation",
      failure: true,
    });
  }

  if (endpoint.method === "HEAD") {
    if (
      endpoint.requiredJsonFields !== undefined &&
      endpoint.requiredJsonFields.length > 0
    ) {
      issues.push({
        severity: "Medium",
        category: "body-field expectations cannot be checked for HEAD",
        failure: false,
      });
    }
    return issues;
  }

  const expectsJson =
    (endpoint.requiredJsonFields?.length ?? 0) > 0 ||
    (endpoint.expectedContentType !== undefined &&
      isJsonMediaType(endpoint.expectedContentType)) ||
    (contentType !== null &&
      isJsonMediaType(contentType) &&
      shape !== undefined);

  if (!expectsJson) {
    return issues;
  }

  if (observation.body.state === "too-large") {
    issues.push({
      severity: "Medium",
      category: "the response body exceeded the analysis limit",
      failure: false,
    });
    return issues;
  }

  if (observation.body.state === "invalid-encoding") {
    issues.push({
      severity: "High",
      category: "the expected JSON body was not valid UTF-8",
      failure: true,
    });
    return issues;
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(observation.body.text);
  } catch {
    issues.push({
      severity: "High",
      category: "the expected JSON body was not valid JSON",
      failure: true,
    });
    return issues;
  }

  const configuredFields = endpoint.requiredJsonFields ?? [];
  if (
    configuredFields.length > 0 &&
    (typeof parsedBody !== "object" ||
      parsedBody === null ||
      Array.isArray(parsedBody) ||
      configuredFields.some(
        (field) => !Object.prototype.hasOwnProperty.call(parsedBody, field),
      ))
  ) {
    issues.push({
      severity: "High",
      category: "configured required JSON fields were missing",
      failure: true,
    });
  }

  if (shape === undefined || shape.state !== "supported") {
    return issues;
  }

  if (configuredFieldsMissingFromShape(shape, configuredFields)) {
    issues.push({
      severity: "High",
      category:
        "configured required fields were not represented by the OpenAPI schema",
      failure: true,
    });
  }

  const validation = validateOpenApiShape(shape, parsedBody, configuredFields);
  if (validation.state === "unsupported") {
    issues.push({
      severity: "Medium",
      category: "the OpenAPI response schema used unsupported constructs",
      failure: false,
    });
    return issues;
  }

  if (
    validation.topLevelMismatch ||
    validation.missingFields.length > 0 ||
    validation.mismatchedFields.length > 0
  ) {
    issues.push({
      severity: "High",
      category: "the JSON body did not match the shallow OpenAPI shape",
      failure: true,
    });
  }

  return issues;
}

function runtimeEndpointResult(
  endpoint: ApiEndpoint,
  observation: Extract<EndpointObservation, { state: "response" }>,
  contract: OpenApiContract | undefined,
  api: ApiConfig,
): CheckResult {
  const subject = endpointSubject(endpoint, api.baseUrl);
  const issues = collectRuntimeContractIssues(
    endpoint,
    observation,
    contract,
    api.baseUrl,
  );
  const latencyExceeded = observation.latencyMs > api.latencyThresholdMs;
  const failures = issues.filter((issue) => issue.failure);
  const limitations = issues.filter((issue) => !issue.failure);
  const evidence = [
    `Observed status: ${observation.status}`,
    `Response latency: ${observation.latencyMs} ms`,
    `Latency threshold: ${api.latencyThresholdMs} ms`,
  ];

  if (failures.length > 0) {
    const severity = failures.reduce<"High" | "Medium">(
      (current, issue) => higherSeverity(current, issue.severity),
      "Medium",
    );
    const categories = [
      ...failures.map((issue) => issue.category),
      ...limitations.map((issue) => issue.category),
      ...(latencyExceeded ? ["the latency threshold was exceeded"] : []),
    ];

    return createApiResult(RUNTIME_CHECK, {
      status: "Fail",
      severity,
      subject,
      finding: `The live endpoint violated its contract: ${categories.join("; ")}.`,
      recommendation:
        "Align the endpoint response with its configured and OpenAPI contract, then rerun the live check.",
      evidence,
      durationMs: observation.latencyMs,
    });
  }

  if (limitations.length > 0 || latencyExceeded) {
    const categories = [
      ...limitations.map((issue) => issue.category),
      ...(latencyExceeded ? ["the latency threshold was exceeded"] : []),
    ];

    return createApiResult(RUNTIME_CHECK, {
      status: "Warn",
      severity: "Medium",
      subject,
      finding: `The endpoint could not earn a full live contract pass: ${categories.join("; ")}.`,
      recommendation:
        "Resolve the contract limitation or latency regression, then rerun the live check.",
      evidence,
      durationMs: observation.latencyMs,
    });
  }

  return createApiResult(RUNTIME_CHECK, {
    status: "Pass",
    severity: "Info",
    subject,
    finding:
      "The endpoint matched its configured status, supported OpenAPI response contract, and latency threshold.",
    recommendation:
      "Keep this endpoint contract and latency expectation covered by Sentinel.",
    evidence,
    durationMs: observation.latencyMs,
  });
}

async function checkLiveApi(
  context: ScanContext,
  signal: AbortSignal,
): Promise<CheckExecution> {
  const api = context.config.api;
  if (api === undefined) {
    return execution([
      createApiResult(RUNTIME_CHECK, {
        status: "Skipped",
        severity: "Info",
        finding: "No API is configured for live contract analysis.",
        recommendation:
          "Add the optional API configuration when live contract checks are required.",
        diagnosticCode: "API_NOT_CONFIGURED",
      }),
    ]);
  }

  if (context.reachability.api.state !== "reachable") {
    return execution([
      createApiResult(RUNTIME_CHECK, {
        status: "Skipped",
        severity: "Info",
        finding:
          "The cached API reachability result selected static OpenAPI fallback instead of live requests.",
        recommendation:
          "Start the API service externally and rerun Sentinel to enable live contract and latency checks.",
        diagnosticCode: "API_RUNTIME_UNAVAILABLE",
      }),
    ]);
  }

  if (api.endpoints.length === 0) {
    return execution([
      createApiResult(RUNTIME_CHECK, {
        status: "Skipped",
        severity: "Info",
        finding:
          "The API is reachable, but no read-only endpoints are configured for live analysis.",
        recommendation:
          "Configure at least one GET, HEAD, or OPTIONS endpoint for live verification.",
        diagnosticCode: "API_NO_ENDPOINTS",
      }),
    ]);
  }

  const results: CheckResult[] = [];
  let incomplete = false;
  const startedAt = performance.now();
  const openApi = await loadOpenApiContract(
    context.repository,
    api.openApiPath,
  );
  const contract = openApi.state === "available" ? openApi.contract : undefined;

  if (openApi.state !== "available") {
    const description = loadResultDescription(openApi);
    results.push(
      createApiResult(RUNTIME_CHECK, {
        status: description.incomplete ? "Skipped" : "Warn",
        severity: description.incomplete ? "Info" : "Medium",
        subject: "Configured OpenAPI contract",
        finding: description.finding,
        recommendation: description.recommendation,
        diagnosticCode: description.diagnosticCode,
      }),
    );
    incomplete ||= description.incomplete;
  }

  const endpoints = api.endpoints.slice(0, MAX_RUNTIME_ENDPOINTS);
  let completedEndpoints = 0;

  for (const endpoint of endpoints) {
    const remainingMs =
      INTERNAL_RUNTIME_DEADLINE_MS - (performance.now() - startedAt);
    if (remainingMs <= 1) {
      break;
    }

    const subject = endpointSubject(endpoint, api.baseUrl);
    const headers = authenticationHeaders(context, endpoint);
    if (headers === undefined) {
      results.push(
        createApiResult(RUNTIME_CHECK, {
          status: "Skipped",
          severity: "Info",
          subject,
          finding:
            "The endpoint requires authentication, but its configured environment references were unavailable or unsafe.",
          recommendation:
            "Provide every referenced authentication value securely and rerun Sentinel.",
          diagnosticCode: "API_AUTHENTICATION_UNAVAILABLE",
        }),
      );
      completedEndpoints += 1;
      continue;
    }

    const observation = await observeEndpoint(
      context,
      endpoint,
      headers,
      Math.max(1, Math.min(api.timeoutMs, Math.floor(remainingMs))),
      signal,
    );
    completedEndpoints += 1;

    if (observation.state !== "response") {
      results.push(
        createApiResult(RUNTIME_CHECK, {
          status: "Skipped",
          severity: "Info",
          subject,
          finding:
            observation.state === "timeout"
              ? "The live endpoint request timed out before Sentinel could observe a response."
              : "The live endpoint request failed because of a transport error.",
          recommendation:
            "Restore endpoint availability and rerun Sentinel; static fallback will be selected only by the next central reachability probe.",
          diagnosticCode:
            observation.state === "timeout"
              ? "API_ENDPOINT_TIMEOUT"
              : "API_ENDPOINT_UNAVAILABLE",
        }),
      );
      continue;
    }

    results.push(runtimeEndpointResult(endpoint, observation, contract, api));
    if (observation.body.state === "too-large") {
      results.push(
        createApiResult(RUNTIME_CHECK, {
          status: "Skipped",
          severity: "Info",
          subject: `${subject} response body`,
          finding:
            "Sentinel stopped response-shape inspection at the bounded body-size limit.",
          recommendation:
            "Reduce the response fixture size or narrow the configured endpoint before retrying Sentinel.",
          diagnosticCode: "API_RESPONSE_LIMIT_REACHED",
        }),
      );
      incomplete = true;
    }
  }

  if (
    api.endpoints.length > MAX_RUNTIME_ENDPOINTS ||
    completedEndpoints < endpoints.length
  ) {
    results.push(
      createApiResult(RUNTIME_CHECK, {
        status: "Skipped",
        severity: "Info",
        subject: "Live API coverage",
        finding:
          api.endpoints.length > MAX_RUNTIME_ENDPOINTS
            ? "Sentinel reached the live endpoint-count limit before analyzing every configured endpoint."
            : "Sentinel reached its internal live-analysis deadline before analyzing every configured endpoint.",
        recommendation:
          "Reduce the configured endpoint set or request timeouts, then rerun Sentinel.",
        diagnosticCode:
          api.endpoints.length > MAX_RUNTIME_ENDPOINTS
            ? "API_ENDPOINT_LIMIT_REACHED"
            : "API_RUNTIME_DEADLINE_REACHED",
      }),
    );
    incomplete = true;
  }

  return execution(results, incomplete);
}

function selectStaticShapes(
  response: OpenApiResponseContract,
  expectedContentType: string | undefined,
): readonly OpenApiShape[] {
  if (expectedContentType !== undefined) {
    const match = matchOpenApiMediaType(response, expectedContentType);
    return match === undefined ? [] : [match.shape];
  }

  return [...response.mediaTypes]
    .filter(([mediaType]) => isJsonMediaType(mediaType))
    .map(([, shape]) => shape);
}

function hasUnsupportedShape(shape: OpenApiShape): boolean {
  return (
    shape.state === "unsupported" ||
    (shape.state === "supported" &&
      [...shape.propertyTypes.values()].includes("unsupported"))
  );
}

function configuredFieldsMissingFromShape(
  shape: OpenApiShape,
  fields: readonly string[],
): boolean {
  return (
    shape.state === "supported" &&
    fields.some(
      (field) => !shape.required.has(field) && !shape.propertyTypes.has(field),
    )
  );
}

function staticEndpointResult(
  endpoint: ApiEndpoint,
  contract: OpenApiContract,
  api: ApiConfig,
): CheckResult {
  const subject = endpointSubject(endpoint, api.baseUrl);
  const pathname = new URL(endpoint.path, api.baseUrl).pathname;
  const issues: string[] = [];
  const operation = matchOpenApiOperation(contract, endpoint.method, pathname);

  if (operation.state !== "found") {
    issues.push(
      operation.state === "ambiguous"
        ? "the configured endpoint matches multiple OpenAPI operations"
        : "the configured endpoint is absent from OpenAPI",
    );
  } else {
    const response = matchOpenApiResponse(
      operation.operation,
      endpoint.expectedStatus,
    );
    if (response === undefined) {
      issues.push("the configured status is not documented by OpenAPI");
    } else {
      if (response.unsupported) {
        issues.push("the OpenAPI response uses unsupported constructs");
      }

      const shapes = selectStaticShapes(response, endpoint.expectedContentType);
      const hasUnsupportedDeclaredShape =
        endpoint.expectedContentType === undefined &&
        [...response.mediaTypes.values()].some(hasUnsupportedShape);
      if (
        !response.unsupported &&
        (shapes.some(hasUnsupportedShape) || hasUnsupportedDeclaredShape)
      ) {
        issues.push("the OpenAPI response schema uses unsupported constructs");
      }

      if (
        endpoint.expectedContentType !== undefined &&
        matchOpenApiMediaType(response, endpoint.expectedContentType) ===
          undefined
      ) {
        issues.push("the configured content type is not documented by OpenAPI");
      }

      if (
        endpoint.requiredJsonFields !== undefined &&
        endpoint.requiredJsonFields.length > 0
      ) {
        if (
          shapes.length === 0 ||
          shapes.some((shape) => shape.state === "absent")
        ) {
          issues.push(
            "configured required fields have no OpenAPI response schema",
          );
        } else if (
          shapes.some((shape) =>
            configuredFieldsMissingFromShape(
              shape,
              endpoint.requiredJsonFields ?? [],
            ),
          )
        ) {
          issues.push(
            "configured required fields are not represented by OpenAPI",
          );
        }
      }
    }
  }

  if (issues.length > 0) {
    return createApiResult(STATIC_CHECK, {
      status: "Warn",
      severity: "Medium",
      subject,
      finding: `Static OpenAPI analysis found a contract alignment gap: ${issues.join("; ")}. No live response or latency was observed.`,
      recommendation:
        "Align the endpoint configuration and OpenAPI contract before rerunning Sentinel.",
    });
  }

  return createApiResult(STATIC_CHECK, {
    status: "Pass",
    severity: "Info",
    subject,
    finding:
      "The configured endpoint aligns with the supported static OpenAPI contract. No live response or latency was observed.",
    recommendation:
      "Keep the static contract aligned and rerun with the service available for live verification.",
  });
}

async function checkStaticOpenApi(
  context: ScanContext,
): Promise<CheckExecution> {
  const api = context.config.api;
  if (api === undefined) {
    return execution([
      createApiResult(STATIC_CHECK, {
        status: "Skipped",
        severity: "Info",
        finding: "No API is configured for static OpenAPI fallback.",
        recommendation:
          "Add the optional API configuration when static fallback is required.",
        diagnosticCode: "API_NOT_CONFIGURED",
      }),
    ]);
  }

  if (context.reachability.api.state === "reachable") {
    return execution([
      createApiResult(STATIC_CHECK, {
        status: "Skipped",
        severity: "Info",
        finding:
          "The cached API reachability result selected live contract analysis, so static fallback did not produce findings.",
        recommendation:
          "Use the live results for this scan; static fallback runs only when the next central API probe is unavailable.",
        diagnosticCode: "API_FALLBACK_NOT_SELECTED",
      }),
    ]);
  }

  const openApi = await loadOpenApiContract(
    context.repository,
    api.openApiPath,
  );
  if (openApi.state !== "available") {
    const description = loadResultDescription(openApi);
    return execution(
      [
        createApiResult(STATIC_CHECK, {
          status: description.incomplete ? "Skipped" : "Warn",
          severity: description.incomplete ? "Info" : "Medium",
          subject: "Configured OpenAPI contract",
          finding: `${description.finding} No live response or latency was observed.`,
          recommendation: description.recommendation,
          diagnosticCode: description.diagnosticCode,
        }),
      ],
      description.incomplete,
    );
  }

  const emptyResponseOperations = openApi.contract.operations.filter(
    (operation) => operation.responses.length === 0,
  ).length;
  const unsupportedResponseOperations = openApi.contract.operations.filter(
    (operation) => operation.responses.some((response) => response.unsupported),
  ).length;
  const unsupportedSchemaOperations = openApi.contract.operations.filter(
    (operation) =>
      operation.responses.some((response) =>
        [...response.mediaTypes.values()].some(hasUnsupportedShape),
      ),
  ).length;
  const documentHasCoverage =
    openApi.contract.operations.length > 0 &&
    emptyResponseOperations === 0 &&
    unsupportedResponseOperations === 0 &&
    unsupportedSchemaOperations === 0;
  const results: CheckResult[] = [
    createApiResult(STATIC_CHECK, {
      status: documentHasCoverage ? "Pass" : "Warn",
      severity: documentHasCoverage ? "Info" : "Medium",
      subject: "Configured OpenAPI contract",
      finding: documentHasCoverage
        ? `The OpenAPI ${openApi.contract.version} document defines ${openApi.contract.operations.length} supported read-only operations with response declarations. No live response or latency was observed.`
        : "The OpenAPI document defines no supported read-only operations, includes operations without response declarations, or contains malformed or unsupported response declarations. No live response or latency was observed.",
      recommendation: documentHasCoverage
        ? "Keep the contract valid and rerun with the service available for live verification."
        : "Add valid inline response declarations and remove malformed or unsupported response definitions, then rerun Sentinel.",
    }),
    ...api.endpoints.map((endpoint) =>
      staticEndpointResult(endpoint, openApi.contract, api),
    ),
  ];

  return execution(results);
}

export const apiRuntimeContractCheck: Check = {
  id: RUNTIME_CHECK.id,
  title: RUNTIME_CHECK.title,
  level: "API / Backend",
  phase: RUNTIME_CHECK.phase,
  timeoutMs: 60_000,
  run: checkLiveApi,
};

export const apiStaticOpenApiCheck: Check = {
  id: STATIC_CHECK.id,
  title: STATIC_CHECK.title,
  level: "API / Backend",
  phase: STATIC_CHECK.phase,
  timeoutMs: 5_000,
  run: checkStaticOpenApi,
};
