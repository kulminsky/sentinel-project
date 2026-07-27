import { Buffer } from "node:buffer";

import type { Check, CheckExecution } from "../../core/check.js";
import type { Severity } from "../../core/result.js";
import {
  readRepositoryText,
  type RepositoryInspection,
} from "../../repository/inspection.js";
import {
  createSecurityResult,
  securityExecution,
  type SecurityCheckMetadata,
} from "./common.js";
import {
  isEnvironmentFile,
  isSecretScannableFile,
  loadIgnorePolicy,
} from "./files.js";

const MAX_SCANNED_FILES = 1_000;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const MAX_FINDINGS = 25;
const MAX_LINES_PER_FINDING = 10;
const SECRET_SCAN_BUDGET_MS = 7_500;
const SECRET_CHECK_TIMEOUT_MS = 8_000;

const SECRET_CHECK: SecurityCheckMetadata = {
  id: "security.secret-scan",
  title: "High-confidence secret scan",
  phase: "static",
};

interface SecretDetector {
  readonly category: string;
  readonly severity: "Critical" | "High";
  readonly pattern: RegExp;
}

const SECRET_DETECTORS: readonly SecretDetector[] = [
  {
    category: "Anthropic API credential",
    severity: "High",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/,
  },
  {
    category: "OpenAI API credential",
    severity: "High",
    pattern: /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  },
  {
    category: "AWS access-key ID",
    severity: "High",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  },
  {
    category: "GitHub credential",
    severity: "High",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{60,})\b/,
  },
  {
    category: "Slack credential",
    severity: "High",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  },
  {
    category: "Stripe live credential",
    severity: "High",
    pattern: /\bsk_live_[A-Za-z0-9]{16,}\b/,
  },
  {
    category: "Google API credential",
    severity: "High",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/,
  },
];

const PRIVATE_KEY_BEGIN_PATTERN =
  /-----BEGIN ((?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/g;
const MIN_PRIVATE_KEY_MATERIAL_CHARACTERS = 64;

const SECRET_ENVIRONMENT_NAME =
  /(?:^|_)(?:ACCESS_KEY|API_KEY|CLIENT_SECRET|CREDENTIAL|PASSWORD|PASSWD|PRIVATE_KEY|SECRET|TOKEN)(?:_|$)/i;

interface SecretFinding {
  readonly path: string;
  readonly category: string;
  readonly severity: "Critical" | "High";
  readonly lines: number[];
}

function lineNumberAt(content: string, index: number): number {
  let line = 1;

  for (let cursor = 0; cursor < index; cursor += 1) {
    if (content.charCodeAt(cursor) === 10) {
      line += 1;
    }
  }

  return line;
}

function hasPlausiblePrivateKeyMaterial(body: string): boolean {
  let materialCharacters = 0;
  let metadataAllowed = true;
  let sawContent = false;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) {
      if (sawContent) {
        metadataAllowed = false;
      }
      continue;
    }

    if (metadataAllowed && /^[A-Za-z][A-Za-z-]*:\s*[^\r\n]+$/.test(line)) {
      sawContent = true;
      continue;
    }

    metadataAllowed = false;
    if (/^=[A-Za-z0-9+/]{4}$/.test(line)) {
      continue;
    }

    if (!/^[A-Za-z0-9+/]{16,}={0,2}$/.test(line)) {
      return false;
    }

    materialCharacters += line.replace(/=/g, "").length;
    sawContent = true;
  }

  return materialCharacters >= MIN_PRIVATE_KEY_MATERIAL_CHARACTERS;
}

function privateKeyLines(content: string): number[] {
  const lines: number[] = [];

  for (const match of content.matchAll(PRIVATE_KEY_BEGIN_PATTERN)) {
    const label = match[1];
    const start = match.index;
    if (label === undefined || start === undefined) {
      continue;
    }

    const bodyStart = start + match[0].length;
    const endMarker = `-----END ${label}-----`;
    const end = content.indexOf(endMarker, bodyStart);
    if (end === -1) {
      continue;
    }

    const body = content.slice(bodyStart, end);
    if (!hasPlausiblePrivateKeyMaterial(body)) {
      continue;
    }

    lines.push(lineNumberAt(content, start));
    if (lines.length >= MAX_LINES_PER_FINDING) {
      break;
    }
  }

  return lines;
}

function normalizedEnvironmentValue(value: string): string {
  const trimmed = value.trim();

  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quote = trimmed[0];

    for (let index = 1; index < trimmed.length; index += 1) {
      if (trimmed[index] === quote && trimmed[index - 1] !== "\\") {
        return trimmed.slice(1, index).trim();
      }
    }
  }

  return trimmed.replace(/\s+#.*$/, "").trim();
}

function isPlaceholder(value: string): boolean {
  if (value.length === 0) {
    return true;
  }

  const normalized = value.toLowerCase();

  return (
    normalized.startsWith("${") ||
    normalized.startsWith("$") ||
    normalized.startsWith("process.env") ||
    normalized.startsWith("your_") ||
    normalized.startsWith("your-") ||
    /^<[^>]+>$/.test(normalized) ||
    /^(?:change[_-]?me|dummy|example|none|null|placeholder|replace[_-]?me|sample|test|todo)(?:[_-].*)?$/.test(
      normalized,
    )
  );
}

function environmentAssignmentCategory(line: string): string | undefined {
  const assignment =
    /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);

  if (
    assignment?.[1] === undefined ||
    assignment[2] === undefined ||
    !SECRET_ENVIRONMENT_NAME.test(assignment[1])
  ) {
    return undefined;
  }

  const value = normalizedEnvironmentValue(assignment[2]);

  return value.length >= 8 && !isPlaceholder(value)
    ? "Environment credential assignment"
    : undefined;
}

function collectFileFindings(path: string, content: string): SecretFinding[] {
  const linesByCategory = new Map<
    string,
    {
      severity: "Critical" | "High";
      lines: number[];
    }
  >();

  content.split(/\r?\n/).forEach((line, index) => {
    for (const detector of SECRET_DETECTORS) {
      if (!detector.pattern.test(line)) {
        continue;
      }

      const existing = linesByCategory.get(detector.category);
      if (existing === undefined) {
        linesByCategory.set(detector.category, {
          severity: detector.severity,
          lines: [index + 1],
        });
      } else if (existing.lines.length < MAX_LINES_PER_FINDING) {
        existing.lines.push(index + 1);
      }
    }

    if (isEnvironmentFile(path)) {
      const category = environmentAssignmentCategory(line);

      if (category !== undefined) {
        const existing = linesByCategory.get(category);
        if (existing === undefined) {
          linesByCategory.set(category, {
            severity: "High",
            lines: [index + 1],
          });
        } else if (existing.lines.length < MAX_LINES_PER_FINDING) {
          existing.lines.push(index + 1);
        }
      }
    }
  });

  const keyLines = privateKeyLines(content);
  if (keyLines.length > 0) {
    linesByCategory.set("Private key", {
      severity: "Critical",
      lines: keyLines,
    });
  }

  return [...linesByCategory.entries()].map(
    ([category, { severity, lines }]) => ({
      path,
      category,
      severity,
      lines,
    }),
  );
}

function severityRank(severity: "Critical" | "High"): number {
  return severity === "Critical" ? 2 : 1;
}

function findingResult(finding: SecretFinding) {
  return createSecurityResult(SECRET_CHECK, {
    subject: finding.path,
    status: "Fail",
    severity: finding.severity,
    finding: `A high-confidence ${finding.category.toLowerCase()} signature was detected.`,
    recommendation:
      "Remove and rotate the credential, then use an ignored environment reference or approved secret store.",
    evidence: [
      `Category: ${finding.category}`,
      ...finding.lines.map((line) => `Line: ${line}`),
    ],
  });
}

export async function checkSecrets(
  inspection: RepositoryInspection,
  signal: AbortSignal,
  now: () => number = () => performance.now(),
): Promise<CheckExecution> {
  const deadline = now() + SECRET_SCAN_BUDGET_MS;
  const ignorePolicy = await loadIgnorePolicy(inspection);

  if (ignorePolicy.state === "unavailable") {
    return securityExecution(
      [
        createSecurityResult(SECRET_CHECK, {
          subject: "Secret scan coverage",
          status: "Skipped",
          severity: "Info",
          finding:
            "Root ignore rules could not be interpreted safely, so Sentinel did not scan files whose inclusion status was unknown.",
          recommendation:
            "Correct or restore the root .gitignore and rerun the bounded secret scan.",
          diagnosticCode: "SECRET_SCAN_INCOMPLETE",
        }),
      ],
      true,
    );
  }

  const allCandidates = inspection.entries
    .filter(
      (entry) =>
        entry.kind === "file" &&
        isSecretScannableFile(entry.path) &&
        !ignorePolicy.ignores(entry.path),
    )
    .map((entry) => entry.path);
  const candidates = allCandidates.slice(0, MAX_SCANNED_FILES);
  let coverageLimited =
    !inspection.complete || allCandidates.length > MAX_SCANNED_FILES;
  let totalBytes = 0;
  const findings: SecretFinding[] = [];

  for (const path of candidates) {
    if (signal.aborted || now() >= deadline) {
      coverageLimited = true;
      break;
    }

    const content = await readRepositoryText(inspection, path);

    if (content.state !== "ok") {
      coverageLimited = true;
      continue;
    }

    const contentBytes = Buffer.byteLength(content.content);

    if (totalBytes + contentBytes > MAX_TOTAL_BYTES) {
      coverageLimited = true;
      break;
    }

    totalBytes += contentBytes;
    findings.push(...collectFileFindings(path, content.content));
  }

  findings.sort(
    (left, right) =>
      severityRank(right.severity) - severityRank(left.severity) ||
      left.path.localeCompare(right.path) ||
      left.category.localeCompare(right.category),
  );

  const results = findings.slice(0, MAX_FINDINGS).map(findingResult);

  if (findings.length > MAX_FINDINGS) {
    const highestSeverity: Severity = findings.some(
      (finding) => finding.severity === "Critical",
    )
      ? "Critical"
      : "High";
    results.push(
      createSecurityResult(SECRET_CHECK, {
        subject: "Additional secret findings",
        status: "Fail",
        severity: highestSeverity,
        finding: `${findings.length - MAX_FINDINGS} additional high-confidence secret findings were omitted by the report bound.`,
        recommendation:
          "Review the target locally with an approved secret-scanning workflow and rotate every affected credential.",
        evidence: [`Reported finding limit: ${MAX_FINDINGS}`],
      }),
    );
  }

  if (coverageLimited) {
    results.push(
      createSecurityResult(SECRET_CHECK, {
        subject: "Secret scan coverage",
        status: "Skipped",
        severity: "Info",
        finding:
          "Sentinel could not make a complete secret-absence claim within the repository or scan bounds.",
        recommendation:
          "Reduce unreadable or oversized inputs and rerun the bounded secret scan.",
        diagnosticCode: "SECRET_SCAN_INCOMPLETE",
      }),
    );
  } else if (results.length === 0) {
    results.push(
      createSecurityResult(SECRET_CHECK, {
        status: "Pass",
        severity: "Info",
        finding:
          "No high-confidence credential or private-key signatures were detected in the bounded non-ignored files.",
        recommendation:
          "Continue using ignored environment files and an approved secret store.",
        evidence: [
          `Files scanned: ${candidates.length}`,
          `Content scanned: ${totalBytes} bytes`,
        ],
      }),
    );
  }

  return securityExecution(results, coverageLimited);
}

export const securitySecretScanCheck: Check = {
  id: SECRET_CHECK.id,
  title: SECRET_CHECK.title,
  level: "Security",
  phase: SECRET_CHECK.phase,
  timeoutMs: SECRET_CHECK_TIMEOUT_MS,
  run: (context, signal) => checkSecrets(context.repository, signal),
};
