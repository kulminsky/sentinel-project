import type { CheckExecution } from "../../core/check.js";
import {
  createCheckResult,
  type CheckPhase,
  type CheckResult,
  type CheckStatus,
  type Severity,
} from "../../core/result.js";

export interface SecurityCheckMetadata {
  readonly id: string;
  readonly title: string;
  readonly phase: CheckPhase;
}

interface SecurityResultInput {
  readonly status: CheckStatus;
  readonly severity: Severity;
  readonly finding: string;
  readonly recommendation: string;
  readonly subject?: string;
  readonly evidence?: string[];
  readonly diagnosticCode?: string;
  readonly durationMs?: number;
}

export function createSecurityResult(
  metadata: SecurityCheckMetadata,
  input: SecurityResultInput,
): CheckResult {
  return createCheckResult({
    checkId: metadata.id,
    title: metadata.title,
    level: "Security",
    phase: metadata.phase,
    ...input,
  });
}

export function securityExecution(
  results: readonly CheckResult[],
  incomplete = false,
): CheckExecution {
  return {
    results,
    incomplete,
  };
}
