import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

import { disabledAiSetup } from "../src/ai/config.js";
import { createSentinelConfigSchema } from "../src/config/schema.js";
import type { Check, CheckExecution, ScanContext } from "../src/core/check.js";
import {
  ANALYSIS_LEVELS,
  createCheckResult,
  type AnalysisLevel,
} from "../src/core/result.js";
import { runChecks } from "../src/core/runner.js";

afterEach(() => {
  vi.useRealTimers();
});

function createContext(): ScanContext {
  return {
    config: createSentinelConfigSchema(process.cwd()).parse({}),
    ai: disabledAiSetup(),
    resolveEnvironmentReference: () => undefined,
    fetch: () => Promise.reject(new Error("Unexpected fetch.")),
    reachability: {
      api: {
        state: "not-configured",
      },
      ui: {
        state: "not-configured",
      },
    },
  };
}

function createExecution(check: Check): CheckExecution {
  return {
    results: [
      createCheckResult({
        checkId: check.id,
        title: check.title,
        level: check.level,
        phase: check.phase,
        status: "Pass",
        severity: "Info",
        finding: `${check.title} completed.`,
        recommendation: "Keep the check enabled.",
      }),
    ],
    incomplete: false,
  };
}

function createTestCheck(
  id: string,
  level: AnalysisLevel,
  run?: Check["run"],
): Check {
  const check: Check = {
    id,
    title: `Check ${id}`,
    level,
    phase: "static",
    timeoutMs: 1_000,
    run: (context, signal) =>
      run?.(context, signal) ?? Promise.resolve(createExecution(check)),
  };
  return check;
}

test("all four analysis levels begin concurrently", async () => {
  const started = new Set<AnalysisLevel>();
  let releaseChecks: (() => void) | undefined;
  let reportAllStarted: (() => void) | undefined;
  const release = new Promise<void>((resolve) => {
    releaseChecks = resolve;
  });
  const allStarted = new Promise<void>((resolve) => {
    reportAllStarted = resolve;
  });
  const checks: Check[] = [];
  ANALYSIS_LEVELS.forEach((level, index) => {
    const check = createTestCheck(`level-${index}`, level, async () => {
      started.add(level);
      if (started.size === ANALYSIS_LEVELS.length) {
        reportAllStarted?.();
      }
      await release;
      return createExecution(check);
    });
    checks.push(check);
  });

  const executionPromise = runChecks(checks, createContext());
  let startTimeout: NodeJS.Timeout | undefined;
  const concurrentStart = await Promise.race([
    allStarted.then(() => true),
    new Promise<boolean>((resolve) => {
      startTimeout = setTimeout(() => resolve(false), 500);
    }),
  ]);
  if (startTimeout !== undefined) {
    clearTimeout(startTimeout);
  }
  releaseChecks?.();
  const execution = await executionPromise;

  assert.equal(concurrentStart, true);
  assert.deepEqual(started, new Set(ANALYSIS_LEVELS));
  assert.equal(execution.results.length, ANALYSIS_LEVELS.length);
});

test("checks remain sequential within each analysis level", async () => {
  const events: string[] = [];
  const first = createTestCheck("first", "API / Backend", async () => {
    events.push("first-start");
    await Promise.resolve();
    events.push("first-end");
    return createExecution(first);
  });
  const second = createTestCheck("second", "API / Backend", () => {
    events.push("second-start");
    return Promise.resolve(createExecution(second));
  });

  await runChecks([first, second], createContext());

  assert.deepEqual(events, ["first-start", "first-end", "second-start"]);
});

test("result ordering follows analysis level and registration order", async () => {
  const checks = [
    createTestCheck("ui", "UI / Browser"),
    createTestCheck("api-second", "API / Backend"),
    createTestCheck("security", "Security"),
    createTestCheck("code", "Code & Repository"),
    createTestCheck("api-first", "API / Backend"),
  ];

  const execution = await runChecks(checks, createContext());

  assert.deepEqual(
    execution.results.map((result) => result.checkId),
    ["code", "security", "api-second", "api-first", "ui"],
  );
});

test("a timed-out check aborts and degrades to one row before later checks run", async () => {
  vi.useFakeTimers();
  let aborted = false;
  let laterCheckRan = false;
  const timedOut = createTestCheck(
    "timed-out",
    "Code & Repository",
    (_context, signal) =>
      new Promise<CheckExecution>(() => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
      }),
  );
  const timedOutWithLimit: Check = {
    ...timedOut,
    timeoutMs: 10,
  };
  const later = createTestCheck("later", "Code & Repository", () => {
    laterCheckRan = true;
    return Promise.resolve(createExecution(later));
  });

  const executionPromise = runChecks(
    [timedOutWithLimit, later],
    createContext(),
  );
  await vi.advanceTimersByTimeAsync(11);
  const execution = await executionPromise;

  assert.equal(aborted, true);
  assert.equal(laterCheckRan, true);
  assert.equal(execution.incomplete, true);
  assert.equal(execution.results.length, 2);
  assert.equal(execution.results[0]?.diagnosticCode, "CHECK_TIMEOUT");
  assert.equal(execution.results[0]?.status, "Skipped");
  assert.equal(execution.results[0]?.severity, "Info");
  assert.equal(execution.results[1]?.checkId, "later");
});

test("exceptions and invalid outputs each degrade to one isolated row", async () => {
  const thrown = createTestCheck("thrown", "Security", () => {
    throw new Error("Sensitive internal failure.");
  });
  const empty = createTestCheck("empty", "Security", () =>
    Promise.resolve({
      results: [],
      incomplete: false,
    }),
  );
  const inconsistent = createTestCheck("inconsistent", "Security", () =>
    Promise.resolve({
      results: [
        createCheckResult({
          checkId: "other",
          title: "Other",
          level: "Security",
          phase: "static",
          status: "Pass",
          severity: "Info",
          finding: "Mismatched metadata.",
          recommendation: "Fix the check.",
        }),
      ],
      incomplete: false,
    }),
  );
  const invalidResult = createTestCheck("invalid-result", "Security", () =>
    Promise.resolve({
      results: [
        {
          checkId: "invalid-result",
          title: "Check invalid-result",
          level: "Security",
          phase: "static",
          status: "Pass",
          severity: "Info",
          finding: "The result is malformed.",
          recommendation: "",
        },
      ],
      incomplete: false,
    } as unknown as CheckExecution),
  );
  const later = createTestCheck("later", "Security");

  const execution = await runChecks(
    [thrown, empty, inconsistent, invalidResult, later],
    createContext(),
  );

  assert.equal(execution.incomplete, true);
  assert.deepEqual(
    execution.results.map((result) => result.diagnosticCode),
    [
      "CHECK_EXECUTION_ERROR",
      "CHECK_EXECUTION_ERROR",
      "CHECK_EXECUTION_ERROR",
      "CHECK_EXECUTION_ERROR",
      undefined,
    ],
  );
  assert.equal(
    JSON.stringify(execution.results).includes("Sensitive internal failure"),
    false,
  );
});

test("a handled incomplete execution preserves its result and marks the run incomplete", async () => {
  const check = createTestCheck("handled", "API / Backend", () =>
    Promise.resolve({
      results: [
        createCheckResult({
          checkId: "handled",
          title: "Check handled",
          level: "API / Backend",
          phase: "static",
          status: "Skipped",
          severity: "Info",
          finding: "A dependency failed safely.",
          recommendation: "Retry later.",
          diagnosticCode: "HANDLED_FAILURE",
        }),
      ],
      incomplete: true,
    }),
  );

  const execution = await runChecks([check], createContext());

  assert.equal(execution.incomplete, true);
  assert.equal(execution.results.length, 1);
  assert.equal(execution.results[0]?.diagnosticCode, "HANDLED_FAILURE");
});
