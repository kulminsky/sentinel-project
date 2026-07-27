import type { Check, CheckExecution, ScanContext } from "../../core/check.js";
import {
  createSecurityResult,
  securityExecution,
  type SecurityCheckMetadata,
} from "./common.js";
import {
  observeReadOnlyTarget,
  type ReadOnlyMethod,
  type RuntimeObservation,
} from "./runtime.js";

const MAX_RUNTIME_TARGETS = 12;
const CSP_VALUE_DIRECTIVES = new Set([
  "base-uri",
  "child-src",
  "connect-src",
  "default-src",
  "font-src",
  "form-action",
  "frame-ancestors",
  "frame-src",
  "img-src",
  "manifest-src",
  "media-src",
  "object-src",
  "script-src",
  "script-src-attr",
  "script-src-elem",
  "style-src",
  "style-src-attr",
  "style-src-elem",
  "worker-src",
]);
const CSP_VALUELESS_DIRECTIVES = new Set([
  "block-all-mixed-content",
  "upgrade-insecure-requests",
]);

const HEADER_CHECK: SecurityCheckMetadata = {
  id: "security.headers",
  title: "Runtime security headers and CORS",
  phase: "runtime",
};

interface HeaderTarget {
  readonly kind: "API" | "UI";
  readonly method: ReadOnlyMethod;
  readonly path: string;
  readonly timeoutMs: number;
  readonly url: URL;
}

interface CompletedHeaderTarget extends HeaderTarget {
  readonly observation: RuntimeObservation;
}

function deduplicateTargets(targets: readonly HeaderTarget[]): HeaderTarget[] {
  const seen = new Set<string>();

  return targets.filter((target) => {
    const key = `${target.kind}:${target.method}:${target.url.href}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function configuredHeaderTargets(context: ScanContext): {
  readonly targets: HeaderTarget[];
  readonly authenticatedExcluded: number;
  readonly serviceNotes: ReturnType<typeof createSecurityResult>[];
} {
  const targets: HeaderTarget[] = [];
  const serviceNotes: ReturnType<typeof createSecurityResult>[] = [];
  let authenticatedExcluded = 0;

  if (context.config.api === undefined) {
    serviceNotes.push(
      createSecurityResult(HEADER_CHECK, {
        subject: "API responses",
        status: "Skipped",
        severity: "Info",
        finding:
          "No API service is configured for runtime security-header checks.",
        recommendation:
          "Configure an API service and unauthenticated read-only endpoints when header checks are required.",
        diagnosticCode: "SECURITY_API_NOT_CONFIGURED",
      }),
    );
  } else if (context.reachability.api.state !== "reachable") {
    serviceNotes.push(
      createSecurityResult(HEADER_CHECK, {
        subject: "API responses",
        status: "Skipped",
        severity: "Info",
        finding:
          "The configured API service was unavailable, so runtime security headers were not observed.",
        recommendation:
          "Start the API service externally or correct its configuration, then retry Sentinel.",
        diagnosticCode: "SECURITY_API_UNREACHABLE",
      }),
    );
  } else {
    const api = context.config.api;
    let unauthenticatedEndpoints = 0;

    for (const endpoint of api.endpoints) {
      if (endpoint.useAuthentication) {
        authenticatedExcluded += 1;
        continue;
      }

      targets.push({
        kind: "API",
        method: endpoint.method,
        path: endpoint.path,
        timeoutMs: api.timeoutMs,
        url: new URL(endpoint.path, api.baseUrl),
      });
      unauthenticatedEndpoints += 1;
    }

    if (unauthenticatedEndpoints === 0) {
      serviceNotes.push(
        createSecurityResult(HEADER_CHECK, {
          subject: "API endpoints",
          status: "Skipped",
          severity: "Info",
          finding:
            "The API service is configured, but no unauthenticated endpoint is configured for runtime security-header checks.",
          recommendation:
            "Configure at least one unauthenticated read-only API endpoint when header checks are required.",
          diagnosticCode: "SECURITY_API_NO_ENDPOINTS",
        }),
      );
    }
  }

  if (context.config.ui === undefined) {
    serviceNotes.push(
      createSecurityResult(HEADER_CHECK, {
        subject: "UI pages",
        status: "Skipped",
        severity: "Info",
        finding:
          "No UI service is configured for runtime security-header checks.",
        recommendation:
          "Configure a UI service and unauthenticated pages when header checks are required.",
        diagnosticCode: "SECURITY_UI_NOT_CONFIGURED",
      }),
    );
  } else if (context.reachability.ui.state !== "reachable") {
    serviceNotes.push(
      createSecurityResult(HEADER_CHECK, {
        subject: "UI pages",
        status: "Skipped",
        severity: "Info",
        finding:
          "The configured UI service was unavailable, so runtime security headers were not observed.",
        recommendation:
          "Start the UI service externally or correct its configuration, then retry Sentinel.",
        diagnosticCode: "SECURITY_UI_UNREACHABLE",
      }),
    );
  } else {
    const ui = context.config.ui;
    if (ui.pages.length === 0) {
      serviceNotes.push(
        createSecurityResult(HEADER_CHECK, {
          subject: "UI pages",
          status: "Skipped",
          severity: "Info",
          finding:
            "The UI service is configured, but no page is configured for runtime security-header checks.",
          recommendation:
            "Configure at least one unauthenticated UI page when header checks are required.",
          diagnosticCode: "SECURITY_UI_NO_PAGES",
        }),
      );
    }

    for (const page of ui.pages) {
      if (page.useAuthentication) {
        authenticatedExcluded += 1;
        continue;
      }

      targets.push({
        kind: "UI",
        method: "GET",
        path: page.path,
        timeoutMs: ui.timeoutMs,
        url: new URL(page.path, ui.baseUrl),
      });
    }
  }

  return {
    targets: deduplicateTargets(targets),
    authenticatedExcluded,
    serviceNotes,
  };
}

function successfulObservation(
  target: CompletedHeaderTarget,
): target is CompletedHeaderTarget & {
  readonly observation: Extract<RuntimeObservation, { state: "response" }>;
} {
  return (
    target.observation.state === "response" &&
    target.observation.status >= 200 &&
    target.observation.status < 400
  );
}

function headerIsNonempty(headers: Headers, name: string): boolean {
  return (headers.get(name)?.trim().length ?? 0) > 0;
}

function hasEnforcingCsp(headers: Headers): boolean {
  const policy = headers.get("content-security-policy");

  if (policy === null) {
    return false;
  }

  return policy.split(";").some((segment) => {
    const [name, ...values] = segment.trim().toLowerCase().split(/\s+/);

    if (name === undefined || name.length === 0) {
      return false;
    }

    return (
      name === "sandbox" ||
      (CSP_VALUELESS_DIRECTIVES.has(name) && values.length === 0) ||
      (CSP_VALUE_DIRECTIVES.has(name) &&
        values.some((value) => value.length > 0))
    );
  });
}

function hasActiveHsts(headers: Headers): boolean {
  const policy = headers.get("strict-transport-security");

  if (policy === null) {
    return false;
  }

  let maxAge: bigint | undefined;

  for (const directive of policy.split(";")) {
    if (!directive.trim().toLowerCase().startsWith("max-age")) {
      continue;
    }

    const match = /^max-age\s*=\s*(\d+)$/i.exec(directive.trim());
    if (match?.[1] === undefined || maxAge !== undefined) {
      return false;
    }

    maxAge = BigInt(match[1]);
  }

  return maxAge !== undefined && maxAge > 0n;
}

function hasNoSniff(headers: Headers): boolean {
  return (
    headers.get("x-content-type-options")?.trim().toLowerCase() === "nosniff"
  );
}

function hasFrameProtection(headers: Headers): boolean {
  const policy = headers.get("content-security-policy")?.toLowerCase() ?? "";
  const frameOptions = headers.get("x-frame-options")?.trim().toLowerCase();
  const frameAncestors = /(?:^|;)\s*frame-ancestors\s+([^;]+)/
    .exec(policy)?.[1]
    ?.trim();

  return (
    (frameAncestors !== undefined && frameAncestors !== "*") ||
    frameOptions === "deny" ||
    frameOptions === "sameorigin"
  );
}

function missingApiHeaders(target: CompletedHeaderTarget): string[] {
  if (!successfulObservation(target)) {
    return [];
  }

  const missing = [
    ...(hasNoSniff(target.observation.headers)
      ? []
      : ["X-Content-Type-Options: nosniff"]),
  ];

  if (
    target.url.protocol === "https:" &&
    !hasActiveHsts(target.observation.headers)
  ) {
    missing.push("Strict-Transport-Security");
  }

  return missing;
}

function missingUiHeaders(target: CompletedHeaderTarget): string[] {
  if (!successfulObservation(target)) {
    return [];
  }

  const headers = target.observation.headers;
  const missing = [
    ...(hasEnforcingCsp(headers) ? [] : ["Content-Security-Policy"]),
    ...(hasFrameProtection(headers) ? [] : ["frame protection"]),
    ...(hasNoSniff(headers) ? [] : ["X-Content-Type-Options: nosniff"]),
    ...(headerIsNonempty(headers, "referrer-policy")
      ? []
      : ["Referrer-Policy"]),
    ...(headerIsNonempty(headers, "permissions-policy")
      ? []
      : ["Permissions-Policy"]),
  ];

  if (target.url.protocol === "https:" && !hasActiveHsts(headers)) {
    missing.push("Strict-Transport-Security");
  }

  return missing;
}

function baselineResult(
  kind: "API" | "UI",
  targets: readonly CompletedHeaderTarget[],
) {
  const missing = new Map<string, string[]>();

  for (const target of targets) {
    const missingForTarget =
      kind === "API" ? missingApiHeaders(target) : missingUiHeaders(target);
    for (const header of missingForTarget) {
      const paths = missing.get(header) ?? [];
      paths.push(`${target.method} ${target.path}`);
      missing.set(header, paths);
    }
  }

  if (missing.size === 0) {
    return createSecurityResult(HEADER_CHECK, {
      subject: `${kind} response headers`,
      status: "Pass",
      severity: "Info",
      finding: `Observed ${kind} responses satisfy Sentinel's bounded security-header baseline.`,
      recommendation:
        "Keep the header policy consistent across every deployed response path.",
      evidence: [`Responses observed: ${targets.length}`],
    });
  }

  return createSecurityResult(HEADER_CHECK, {
    subject: `${kind} response headers`,
    status: "Warn",
    severity: kind === "UI" ? "Medium" : "Low",
    finding: `Observed ${kind} responses are missing one or more baseline security headers.`,
    recommendation:
      "Set the missing headers centrally and verify them on every public response.",
    evidence: [...missing.entries()].map(
      ([header, paths]) => `Missing ${header}: ${paths.join(", ")}`,
    ),
  });
}

function unavailableTargetResult(target: CompletedHeaderTarget) {
  const reason =
    target.observation.state === "response"
      ? `returned HTTP ${target.observation.status}`
      : target.observation.reason === "timeout"
        ? "timed out"
        : "failed with a transport error";

  return createSecurityResult(HEADER_CHECK, {
    subject: `${target.kind} ${target.method} ${target.path}`,
    status: "Skipped",
    severity: "Info",
    finding: `The runtime response ${reason}, so its security headers were not evaluated.`,
    recommendation:
      "Restore a successful unauthenticated response and rerun the security-header check.",
    diagnosticCode: "SECURITY_HEADER_OBSERVATION_UNAVAILABLE",
  });
}

export async function checkSecurityHeaders(
  context: ScanContext,
  signal: AbortSignal,
): Promise<CheckExecution> {
  const configured = configuredHeaderTargets(context);
  const boundedTargets = configured.targets.slice(0, MAX_RUNTIME_TARGETS);
  const coverageLimited = configured.targets.length > MAX_RUNTIME_TARGETS;
  const completed = await Promise.all(
    boundedTargets.map(async (target): Promise<CompletedHeaderTarget> => ({
      ...target,
      observation: await observeReadOnlyTarget({
        fetch: context.fetch,
        method: target.method,
        signal,
        timeoutMs: target.timeoutMs,
        url: target.url,
      }),
    })),
  );
  const results = [...configured.serviceNotes];
  const successful = completed.filter(successfulObservation);
  const unavailable = completed.filter(
    (target) => !successfulObservation(target),
  );

  results.push(...unavailable.map(unavailableTargetResult));

  const apiTargets = successful.filter((target) => target.kind === "API");
  if (apiTargets.length > 0) {
    results.push(baselineResult("API", apiTargets));
    const wildcard = apiTargets.filter(
      (target) =>
        target.observation.headers
          .get("access-control-allow-origin")
          ?.trim() === "*",
    );

    results.push(
      wildcard.length === 0
        ? createSecurityResult(HEADER_CHECK, {
            subject: "API CORS policy",
            status: "Pass",
            severity: "Info",
            finding:
              "No wildcard Access-Control-Allow-Origin header was observed on the bounded API responses.",
            recommendation:
              "Keep cross-origin access limited to explicitly trusted origins.",
            evidence: [`Responses observed: ${apiTargets.length}`],
          })
        : createSecurityResult(HEADER_CHECK, {
            subject: "API CORS policy",
            status: "Warn",
            severity: "Medium",
            finding:
              "Wildcard cross-origin access was observed on one or more API responses.",
            recommendation:
              "Replace wildcard CORS with an explicit origin allowlist unless public cross-origin access is intentional.",
            evidence: wildcard.map(
              (target) => `Wildcard origin: ${target.method} ${target.path}`,
            ),
          }),
    );
  }

  const uiTargets = successful.filter((target) => target.kind === "UI");
  if (uiTargets.length > 0) {
    results.push(baselineResult("UI", uiTargets));
  }

  if (configured.authenticatedExcluded > 0) {
    results.push(
      createSecurityResult(HEADER_CHECK, {
        subject: "Authenticated runtime targets",
        status: "Skipped",
        severity: "Info",
        finding: `${configured.authenticatedExcluded} authenticated targets were intentionally excluded from Security requests.`,
        recommendation:
          "Provide separate unauthenticated health or public pages for bounded header verification.",
        diagnosticCode: "SECURITY_AUTHENTICATED_TARGET_SKIPPED",
      }),
    );
  }

  if (coverageLimited) {
    results.push(
      createSecurityResult(HEADER_CHECK, {
        subject: "Runtime security-header coverage",
        status: "Skipped",
        severity: "Info",
        finding:
          "Configured runtime targets exceeded Sentinel's bounded Security request limit.",
        recommendation:
          "Reduce configured targets or review the remaining headers with a dedicated local workflow.",
        diagnosticCode: "SECURITY_HEADER_TARGET_LIMIT",
      }),
    );
  }

  if (results.length === 0) {
    results.push(
      createSecurityResult(HEADER_CHECK, {
        status: "Skipped",
        severity: "Info",
        finding:
          "No reachable unauthenticated runtime targets were available for security-header checks.",
        recommendation:
          "Configure and start an unauthenticated API endpoint or UI page, then retry Sentinel.",
        diagnosticCode: "SECURITY_HEADER_NO_TARGETS",
      }),
    );
  }

  return securityExecution(results, coverageLimited);
}

export const securityHeadersCheck: Check = {
  id: HEADER_CHECK.id,
  title: HEADER_CHECK.title,
  level: "Security",
  phase: HEADER_CHECK.phase,
  timeoutMs: 30_000,
  run: checkSecurityHeaders,
};
