import { execFile } from "node:child_process";

import { z } from "zod";

import type { Check, CheckExecution } from "../../core/check.js";
import type { Severity } from "../../core/result.js";
import {
  hasRepositoryFile,
  type RepositoryInspection,
} from "../../repository/inspection.js";
import {
  createSecurityResult,
  securityExecution,
  type SecurityCheckMetadata,
} from "./common.js";

const AUDIT_TIMEOUT_MS = 12_000;
const AUDIT_CHECK_TIMEOUT_MS = 15_000;
const AUDIT_MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_VULNERABILITY_FINDINGS = 25;
const LOCKFILES = [
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
] as const;

const AUDIT_CHECK: SecurityCheckMetadata = {
  id: "security.npm-audit",
  title: "npm dependency vulnerability audit",
  phase: "static",
};

const npmSeveritySchema = z.enum([
  "info",
  "low",
  "moderate",
  "high",
  "critical",
]);
type NpmSeverity = z.output<typeof npmSeveritySchema>;

const vulnerabilitySchema = z.looseObject({
  name: z.string().trim().min(1).max(214),
  severity: npmSeveritySchema,
  isDirect: z.boolean(),
  range: z.string().trim().min(1).max(500),
  fixAvailable: z.union([z.boolean(), z.looseObject({})]),
});

const severityCountsSchema = z.looseObject({
  info: z.number().int().nonnegative(),
  low: z.number().int().nonnegative(),
  moderate: z.number().int().nonnegative(),
  high: z.number().int().nonnegative(),
  critical: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

const auditReportSchema = z.looseObject({
  auditReportVersion: z.literal(2),
  vulnerabilities: z.record(z.string(), vulnerabilitySchema),
  metadata: z.looseObject({
    vulnerabilities: severityCountsSchema,
  }),
});

type AuditReport = z.output<typeof auditReportSchema>;

export type NpmAuditRunResult =
  | {
      readonly state: "completed";
      readonly exitCode: number;
      readonly stdout: string;
    }
  | {
      readonly state: "unavailable";
      readonly reason: "command" | "output-limit" | "timeout";
    };

export type NpmAuditRunner = (
  root: string,
  signal: AbortSignal,
) => Promise<NpmAuditRunResult>;

function runNpmAudit(
  root: string,
  signal: AbortSignal,
): Promise<NpmAuditRunResult> {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";

  return new Promise((resolveRun) => {
    execFile(
      command,
      [
        "audit",
        "--json",
        "--package-lock-only",
        "--ignore-scripts",
        "--workspaces=false",
        "--audit-level=info",
      ],
      {
        cwd: root,
        encoding: "utf8",
        maxBuffer: AUDIT_MAX_OUTPUT_BYTES,
        timeout: AUDIT_TIMEOUT_MS,
        signal,
      },
      (error, stdout) => {
        if (error === null) {
          resolveRun({
            state: "completed",
            exitCode: 0,
            stdout,
          });
          return;
        }

        if (typeof error.code === "number") {
          resolveRun({
            state: "completed",
            exitCode: error.code,
            stdout,
          });
          return;
        }

        const outputLimit = error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
        const timedOut =
          signal.aborted ||
          error.killed === true ||
          error.code === "ABORT_ERR" ||
          error.code === "ETIMEDOUT";

        resolveRun({
          state: "unavailable",
          reason: outputLimit
            ? "output-limit"
            : timedOut
              ? "timeout"
              : "command",
        });
      },
    );
  });
}

function skipAudit(
  finding: string,
  recommendation: string,
  diagnosticCode: string,
  incomplete = false,
): CheckExecution {
  return securityExecution(
    [
      createSecurityResult(AUDIT_CHECK, {
        status: "Skipped",
        severity: "Info",
        finding,
        recommendation,
        diagnosticCode,
      }),
    ],
    incomplete,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNpmErrorEnvelope(value: unknown): boolean {
  return (
    isRecord(value) &&
    ("error" in value ||
      (typeof value["message"] === "string" &&
        !("auditReportVersion" in value)))
  );
}

function auditCountsAreConsistent(report: AuditReport): boolean {
  const expected: Record<NpmSeverity, number> = {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
  };

  for (const [packageName, vulnerability] of Object.entries(
    report.vulnerabilities,
  )) {
    if (vulnerability.name !== packageName) {
      return false;
    }

    expected[vulnerability.severity] += 1;
  }

  const counts = report.metadata.vulnerabilities;
  const total =
    counts.info + counts.low + counts.moderate + counts.high + counts.critical;

  return (
    counts.total === total &&
    counts.total === Object.keys(report.vulnerabilities).length &&
    counts.info === expected.info &&
    counts.low === expected.low &&
    counts.moderate === expected.moderate &&
    counts.high === expected.high &&
    counts.critical === expected.critical
  );
}

function resultSeverity(severity: NpmSeverity): {
  readonly status: "Fail" | "Warn";
  readonly severity: Severity;
} {
  switch (severity) {
    case "critical":
      return { status: "Fail", severity: "Critical" };
    case "high":
      return { status: "Fail", severity: "High" };
    case "moderate":
      return { status: "Warn", severity: "Medium" };
    case "info":
    case "low":
      return { status: "Warn", severity: "Low" };
  }
}

function fixAvailability(value: boolean | Record<string, unknown>): string {
  return value === false ? "Fix available: no" : "Fix available: yes";
}

function explicitPackageManagerIsNpm(
  inspection: RepositoryInspection,
): boolean {
  if (inspection.packageManifest.state !== "valid") {
    return false;
  }

  const packageManager = inspection.packageManifest.data.packageManager;

  return (
    packageManager === undefined ||
    packageManager.trim().toLowerCase().split("@", 1)[0] === "npm"
  );
}

export async function checkDependencyAudit(
  inspection: RepositoryInspection,
  signal: AbortSignal,
  runner: NpmAuditRunner = runNpmAudit,
): Promise<CheckExecution> {
  const presentLockfiles = LOCKFILES.filter((path) =>
    hasRepositoryFile(inspection, path),
  );

  if (
    !inspection.nodeProject ||
    presentLockfiles.length !== 1 ||
    presentLockfiles[0] !== "package-lock.json" ||
    !explicitPackageManagerIsNpm(inspection)
  ) {
    return skipAudit(
      "A single root npm package-lock.json was not available, so Sentinel did not run npm audit.",
      "Use one synchronized npm package-lock.json to enable vulnerability auditing.",
      "NPM_AUDIT_NOT_APPLICABLE",
    );
  }

  let run: NpmAuditRunResult;

  try {
    run = await runner(inspection.root, signal);
  } catch {
    run = {
      state: "unavailable",
      reason: signal.aborted ? "timeout" : "command",
    };
  }

  if (run.state === "unavailable") {
    const outputLimited = run.reason === "output-limit";
    return skipAudit(
      outputLimited
        ? "npm audit exceeded Sentinel's bounded output limit, so vulnerability status is unknown."
        : "npm audit was unavailable or did not complete, so vulnerability status is unknown.",
      "Run npm audit directly after restoring npm and registry availability, then retry Sentinel.",
      outputLimited
        ? "NPM_AUDIT_OUTPUT_LIMIT"
        : run.reason === "timeout"
          ? "NPM_AUDIT_TIMEOUT"
          : "NPM_AUDIT_UNAVAILABLE",
      outputLimited,
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(run.stdout) as unknown;
  } catch {
    return skipAudit(
      "npm audit returned output that was not a valid audit report, so vulnerability status is unknown.",
      "Run npm audit directly and resolve its output or compatibility problem before retrying Sentinel.",
      "NPM_AUDIT_INVALID_RESPONSE",
      true,
    );
  }

  if (isNpmErrorEnvelope(parsed)) {
    return skipAudit(
      "npm returned a structured audit failure, so Sentinel did not determine vulnerability status.",
      "Resolve the npm registry, authentication, or lockfile failure and retry the audit.",
      "NPM_AUDIT_UNAVAILABLE",
    );
  }

  const validated = auditReportSchema.safeParse(parsed);

  if (!validated.success || !auditCountsAreConsistent(validated.data)) {
    return skipAudit(
      "npm audit returned an invalid or internally inconsistent report, so vulnerability status is unknown.",
      "Run npm audit directly and resolve its output or compatibility problem before retrying Sentinel.",
      "NPM_AUDIT_INVALID_RESPONSE",
      true,
    );
  }

  const vulnerabilities = Object.entries(validated.data.vulnerabilities).sort(
    ([left], [right]) => left.localeCompare(right),
  );

  if (vulnerabilities.length === 0) {
    if (run.exitCode !== 0) {
      return skipAudit(
        "npm audit exited unsuccessfully despite returning no vulnerabilities, so Sentinel did not treat the project as clean.",
        "Run npm audit directly and resolve the command failure before retrying Sentinel.",
        "NPM_AUDIT_FAILED",
      );
    }

    return securityExecution([
      createSecurityResult(AUDIT_CHECK, {
        subject: "package-lock.json",
        status: "Pass",
        severity: "Info",
        finding:
          "npm audit completed successfully and reported no known vulnerabilities in the root lockfile.",
        recommendation:
          "Keep the lockfile current and continue auditing it as advisories change.",
      }),
    ]);
  }

  if (run.exitCode !== 1) {
    return skipAudit(
      "npm audit returned vulnerability data with an unexpected exit status, so Sentinel did not treat it as a completed audit.",
      "Run npm audit directly and resolve the command or compatibility failure before retrying Sentinel.",
      "NPM_AUDIT_FAILED",
    );
  }

  const results = vulnerabilities
    .slice(0, MAX_VULNERABILITY_FINDINGS)
    .map(([packageName, vulnerability]) => {
      const mapped = resultSeverity(vulnerability.severity);

      return createSecurityResult(AUDIT_CHECK, {
        subject: packageName,
        ...mapped,
        finding: `npm audit reported a ${vulnerability.severity} severity vulnerability for ${packageName}.`,
        recommendation:
          "Review the advisory and update or replace the affected dependency without bypassing compatibility checks.",
        evidence: [
          `Package: ${packageName}`,
          vulnerability.isDirect
            ? "Dependency: direct"
            : "Dependency: transitive",
          `Affected range: ${vulnerability.range}`,
          fixAvailability(vulnerability.fixAvailable),
        ],
      });
    });

  if (vulnerabilities.length > MAX_VULNERABILITY_FINDINGS) {
    results.push(
      createSecurityResult(AUDIT_CHECK, {
        subject: "Additional vulnerable packages",
        status: "Warn",
        severity: "Medium",
        finding: `${vulnerabilities.length - MAX_VULNERABILITY_FINDINGS} additional vulnerable packages were omitted by the report bound.`,
        recommendation:
          "Run npm audit directly to review every remaining vulnerable package.",
        evidence: [`Reported package limit: ${MAX_VULNERABILITY_FINDINGS}`],
      }),
    );
  }

  return securityExecution(results);
}

export const securityDependencyAuditCheck: Check = {
  id: AUDIT_CHECK.id,
  title: AUDIT_CHECK.title,
  level: "Security",
  phase: AUDIT_CHECK.phase,
  timeoutMs: AUDIT_CHECK_TIMEOUT_MS,
  run: (context, signal) => checkDependencyAudit(context.repository, signal),
};
