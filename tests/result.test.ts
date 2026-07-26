import assert from "node:assert/strict";
import test from "node:test";

import { createCheckResult } from "../src/core/result.js";

test("createCheckResult accepts a valid result", () => {
  const result = createCheckResult({
    checkId: "repository.readme",
    title: "Repository README",
    level: "Code & Repository",
    phase: "static",
    status: "Pass",
    severity: "Info",
    finding: "A README is present.",
    recommendation: "Keep it current.",
  });

  assert.equal(result.status, "Pass");
});

test("createCheckResult rejects empty required text", () => {
  assert.throws(
    () =>
      createCheckResult({
        checkId: "",
        title: "Repository README",
        level: "Code & Repository",
        phase: "static",
        status: "Warn",
        severity: "Low",
        finding: "A README is missing.",
        recommendation: "Add a README.",
      }),
    /checkId must not be empty/,
  );
});

test("createCheckResult requires Info severity for Pass and Skipped", () => {
  assert.throws(
    () =>
      createCheckResult({
        checkId: "repository.readme",
        title: "Repository README",
        level: "Code & Repository",
        phase: "static",
        status: "Pass",
        severity: "Low",
        finding: "A README is present.",
        recommendation: "Keep it current.",
      }),
    /Pass results must use Info severity/,
  );
});
