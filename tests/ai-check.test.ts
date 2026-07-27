import assert from "node:assert/strict";
import { test } from "vitest";

import { runSyntheticAiCheck } from "../src/ai/check.js";
import { createStructuredAiClient } from "../src/ai/client.js";
import { disabledAiSetup } from "../src/ai/config.js";
import { createScanReport } from "../src/core/result.js";
import { renderMarkdownReport } from "../src/report/markdown.js";
import {
  createFakeAiTransport,
  createFakeStructuredAiClient,
} from "./support/fake-ai-provider.js";

const CONTRACT_PATH = "synthetic/api/account-export-contract.md";
const TEST_PATH = "synthetic/tests/account-export.test.md";

function validFinding(severity = "High") {
  return {
    severity,
    finding: "The tests omit the authenticated cross-account export rejection.",
    recommendation:
      "Add a test asserting HTTP 403 for an authenticated request to another account.",
    citations: [CONTRACT_PATH, TEST_PATH],
  };
}

function availableFinding(severity = "High") {
  return {
    state: "available" as const,
    value: validFinding(severity),
    provenanceEvidence: [
      "Provider: openai; model: deterministic-fake",
      "Token usage: input 120, output 35",
    ],
  };
}

test("disabled AI is a normal skipped prerequisite", async () => {
  const execution = await runSyntheticAiCheck(disabledAiSetup());

  assert.equal(execution.incomplete, false);
  assert.equal(execution.result.status, "Skipped");
  assert.equal(execution.result.severity, "Info");
  assert.equal(execution.result.diagnosticCode, "AI_DISABLED");
});

test("a typed AI finding maps to the normalized result and Markdown report", async () => {
  const fake = createFakeStructuredAiClient(availableFinding());
  const execution = await runSyntheticAiCheck({
    kind: "ready",
    client: fake.client,
  });

  assert.equal(fake.requests.length, 1);
  assert.equal(execution.incomplete, false);
  assert.equal(execution.result.checkId, "ai.api-test-gap");
  assert.equal(execution.result.level, "API / Backend");
  assert.equal(execution.result.phase, "AI");
  assert.equal(execution.result.status, "Fail");
  assert.equal(execution.result.severity, "High");
  assert.deepEqual(execution.result.evidence, [
    `Citation: ${CONTRACT_PATH}`,
    `Citation: ${TEST_PATH}`,
    "Provider: openai; model: deterministic-fake",
    "Token usage: input 120, output 35",
  ]);

  const markdown = renderMarkdownReport(
    createScanReport({
      targetName: "synthetic",
      generatedAt: "2026-01-01T00:00:00.000Z",
      incomplete: execution.incomplete,
      results: [execution.result],
    }),
  );
  assert.match(markdown, /## API \/ Backend/);
  assert.match(markdown, /\*\*Phase:\*\* AI/);
  assert.match(markdown, /authenticated cross-account/);
  assert.match(markdown, /synthetic\/api\/account-export-contract\.md/);
});

test("medium and low AI findings map to warnings", async () => {
  for (const severity of ["Medium", "Low"]) {
    const fake = createFakeStructuredAiClient(availableFinding(severity));
    const execution = await runSyntheticAiCheck({
      kind: "ready",
      client: fake.client,
    });

    assert.equal(execution.result.status, "Warn");
    assert.equal(execution.result.severity, severity);
  }
});

test("the real client rejects structurally invalid findings and citations", async () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly value: unknown;
    readonly diagnosticCode:
      | "AI_RESPONSE_INVALID_SCHEMA"
      | "AI_RESPONSE_MISSING_CITATION"
      | "AI_RESPONSE_UNSUPPORTED_CITATION";
  }> = [
    {
      name: "unknown severity",
      value: validFinding("Urgent"),
      diagnosticCode: "AI_RESPONSE_INVALID_SCHEMA",
    },
    {
      name: "purportedly benign severity",
      value: validFinding("Info"),
      diagnosticCode: "AI_RESPONSE_INVALID_SCHEMA",
    },
    {
      name: "missing citations",
      value: {
        severity: "High",
        finding: "A gap exists.",
        recommendation: "Add a test.",
      },
      diagnosticCode: "AI_RESPONSE_MISSING_CITATION",
    },
    {
      name: "missing test evidence",
      value: {
        severity: "High",
        finding: "A gap exists.",
        recommendation: "Add a test.",
        citations: [CONTRACT_PATH],
      },
      diagnosticCode: "AI_RESPONSE_MISSING_CITATION",
    },
    {
      name: "invented path",
      value: {
        severity: "High",
        finding: "A gap exists.",
        recommendation: "Add a test.",
        citations: [CONTRACT_PATH, "synthetic/tests/invented.test.md"],
      },
      diagnosticCode: "AI_RESPONSE_UNSUPPORTED_CITATION",
    },
    {
      name: "duplicate path",
      value: {
        severity: "High",
        finding: "A gap exists.",
        recommendation: "Add a test.",
        citations: [CONTRACT_PATH, CONTRACT_PATH],
      },
      diagnosticCode: "AI_RESPONSE_MISSING_CITATION",
    },
    {
      name: "additional property",
      value: {
        ...validFinding(),
        confidence: 0.99,
      },
      diagnosticCode: "AI_RESPONSE_INVALID_SCHEMA",
    },
  ];

  for (const testCase of cases) {
    const fake = createFakeAiTransport({
      state: "available",
      value: testCase.value,
      provenance: {
        provider: "claude",
        model: "deterministic-fake",
      },
    });
    const execution = await runSyntheticAiCheck({
      kind: "ready",
      client: createStructuredAiClient(fake.transport),
    });

    assert.equal(
      execution.incomplete,
      true,
      `${testCase.name} should make the report incomplete`,
    );
    assert.equal(execution.result.status, "Skipped");
    assert.notEqual(execution.result.status, "Pass");
    assert.equal(execution.result.severity, "Info");
    assert.equal(
      execution.result.diagnosticCode,
      testCase.diagnosticCode,
      `${testCase.name} should retain its most specific safe diagnostic`,
    );
    assert.equal(
      JSON.stringify(execution.result).includes(JSON.stringify(testCase.value)),
      false,
    );
  }
});

test("unrecognized provider output fails closed and affects only the AI check", async () => {
  const fake = createFakeStructuredAiClient({
    state: "unavailable",
    diagnosticCode: "AI_RESPONSE_UNRECOGNIZED",
  });
  const execution = await runSyntheticAiCheck({
    kind: "ready",
    client: fake.client,
  });

  assert.equal(execution.incomplete, true);
  assert.equal(execution.result.status, "Skipped");
  assert.notEqual(execution.result.status, "Pass");
  assert.equal(execution.result.severity, "Info");
  assert.equal(execution.result.diagnosticCode, "AI_RESPONSE_UNRECOGNIZED");
});

test("provider failures affect only the AI check", async () => {
  const fake = createFakeStructuredAiClient({
    state: "unavailable",
    diagnosticCode: "AI_PROVIDER_TIMEOUT",
  });
  const execution = await runSyntheticAiCheck({
    kind: "ready",
    client: fake.client,
  });

  assert.equal(execution.incomplete, true);
  assert.equal(execution.result.status, "Skipped");
  assert.equal(execution.result.severity, "Info");
  assert.equal(execution.result.diagnosticCode, "AI_PROVIDER_TIMEOUT");
});

test("unexpected client exceptions are isolated without exposing their message", async () => {
  const sensitiveMessage = "provider-failure-" + Date.now().toString();
  const execution = await runSyntheticAiCheck({
    kind: "ready",
    client: {
      generate() {
        return Promise.reject(new Error(sensitiveMessage));
      },
    },
  });

  assert.equal(execution.incomplete, true);
  assert.equal(execution.result.diagnosticCode, "AI_PROVIDER_ERROR");
  assert.equal(
    JSON.stringify(execution.result).includes(sensitiveMessage),
    false,
  );
});
