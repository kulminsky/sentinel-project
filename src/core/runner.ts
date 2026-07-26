import {
  ANALYSIS_LEVELS,
  createCheckResult,
  parseCheckResult,
  type CheckResult,
} from "./result.js";
import type { Check, CheckExecution, ScanContext } from "./check.js";

export interface RunnerExecution {
  readonly results: readonly CheckResult[];
  readonly incomplete: boolean;
}

type CheckFailureCode = "CHECK_TIMEOUT" | "CHECK_EXECUTION_ERROR";

class CheckTimeoutError extends Error {}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeResult(
  check: Check,
  candidate: unknown,
  durationMs: number,
): CheckResult {
  const result = parseCheckResult(candidate);

  if (
    result.checkId !== check.id ||
    result.title !== check.title ||
    result.level !== check.level ||
    result.phase !== check.phase
  ) {
    throw new Error("Check result metadata does not match its check.");
  }

  return createCheckResult({
    ...result,
    durationMs: result.durationMs ?? durationMs,
  });
}

function createFailureExecution(
  check: Check,
  diagnosticCode: CheckFailureCode,
  durationMs: number,
): CheckExecution {
  const timedOut = diagnosticCode === "CHECK_TIMEOUT";

  return {
    results: [
      createCheckResult({
        checkId: check.id,
        title: check.title,
        level: check.level,
        phase: check.phase,
        status: "Skipped",
        severity: "Info",
        finding: timedOut
          ? "Sentinel stopped this check after its execution timeout."
          : "Sentinel could not complete this check because of an internal execution error.",
        recommendation: timedOut
          ? "Review the check dependency and retry the scan."
          : "Review the Sentinel execution diagnostic and retry the scan.",
        durationMs,
        diagnosticCode,
      }),
    ],
    incomplete: true,
  };
}

function normalizeExecution(
  check: Check,
  execution: CheckExecution,
  durationMs: number,
): CheckExecution {
  const candidate: unknown = execution;

  if (
    !isRecord(candidate) ||
    typeof candidate["incomplete"] !== "boolean" ||
    !Array.isArray(candidate["results"]) ||
    candidate["results"].length === 0
  ) {
    throw new Error("Invalid check execution.");
  }

  const results = candidate["results"].map((result: unknown) =>
    normalizeResult(check, result, durationMs),
  );

  return {
    results,
    incomplete: candidate["incomplete"],
  };
}

async function runCheck(
  check: Check,
  context: ScanContext,
): Promise<CheckExecution> {
  const startedAt = performance.now();

  if (!Number.isInteger(check.timeoutMs) || check.timeoutMs <= 0) {
    return createFailureExecution(
      check,
      "CHECK_EXECUTION_ERROR",
      elapsedMilliseconds(startedAt),
    );
  }

  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new CheckTimeoutError());
    }, check.timeoutMs);
  });
  const executionPromise = Promise.resolve().then(() =>
    check.run(context, controller.signal),
  );

  try {
    const execution = await Promise.race([executionPromise, timeoutPromise]);
    return normalizeExecution(check, execution, elapsedMilliseconds(startedAt));
  } catch (error: unknown) {
    controller.abort();
    return createFailureExecution(
      check,
      error instanceof CheckTimeoutError
        ? "CHECK_TIMEOUT"
        : "CHECK_EXECUTION_ERROR",
      elapsedMilliseconds(startedAt),
    );
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function runLevel(
  checks: readonly Check[],
  context: ScanContext,
): Promise<RunnerExecution> {
  const results: CheckResult[] = [];
  let incomplete = false;

  for (const check of checks) {
    const execution = await runCheck(check, context);
    results.push(...execution.results);
    incomplete ||= execution.incomplete;
  }

  return {
    results,
    incomplete,
  };
}

export async function runChecks(
  checks: readonly Check[],
  context: ScanContext,
): Promise<RunnerExecution> {
  const levels = await Promise.all(
    ANALYSIS_LEVELS.map((level) =>
      runLevel(
        checks.filter((check) => check.level === level),
        context,
      ),
    ),
  );

  return {
    results: levels.flatMap((execution) => execution.results),
    incomplete: levels.some((execution) => execution.incomplete),
  };
}
