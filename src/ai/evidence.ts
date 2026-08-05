import { Buffer } from "node:buffer";
import { isAbsolute, relative, sep } from "node:path";

import type { SentinelConfig } from "../config/schema.js";
import {
  readRepositoryText,
  type RepositoryInspection,
} from "../repository/inspection.js";

const MAX_EVIDENCE_BYTES = 8 * 1024;
const MAX_CONTRACT_BYTES = 5 * 1024;
const MAX_TEST_CANDIDATES = 12;
const MAX_TEST_CANDIDATE_BYTES = 16 * 1024;

const SOURCE_TEST_PATTERN =
  /\.(?:spec|test)\.(?:[cm]?[jt]sx?|py|go|rb|rs|java|kt|kts|scala|swift|php|cs|c|cc|cpp|cxx|h|hpp|sh|bash)$/i;
const CONVENTIONAL_TEST_SOURCE_PATTERN =
  /\.(?:[cm]?[jt]sx?|py|go|rb|rs|java|kt|kts|scala|swift|php|cs|c|cc|cpp|cxx|h|hpp|sh|bash)$/i;

const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{60,})\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
  /\bsk_live_[A-Za-z0-9]{16,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
];

const PRIVATE_KEY_BLOCK =
  /-----BEGIN ((?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----[\s\S]*?-----END \1-----/g;
const PRIVATE_KEY_MARKER =
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----|-----BEGIN PGP PRIVATE KEY BLOCK-----|-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----|-----END PGP PRIVATE KEY BLOCK-----/g;
const SECRET_NAME =
  "(?:access[_-]?key|access[_-]?token|api[_-]?key|authorization|client[_-]?secret|cookie|cookies|credential|headers?|password|passwd|private[_-]?key|proxy[_-]?authorization|refresh[_-]?token|secret|set[_-]?cookie|token|x[_-]?api[_-]?key)";
const SECRET_ASSIGNMENT = new RegExp(
  `((?:(?:["']?${SECRET_NAME}["']?)|(?:[A-Za-z_$][\\w$]*\\.)+${SECRET_NAME})\\s*[:=]\\s*)("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\\\`(?:\\\\.|[^\\\`\\\\])*\\\`|\\[REDACTED(?: [A-Z ]+)?\\]|[^\\r\\n,;}\\]]+)`,
  "gi",
);
const AUTHORIZATION_VALUE =
  /\b(?:basic|bearer)\s+[A-Za-z0-9!#$%&'*+\-.^_`|~/:=]+/gi;
const REDACTED_VALUE = /^\[REDACTED(?: [A-Z ]+)?\]$/i;

export interface AiEvidenceDocument {
  readonly path: string;
  readonly kind: "contract" | "test";
  readonly content: string;
}

export type AiEvidenceSelection =
  | {
      readonly state: "available";
      readonly documents: readonly [AiEvidenceDocument, AiEvidenceDocument];
    }
  | {
      readonly state: "insufficient";
      readonly diagnosticCode: "AI_EVIDENCE_INSUFFICIENT";
      readonly finding: string;
      readonly recommendation: string;
    };

function repositoryPath(
  inspection: RepositoryInspection,
  absolutePath: string,
): string | undefined {
  const relativePath = relative(inspection.root, absolutePath);

  if (
    relativePath.length === 0 ||
    isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`)
  ) {
    return undefined;
  }

  const normalized = relativePath.split(sep).join("/");
  return isSafeEvidencePath(normalized) ? normalized : undefined;
}

function isSafeEvidencePath(path: string): boolean {
  const hasControlCharacter = [...path].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });

  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.split("/").includes("..") &&
    !hasControlCharacter
  );
}

function isTestFile(path: string): boolean {
  if (!isSafeEvidencePath(path)) {
    return false;
  }

  const segments = path.split("/");
  const fileName = segments.at(-1) ?? "";
  const inConventionalDirectory = segments
    .slice(0, -1)
    .some((segment) =>
      ["__tests__", "spec", "test", "tests"].includes(segment.toLowerCase()),
    );

  return (
    SOURCE_TEST_PATTERN.test(fileName) ||
    /^test_.+\.py$/i.test(fileName) ||
    /_test\.(?:go|py)$/i.test(fileName) ||
    (inConventionalDirectory &&
      !fileName.startsWith(".") &&
      CONVENTIONAL_TEST_SOURCE_PATTERN.test(fileName))
  );
}

function hasUnsafeCredentialContent(content: string): boolean {
  PRIVATE_KEY_BLOCK.lastIndex = 0;
  PRIVATE_KEY_MARKER.lastIndex = 0;
  AUTHORIZATION_VALUE.lastIndex = 0;
  SECRET_ASSIGNMENT.lastIndex = 0;

  if (
    PRIVATE_KEY_BLOCK.test(content) ||
    PRIVATE_KEY_MARKER.test(content) ||
    AUTHORIZATION_VALUE.test(content)
  ) {
    return true;
  }

  for (const pattern of CREDENTIAL_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) {
      return true;
    }
  }

  for (const match of content.matchAll(SECRET_ASSIGNMENT)) {
    const value = match[2]?.trim();
    if (value !== undefined && !REDACTED_VALUE.test(value)) {
      return true;
    }
  }

  return false;
}

export function sanitizeAiEvidenceText(content: string): string | undefined {
  let redacted = content
    .replace(PRIVATE_KEY_BLOCK, "[REDACTED PRIVATE KEY]")
    .replace(PRIVATE_KEY_MARKER, "[REDACTED PRIVATE KEY MARKER]");

  for (const pattern of CREDENTIAL_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED CREDENTIAL]");
  }

  redacted = redacted
    .replace(
      SECRET_ASSIGNMENT,
      (match: string, prefix: string, value: string | undefined) =>
        value !== undefined && REDACTED_VALUE.test(value.trim())
          ? match
          : `${prefix}[REDACTED]`,
    )
    .replace(AUTHORIZATION_VALUE, "[REDACTED AUTHORIZATION]")
    .replace(/\bhttps?:\/\/[^/\s:@]+:[^/\s@]+@/gi, "https://[REDACTED]@");

  return hasUnsafeCredentialContent(redacted) ? undefined : redacted;
}

export function isSafeAiOutputText(content: string): boolean {
  const sanitized = sanitizeAiEvidenceText(content);
  return sanitized !== undefined && sanitized === content;
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) {
    return value;
  }

  let lower = 0;
  let upper = value.length;

  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    if (Buffer.byteLength(value.slice(0, middle), "utf8") <= maxBytes) {
      lower = middle;
    } else {
      upper = middle - 1;
    }
  }

  return value.slice(0, lower).trimEnd();
}

function contractTerms(content: string): readonly string[] {
  const terms = new Set<string>();
  const pathPattern = /["']?(\/[A-Za-z0-9_{}./:-]+)["']?\s*:/g;
  const operationPattern =
    /["']?operationId["']?\s*:\s*["']?([A-Za-z][A-Za-z0-9_-]+)/gi;

  for (const match of content.matchAll(pathPattern)) {
    for (const segment of (match[1] ?? "").split(/[/{}._:-]+/)) {
      if (segment.length >= 3 && segment.toLowerCase() !== "api") {
        terms.add(segment.toLowerCase());
      }
    }
  }

  for (const match of content.matchAll(operationPattern)) {
    for (const segment of (match[1] ?? "").split(/(?=[A-Z])|[_-]+/)) {
      if (segment.length >= 3 && segment.toLowerCase() !== "get") {
        terms.add(segment.toLowerCase());
      }
    }
  }

  return [...terms];
}

function relevanceScore(
  path: string,
  content: string,
  terms: readonly string[],
): number {
  const searchable = `${path}\n${content}`.toLowerCase();
  return terms.reduce(
    (score, term) => score + (searchable.includes(term) ? 1 : 0),
    0,
  );
}

function evidenceBytes(documents: readonly AiEvidenceDocument[]): number {
  return documents.reduce(
    (total, document) =>
      total +
      Buffer.byteLength(document.path, "utf8") +
      Buffer.byteLength(document.content, "utf8"),
    0,
  );
}

function insufficient(
  finding: string,
  recommendation: string,
): AiEvidenceSelection {
  return {
    state: "insufficient",
    diagnosticCode: "AI_EVIDENCE_INSUFFICIENT",
    finding,
    recommendation,
  };
}

export async function selectTargetAiEvidence(
  inspection: RepositoryInspection,
  api: SentinelConfig["api"],
  signal: AbortSignal,
): Promise<AiEvidenceSelection> {
  if (api === undefined) {
    return insufficient(
      "AI semantic test-gap analysis could not run because no target OpenAPI contract is configured.",
      "Configure api.openApiPath and include related readable tests before enabling AI analysis.",
    );
  }

  const contractPath = repositoryPath(inspection, api.openApiPath);
  if (contractPath === undefined) {
    return insufficient(
      "AI semantic test-gap analysis could not establish a safe target-relative OpenAPI evidence path.",
      "Keep api.openApiPath inside the scanned target and rerun the scan.",
    );
  }

  signal.throwIfAborted();
  const contract = await readRepositoryText(inspection, contractPath);
  if (contract.state !== "ok" || contract.content.trim().length === 0) {
    return insufficient(
      "AI semantic test-gap analysis could not read a nonempty target OpenAPI contract within the evidence bounds.",
      "Provide a readable, nonempty OpenAPI contract inside the target and rerun the scan.",
    );
  }

  const sanitizedContract = sanitizeAiEvidenceText(contract.content);
  if (
    sanitizedContract === undefined ||
    hasUnsafeCredentialContent(contractPath)
  ) {
    return insufficient(
      "AI semantic test-gap analysis could not safely sanitize the configured target contract evidence.",
      "Remove credential-bearing paths or unsupported credential syntax from the bounded evidence and rerun the AI check.",
    );
  }
  const terms = contractTerms(sanitizedContract);
  if (terms.length === 0) {
    return insufficient(
      "AI semantic test-gap analysis could not identify API operations in the configured target contract.",
      "Provide an OpenAPI contract with explicit path operations and rerun the scan.",
    );
  }

  const candidatePaths = inspection.entries
    .filter((entry) => entry.kind === "file" && isTestFile(entry.path))
    .map((entry) => entry.path)
    .sort()
    .slice(0, MAX_TEST_CANDIDATES);
  let selected:
    | {
        readonly path: string;
        readonly content: string;
        readonly score: number;
      }
    | undefined;

  for (const path of candidatePaths) {
    signal.throwIfAborted();
    const candidate = await readRepositoryText(
      inspection,
      path,
      MAX_TEST_CANDIDATE_BYTES,
    );

    if (candidate.state !== "ok" || candidate.content.trim().length === 0) {
      continue;
    }

    const sanitized = sanitizeAiEvidenceText(candidate.content);
    if (sanitized === undefined || hasUnsafeCredentialContent(path)) {
      continue;
    }
    const score = relevanceScore(path, sanitized, terms);
    if (
      score > 0 &&
      (selected === undefined ||
        score > selected.score ||
        (score === selected.score && path.localeCompare(selected.path) < 0))
    ) {
      selected = {
        path,
        content: sanitized,
        score,
      };
    }
  }

  if (selected === undefined) {
    return insufficient(
      "AI semantic test-gap analysis found no readable test artifact related to the configured target contract within its bounded selection.",
      "Add API tests whose names or contents reference configured contract operations, then rerun the AI check.",
    );
  }

  const contractContent = truncateUtf8(sanitizedContract, MAX_CONTRACT_BYTES);
  const fixedBytes =
    Buffer.byteLength(contractPath, "utf8") +
    Buffer.byteLength(selected.path, "utf8") +
    Buffer.byteLength(contractContent, "utf8");
  const testBudget = Math.max(0, MAX_EVIDENCE_BYTES - fixedBytes);
  const testContent = truncateUtf8(selected.content, testBudget);
  const documents: readonly [AiEvidenceDocument, AiEvidenceDocument] = [
    {
      path: contractPath,
      kind: "contract",
      content: contractContent,
    },
    {
      path: selected.path,
      kind: "test",
      content: testContent,
    },
  ];

  if (
    testContent.trim().length === 0 ||
    evidenceBytes(documents) > MAX_EVIDENCE_BYTES
  ) {
    return insufficient(
      "AI semantic test-gap evidence could not fit within the fixed input bound.",
      "Reduce the selected OpenAPI contract or related test artifact and rerun the AI check.",
    );
  }

  return {
    state: "available",
    documents,
  };
}
