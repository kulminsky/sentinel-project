import type { Check, CheckExecution, ScanContext } from "../../core/check.js";
import {
  readRepositoryText,
  type RepositoryInspection,
} from "../../repository/inspection.js";
import {
  createSecurityResult,
  securityExecution,
  type SecurityCheckMetadata,
} from "./common.js";
import { isNodeSourceFile } from "./files.js";
import {
  observeReadOnlyTarget,
  type ReadOnlyMethod,
  type RuntimeObservation,
} from "./runtime.js";

const MAX_SOURCE_FILES = 500;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_DEBUG_CANDIDATES = 10;

const DEBUG_CHECK: SecurityCheckMetadata = {
  id: "security.debug-endpoints",
  title: "Evidence-derived debug endpoints",
  phase: "runtime",
};

const ROUTE_PATTERN =
  /\b(?:app|fastify|router|server)\s*\.\s*(get|head|options|post|put|patch|delete|use)\s*\(\s*["'`]([^"'`]+)["'`]/gi;

interface DebugCandidate {
  readonly service: "api" | "ui";
  readonly method: ReadOnlyMethod | "POST" | "PUT" | "PATCH" | "DELETE" | "USE";
  readonly path: string;
  readonly authenticated: boolean;
  readonly configured: boolean;
  readonly source?: string;
  readonly line?: number;
}

function isRiskyDebugPath(path: string): boolean {
  const normalized = path.toLowerCase();

  return (
    /(?:^|\/)(?:_?debug_?|__debug__|phpinfo(?:\.php)?)(?:\/|$)/.test(
      normalized,
    ) ||
    /(?:^|\/)actuator\/(?:configprops|env|heapdump|threaddump)(?:\/|$)/.test(
      normalized,
    )
  );
}

function containsAsciiControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function safeRoutePath(value: string): string | undefined {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    containsAsciiControl(value) ||
    value.length > 300
  ) {
    return undefined;
  }

  return value;
}

function sanitizedSourcePath(value: string): string {
  return containsAsciiControl(value)
    ? "[source path omitted: unsafe characters]"
    : value;
}

function lineNumber(content: string, index: number): number {
  return content.slice(0, index).split(/\r?\n/).length;
}

async function discoverSourceCandidates(
  inspection: RepositoryInspection,
  signal: AbortSignal,
): Promise<{
  readonly candidates: DebugCandidate[];
  readonly incomplete: boolean;
}> {
  const allFiles = inspection.entries
    .filter((entry) => entry.kind === "file" && isNodeSourceFile(entry.path))
    .map((entry) => entry.path);
  const files = allFiles.slice(0, MAX_SOURCE_FILES);
  const candidates: DebugCandidate[] = [];
  let totalBytes = 0;
  let incomplete = !inspection.complete || allFiles.length > MAX_SOURCE_FILES;

  for (const path of files) {
    if (signal.aborted) {
      throw new Error("Debug discovery aborted.");
    }

    const content = await readRepositoryText(inspection, path);
    if (content.state !== "ok") {
      incomplete = true;
      continue;
    }

    const bytes = Buffer.byteLength(content.content);
    if (totalBytes + bytes > MAX_SOURCE_BYTES) {
      incomplete = true;
      break;
    }
    totalBytes += bytes;

    ROUTE_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ROUTE_PATTERN.exec(content.content)) !== null) {
      const methodValue = match[1]?.toUpperCase();
      const routePath =
        match[2] === undefined ? undefined : safeRoutePath(match[2]);

      if (
        routePath === undefined ||
        !isRiskyDebugPath(routePath) ||
        ![
          "GET",
          "HEAD",
          "OPTIONS",
          "POST",
          "PUT",
          "PATCH",
          "DELETE",
          "USE",
        ].includes(methodValue ?? "")
      ) {
        continue;
      }

      candidates.push({
        service: "api",
        method: methodValue as DebugCandidate["method"],
        path: routePath,
        authenticated: false,
        configured: false,
        source: path,
        line: lineNumber(content.content, match.index),
      });
    }
  }

  return {
    candidates,
    incomplete,
  };
}

function configuredCandidates(context: ScanContext): DebugCandidate[] {
  const candidates: DebugCandidate[] = [];
  const api = context.config.api;
  const ui = context.config.ui;

  if (api !== undefined && isRiskyDebugPath(api.healthPath)) {
    candidates.push({
      service: "api",
      method: "HEAD",
      path: api.healthPath,
      authenticated: false,
      configured: true,
    });
  }

  for (const endpoint of api?.endpoints ?? []) {
    if (isRiskyDebugPath(endpoint.path)) {
      candidates.push({
        service: "api",
        method: endpoint.method,
        path: endpoint.path,
        authenticated: endpoint.useAuthentication,
        configured: true,
      });
    }
  }

  for (const page of ui?.pages ?? []) {
    if (isRiskyDebugPath(page.path)) {
      candidates.push({
        service: "ui",
        method: "GET",
        path: page.path,
        authenticated: page.useAuthentication,
        configured: true,
      });
    }
  }

  return candidates;
}

function deduplicateCandidates(
  candidates: readonly DebugCandidate[],
): DebugCandidate[] {
  const selected = new Map<string, DebugCandidate>();

  for (const candidate of candidates) {
    const key = `${candidate.service}:${candidate.method}:${candidate.path}`;
    const existing = selected.get(key);

    if (existing === undefined) {
      selected.set(key, candidate);
    } else if (existing.configured && candidate.source !== undefined) {
      selected.set(key, {
        ...existing,
        source: candidate.source,
        ...(candidate.line === undefined ? {} : { line: candidate.line }),
      });
    }
  }

  return [...selected.values()].sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.method.localeCompare(right.method),
  );
}

function candidateEvidence(
  candidate: DebugCandidate,
  status?: number,
): string[] {
  return [
    `Method: ${candidate.method}`,
    `Path: ${candidate.path}`,
    ...(candidate.source === undefined
      ? []
      : [
          `Source: ${sanitizedSourcePath(candidate.source)}${candidate.line === undefined ? "" : `:${candidate.line}`}`,
        ]),
    ...(status === undefined ? [] : [`HTTP status: ${status}`]),
  ];
}

function staticCandidateResult(
  candidate: DebugCandidate,
  reason: string,
  severity: "Low" | "Medium",
  status?: number,
) {
  return createSecurityResult(DEBUG_CHECK, {
    subject: `${candidate.service.toUpperCase()} ${candidate.path}`,
    status: "Warn",
    severity,
    finding: `A debug-like route declaration was detected, but public exposure was not confirmed because ${reason}.`,
    recommendation:
      "Remove the route from production or enforce explicit access controls and verify them separately.",
    evidence: candidateEvidence(candidate, status),
  });
}

function runtimeCandidateResult(
  candidate: DebugCandidate,
  observation: RuntimeObservation,
) {
  if (observation.state === "unavailable") {
    return staticCandidateResult(
      candidate,
      observation.reason === "timeout"
        ? "the read-only request timed out"
        : "the read-only request failed",
      "Low",
    );
  }

  if (observation.status >= 200 && observation.status < 400) {
    return createSecurityResult(DEBUG_CHECK, {
      subject: `${candidate.service.toUpperCase()} ${candidate.path}`,
      status: "Fail",
      severity: "High",
      finding:
        "A discovered debug-like endpoint was publicly reachable without authentication.",
      recommendation:
        "Remove the endpoint from production or require explicit authorization and network restrictions.",
      evidence: candidateEvidence(candidate, observation.status),
    });
  }

  if (
    observation.status === 401 ||
    observation.status === 403 ||
    observation.status === 404 ||
    observation.status === 410
  ) {
    return staticCandidateResult(
      candidate,
      `the unauthenticated response was HTTP ${observation.status}`,
      "Low",
      observation.status,
    );
  }

  return staticCandidateResult(
    candidate,
    `the unauthenticated response was HTTP ${observation.status}`,
    "Medium",
    observation.status,
  );
}

export async function checkDebugEndpoints(
  context: ScanContext,
  signal: AbortSignal,
): Promise<CheckExecution> {
  const discovered = context.repository.nodeProject
    ? await discoverSourceCandidates(context.repository, signal)
    : { candidates: [], incomplete: !context.repository.complete };
  const allCandidates = deduplicateCandidates([
    ...configuredCandidates(context),
    ...discovered.candidates,
  ]);
  const candidates = allCandidates.slice(0, MAX_DEBUG_CANDIDATES);
  const coverageLimited =
    discovered.incomplete || allCandidates.length > MAX_DEBUG_CANDIDATES;
  const results = [];

  for (const candidate of candidates) {
    if (
      candidate.method !== "GET" &&
      candidate.method !== "HEAD" &&
      candidate.method !== "OPTIONS"
    ) {
      results.push(
        staticCandidateResult(
          candidate,
          "its method is not eligible for a read-only request",
          "Medium",
        ),
      );
      continue;
    }

    if (candidate.authenticated) {
      results.push(
        staticCandidateResult(
          candidate,
          "the configured target requires authentication and was intentionally not requested",
          "Low",
        ),
      );
      continue;
    }

    const serviceConfig =
      candidate.service === "api" ? context.config.api : context.config.ui;
    const serviceReachability =
      candidate.service === "api"
        ? context.reachability.api
        : context.reachability.ui;

    if (
      serviceConfig === undefined ||
      serviceReachability.state !== "reachable"
    ) {
      results.push(
        staticCandidateResult(
          candidate,
          `the configured ${candidate.service.toUpperCase()} runtime was unavailable`,
          "Low",
        ),
      );
      continue;
    }

    const observation = await observeReadOnlyTarget({
      fetch: context.fetch,
      method: candidate.method,
      signal,
      timeoutMs: serviceConfig.timeoutMs,
      url: new URL(candidate.path, serviceConfig.baseUrl),
    });
    results.push(runtimeCandidateResult(candidate, observation));
  }

  if (coverageLimited) {
    results.push(
      createSecurityResult(DEBUG_CHECK, {
        subject: "Debug endpoint discovery coverage",
        status: "Skipped",
        severity: "Info",
        finding:
          "Debug endpoint discovery could not make a complete absence claim within its source or candidate bounds.",
        recommendation:
          "Reduce unreadable source or review remaining routes with a dedicated local workflow.",
        diagnosticCode: "DEBUG_DISCOVERY_INCOMPLETE",
      }),
    );
  } else if (results.length === 0) {
    results.push(
      context.repository.nodeProject
        ? createSecurityResult(DEBUG_CHECK, {
            status: "Pass",
            severity: "Info",
            finding:
              "No high-confidence debug endpoint declaration was detected in the bounded Node source or configured runtime paths.",
            recommendation:
              "Keep production debug and diagnostic routes disabled or access-controlled.",
          })
        : createSecurityResult(DEBUG_CHECK, {
            status: "Skipped",
            severity: "Info",
            finding:
              "Evidence-derived debug route discovery is not supported for this generic project stack.",
            recommendation:
              "Review framework-specific diagnostic routes manually.",
            diagnosticCode: "DEBUG_DISCOVERY_UNSUPPORTED",
          }),
    );
  }

  return securityExecution(results, coverageLimited);
}

export const securityDebugEndpointsCheck: Check = {
  id: DEBUG_CHECK.id,
  title: DEBUG_CHECK.title,
  level: "Security",
  phase: DEBUG_CHECK.phase,
  timeoutMs: 15_000,
  run: checkDebugEndpoints,
};
