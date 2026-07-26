import assert from "node:assert/strict";
import { test } from "vitest";

import {
  createCheckResult,
  parseCheckResult,
  type CheckResult,
} from "../src/core/result.js";

type RequiredReportField = "status" | "finding" | "severity" | "recommendation";
type IsRequired<Key extends keyof CheckResult> =
  Pick<CheckResult, Key> extends Required<Pick<CheckResult, Key>>
    ? true
    : never;

const REQUIRED_FIELD_CONTRACT: {
  [Key in RequiredReportField]: IsRequired<Key>;
} = {
  status: true,
  finding: true,
  severity: true,
  recommendation: true,
};

function validResult(): CheckResult {
  return createCheckResult({
    checkId: "repository.readme",
    title: "Repository README",
    level: "Code & Repository",
    phase: "static",
    status: "Pass",
    severity: "Info",
    finding: "A README is present.",
    recommendation: "Keep it current.",
  });
}

test("required report fields are non-optional in the derived type", () => {
  assert.deepEqual(Object.keys(REQUIRED_FIELD_CONTRACT), [
    "status",
    "finding",
    "severity",
    "recommendation",
  ]);
});

test("createCheckResult accepts and normalizes a valid result", () => {
  const result = createCheckResult({
    ...validResult(),
    finding: "  A README is present.  ",
  });

  assert.equal(result.status, "Pass");
  assert.equal(result.finding, "A README is present.");
});

test("runtime parsing rejects every missing required report field", () => {
  for (const field of [
    "status",
    "finding",
    "severity",
    "recommendation",
  ] as const) {
    const candidate: Record<string, unknown> = {
      ...validResult(),
    };
    delete candidate[field];

    assert.throws(() => parseCheckResult(candidate));
  }
});

test("runtime parsing rejects null and wrong types for every required report field", () => {
  for (const field of [
    "status",
    "finding",
    "severity",
    "recommendation",
  ] as const) {
    for (const invalidValue of [null, 42]) {
      assert.throws(() =>
        parseCheckResult({
          ...validResult(),
          [field]: invalidValue,
        }),
      );
    }
  }
});

test("runtime parsing rejects blank, unknown, and extra values", () => {
  const invalidResults: unknown[] = [
    {
      ...validResult(),
      finding: " \n ",
    },
    {
      ...validResult(),
      recommendation: "\t",
    },
    {
      ...validResult(),
      status: "Ignored",
    },
    {
      ...validResult(),
      severity: "Unknown",
    },
    {
      ...validResult(),
      level: "Infrastructure",
    },
    {
      ...validResult(),
      phase: "dynamic",
    },
    {
      ...validResult(),
      unsupported: true,
    },
  ];

  for (const invalidResult of invalidResults) {
    assert.throws(() => parseCheckResult(invalidResult));
  }
});

test("runtime parsing rejects malformed optional fields", () => {
  const invalidResults: unknown[] = [
    {
      ...validResult(),
      subject: " ",
    },
    {
      ...validResult(),
      evidence: [],
    },
    {
      ...validResult(),
      evidence: [" "],
    },
    {
      ...validResult(),
      durationMs: -1,
    },
    {
      ...validResult(),
      durationMs: Number.POSITIVE_INFINITY,
    },
    {
      ...validResult(),
      diagnosticCode: "",
    },
  ];

  for (const invalidResult of invalidResults) {
    assert.throws(() => parseCheckResult(invalidResult));
  }
});

test("Skipped rows require Info severity and substantive text", () => {
  const skipped = createCheckResult({
    ...validResult(),
    status: "Skipped",
    severity: "Info",
    finding: "The target service is not configured.",
    recommendation: "Configure the service to enable this check.",
  });

  assert.equal(skipped.status, "Skipped");
  assert.throws(() =>
    parseCheckResult({
      ...skipped,
      finding: "",
    }),
  );
  assert.throws(() =>
    parseCheckResult({
      ...skipped,
      recommendation: "",
    }),
  );
  assert.throws(() =>
    parseCheckResult({
      ...skipped,
      severity: "Low",
    }),
  );
});
