import type { Check, CheckExecution, ScanContext } from "../../core/check.js";
import {
  createCheckResult,
  type CheckResult,
  type CheckResultInput,
} from "../../core/result.js";

export interface RepositoryCheckMetadata {
  readonly id: string;
  readonly title: string;
  readonly timeoutMs?: number;
}

type RepositoryResultInput = Omit<
  CheckResultInput,
  "checkId" | "level" | "phase" | "title"
>;

export function createRepositoryResult(
  metadata: RepositoryCheckMetadata,
  input: RepositoryResultInput,
): CheckResult {
  return createCheckResult({
    checkId: metadata.id,
    title: metadata.title,
    level: "Code & Repository",
    phase: "static",
    ...input,
  });
}

export function createRepositoryCheck(
  metadata: RepositoryCheckMetadata,
  run: (context: ScanContext, signal: AbortSignal) => Promise<CheckExecution>,
): Check {
  return {
    id: metadata.id,
    title: metadata.title,
    level: "Code & Repository",
    phase: "static",
    timeoutMs: metadata.timeoutMs ?? 5_000,
    run,
  };
}

export function execution(
  results: readonly CheckResult[],
  incomplete = false,
): CheckExecution {
  return {
    results,
    incomplete,
  };
}

export function incompleteInventoryResult(
  metadata: RepositoryCheckMetadata,
  subject: string,
): CheckExecution {
  return execution(
    [
      createRepositoryResult(metadata, {
        subject,
        status: "Skipped",
        severity: "Info",
        finding:
          "Sentinel could not make a reliable absence claim because the bounded repository inventory was incomplete.",
        recommendation:
          "Review unreadable or unusually large repository areas, then rerun the scan.",
        diagnosticCode: "REPOSITORY_INVENTORY_INCOMPLETE",
      }),
    ],
    true,
  );
}

export function unavailableFileResult(
  metadata: RepositoryCheckMetadata,
  subject: string,
): CheckExecution {
  return execution(
    [
      createRepositoryResult(metadata, {
        subject,
        status: "Skipped",
        severity: "Info",
        finding:
          "Sentinel could not inspect this file within the bounded repository reader.",
        recommendation:
          "Ensure the file is readable and no larger than 128 KiB, then rerun the scan.",
        diagnosticCode: "REPOSITORY_FILE_UNAVAILABLE",
      }),
    ],
    true,
  );
}
