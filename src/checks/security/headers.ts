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
const MIN_STRONG_HSTS_MAX_AGE_SECONDS = 31_536_000n;
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
const VERIFIED_PERMISSIONS_POLICY_FEATURES = new Set([
  "camera",
  "geolocation",
  "microphone",
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

interface HeaderConcern {
  readonly header: string;
  readonly reason: "missing" | "weak";
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

function parseCspDirectives(
  policy: string,
): ReadonlyMap<string, readonly string[]> | undefined {
  const directives = new Map<string, readonly string[]>();

  for (const segment of policy.split(";")) {
    const tokens = segment.trim().toLowerCase().split(/\s+/);
    const name = tokens.shift();
    if (name === undefined || name.length === 0) {
      continue;
    }

    if (!/^[a-z][a-z0-9-]*$/.test(name) || directives.has(name)) {
      return undefined;
    }

    directives.set(name, tokens);
  }

  return directives.size > 0 ? directives : undefined;
}

function isBoundedCspSource(source: string): boolean {
  if (
    source === "'self'" ||
    source === "'none'" ||
    source === "'strict-dynamic'" ||
    /^'(?:nonce-|sha(?:256|384|512)-)[A-Za-z0-9+/=_-]+'$/.test(source)
  ) {
    return true;
  }

  return /^https?:\/\/[^*/\s]+(?::\d+)?(?:\/[^*\s]*)?$/.test(source);
}

function isBoundedFrameAncestorSource(source: string): boolean {
  if (source === "'none'" || source === "'self'") {
    return true;
  }

  try {
    const url = new URL(source);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.pathname === "/" &&
      url.search.length === 0 &&
      url.hash.length === 0 &&
      source.replace(/\/$/, "") === url.origin
    );
  } catch {
    return false;
  }
}

function hasValidFrameAncestors(sources: readonly string[]): boolean {
  return (
    sources.length > 0 &&
    sources.every(isBoundedFrameAncestorSource) &&
    (!sources.includes("'none'") || sources.length === 1)
  );
}

function hasVerifiablyRestrictiveCsp(headers: Headers): boolean {
  const policy = headers.get("content-security-policy");

  if (policy === null) {
    return false;
  }

  const directives = parseCspDirectives(policy);
  const defaultSources = directives?.get("default-src");
  if (
    directives === undefined ||
    defaultSources === undefined ||
    defaultSources.length === 0
  ) {
    return false;
  }

  for (const [name, sources] of directives) {
    if (!CSP_VALUE_DIRECTIVES.has(name)) {
      return false;
    }

    if (
      sources.length === 0 ||
      (name === "frame-ancestors" && !hasValidFrameAncestors(sources)) ||
      (sources.includes("'none'") && sources.length !== 1) ||
      sources.some(
        (source) =>
          source === "*" ||
          source === "'unsafe-inline'" ||
          source === "'unsafe-eval'" ||
          source === "data:" ||
          source === "blob:" ||
          !isBoundedCspSource(source),
      )
    ) {
      return false;
    }
  }

  return true;
}

function hasStrongHsts(headers: Headers): boolean {
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

  return maxAge !== undefined && maxAge >= MIN_STRONG_HSTS_MAX_AGE_SECONDS;
}

function hasNoSniff(headers: Headers): boolean {
  return (
    headers.get("x-content-type-options")?.trim().toLowerCase() === "nosniff"
  );
}

function hasFrameProtection(headers: Headers): boolean {
  const policy = headers.get("content-security-policy");
  const frameOptions = headers.get("x-frame-options")?.trim().toLowerCase();
  const frameAncestors =
    policy === null
      ? undefined
      : parseCspDirectives(policy)?.get("frame-ancestors");

  if (frameAncestors !== undefined) {
    return hasValidFrameAncestors(frameAncestors);
  }

  return frameOptions === "deny" || frameOptions === "sameorigin";
}

function hasSafeReferrerPolicy(headers: Headers): boolean {
  const policies = headers
    .get("referrer-policy")
    ?.split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  const selected = policies?.at(-1);

  return (
    selected === "no-referrer" ||
    selected === "same-origin" ||
    selected === "strict-origin" ||
    selected === "strict-origin-when-cross-origin"
  );
}

function hasRestrictivePermissionsPolicy(headers: Headers): boolean {
  const policy = headers.get("permissions-policy")?.trim();
  if (policy === undefined || policy.length === 0) {
    return false;
  }

  const directives = policy.split(",").map((value) => value.trim());
  const restricted = new Set<string>();

  for (const directive of directives) {
    const match = /^([a-z][a-z0-9-]*)=\(\)$/i.exec(directive);
    const feature = match?.[1]?.toLowerCase();
    if (
      feature === undefined ||
      !VERIFIED_PERMISSIONS_POLICY_FEATURES.has(feature) ||
      restricted.has(feature)
    ) {
      return false;
    }
    restricted.add(feature);
  }

  return [...VERIFIED_PERMISSIONS_POLICY_FEATURES].every((feature) =>
    restricted.has(feature),
  );
}

function headerConcern(
  headers: Headers,
  name: string,
  valid: boolean,
  label = name,
): HeaderConcern | undefined {
  const value = headers.get(name);

  if (value === null || value.trim().length === 0) {
    return { header: label, reason: "missing" };
  }

  return valid ? undefined : { header: label, reason: "weak" };
}

function frameProtectionConcern(headers: Headers): HeaderConcern | undefined {
  if (hasFrameProtection(headers)) {
    return undefined;
  }

  const cspPresent =
    (headers.get("content-security-policy")?.trim().length ?? 0) > 0;
  const frameOptionsPresent =
    (headers.get("x-frame-options")?.trim().length ?? 0) > 0;

  return {
    header: "frame protection",
    reason: cspPresent || frameOptionsPresent ? "weak" : "missing",
  };
}

function missingApiHeaders(target: CompletedHeaderTarget): HeaderConcern[] {
  if (!successfulObservation(target)) {
    return [];
  }

  const headers = target.observation.headers;
  const concerns = [
    headerConcern(
      headers,
      "x-content-type-options",
      hasNoSniff(headers),
      "X-Content-Type-Options: nosniff",
    ),
  ].filter((value): value is HeaderConcern => value !== undefined);

  if (target.url.protocol === "https:" && !hasStrongHsts(headers)) {
    const concern = headerConcern(
      headers,
      "strict-transport-security",
      false,
      "Strict-Transport-Security",
    );
    if (concern !== undefined) {
      concerns.push(concern);
    }
  }

  return concerns;
}

function missingUiHeaders(target: CompletedHeaderTarget): HeaderConcern[] {
  if (!successfulObservation(target)) {
    return [];
  }

  const headers = target.observation.headers;
  const concerns = [
    headerConcern(
      headers,
      "content-security-policy",
      hasVerifiablyRestrictiveCsp(headers),
      "Content-Security-Policy",
    ),
    frameProtectionConcern(headers),
    headerConcern(
      headers,
      "x-content-type-options",
      hasNoSniff(headers),
      "X-Content-Type-Options: nosniff",
    ),
    headerConcern(
      headers,
      "referrer-policy",
      hasSafeReferrerPolicy(headers),
      "Referrer-Policy",
    ),
    headerConcern(
      headers,
      "permissions-policy",
      hasRestrictivePermissionsPolicy(headers),
      "Permissions-Policy",
    ),
  ].filter((value): value is HeaderConcern => value !== undefined);

  if (target.url.protocol === "https:" && !hasStrongHsts(headers)) {
    const concern = headerConcern(
      headers,
      "strict-transport-security",
      false,
      "Strict-Transport-Security",
    );
    if (concern !== undefined) {
      concerns.push(concern);
    }
  }

  return concerns;
}

function baselineResult(
  kind: "API" | "UI",
  targets: readonly CompletedHeaderTarget[],
) {
  const concerns = new Map<
    string,
    { concern: HeaderConcern; paths: string[] }
  >();

  for (const target of targets) {
    const targetConcerns =
      kind === "API" ? missingApiHeaders(target) : missingUiHeaders(target);
    for (const concern of targetConcerns) {
      const key = `${concern.reason}:${concern.header}`;
      const existing = concerns.get(key);
      if (existing === undefined) {
        concerns.set(key, {
          concern,
          paths: [`${target.method} ${target.path}`],
        });
      } else {
        existing.paths.push(`${target.method} ${target.path}`);
      }
    }
  }

  if (concerns.size === 0) {
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
    finding: `Observed ${kind} responses are missing baseline headers or use policies whose strength Sentinel could not verify.`,
    recommendation:
      "Set restrictive header policies centrally and verify them on every public response.",
    evidence: [...concerns.values()].map(
      ({ concern, paths }) =>
        `${concern.reason === "missing" ? "Missing" : "Weak or unverified"} ${concern.header}: ${paths.join(", ")}`,
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
