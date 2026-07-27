import assert from "node:assert/strict";
import { test } from "vitest";

import { runTargetAiCheck } from "../src/ai/check.js";
import { createStructuredAiClient } from "../src/ai/client.js";
import { disabledAiSetup } from "../src/ai/config.js";
import type { AiEvidenceSelection } from "../src/ai/evidence.js";
import { createScanReport } from "../src/core/result.js";
import { renderMarkdownReport } from "../src/report/markdown.js";
import {
  createFakeAiTransport,
  createFakeStructuredAiClient,
} from "./support/fake-ai-provider.js";

const CONTRACT_PATH = "openapi.json";
const TEST_PATH = "tests/api.test.ts";
const TARGET_EVIDENCE: AiEvidenceSelection = {
  state: "available",
  documents: [
    {
      path: CONTRACT_PATH,
      kind: "contract",
      content:
        '{"openapi":"3.1.0","paths":{"/accounts/{accountId}/export":{"get":{"responses":{"403":{"description":"Cross-account access denied"}}}}}}',
    },
    {
      path: TEST_PATH,
      kind: "test",
      content:
        'test("owner export", async () => expect(await exportAccount("own")).toHaveStatus(200));',
    },
  ],
};

function validFinding(severity = "High") {
  return {
    outcome: "gap",
    severity,
    finding: "The tests omit the authenticated cross-account export rejection.",
    recommendation:
      "Add a test asserting HTTP 403 for an authenticated request to another account.",
    citations: [CONTRACT_PATH, TEST_PATH],
  };
}

function noSupportedGap() {
  return {
    outcome: "no_supported_gap",
    severity: null,
    finding: null,
    recommendation: null,
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
  const execution = await runTargetAiCheck(disabledAiSetup());

  assert.equal(execution.incomplete, false);
  assert.equal(execution.result.status, "Skipped");
  assert.equal(execution.result.severity, "Info");
  assert.equal(execution.result.diagnosticCode, "AI_DISABLED");
});

test("a typed AI finding maps to the normalized result and Markdown report", async () => {
  const fake = createFakeStructuredAiClient(availableFinding());
  const execution = await runTargetAiCheck(
    {
      kind: "ready",
      client: fake.client,
    },
    TARGET_EVIDENCE,
  );

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
      targetName: "target",
      generatedAt: "2026-01-01T00:00:00.000Z",
      incomplete: execution.incomplete,
      results: [execution.result],
    }),
  );
  assert.match(markdown, /## API \/ Backend/);
  assert.match(markdown, /\*\*Phase:\*\* AI/);
  assert.match(markdown, /authenticated cross-account/);
  assert.match(markdown, /openapi\.json/);
});

test("medium and low AI findings map to warnings", async () => {
  for (const severity of ["Medium", "Low"]) {
    const fake = createFakeStructuredAiClient(availableFinding(severity));
    const execution = await runTargetAiCheck(
      {
        kind: "ready",
        client: fake.client,
      },
      TARGET_EVIDENCE,
    );

    assert.equal(execution.result.status, "Warn");
    assert.equal(execution.result.severity, severity);
  }
});

test("a supported no-gap outcome is informational and does not invent a finding", async () => {
  const fake = createFakeAiTransport({
    state: "available",
    value: noSupportedGap(),
    provenance: {
      provider: "openai",
      model: "deterministic-fake",
    },
  });
  const execution = await runTargetAiCheck(
    {
      kind: "ready",
      client: createStructuredAiClient(fake.transport),
    },
    TARGET_EVIDENCE,
  );

  assert.equal(fake.requests.length, 1);
  assert.equal(execution.incomplete, false);
  assert.equal(execution.result.status, "Skipped");
  assert.equal(execution.result.severity, "Info");
  assert.equal(execution.result.diagnosticCode, "AI_NO_SUPPORTED_GAP");
  assert.match(execution.result.finding, /did not support a concrete/);
  assert.deepEqual(execution.result.evidence, [
    `Citation: ${CONTRACT_PATH}`,
    `Citation: ${TEST_PATH}`,
    "Provider: openai; model: deterministic-fake",
  ]);
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
        outcome: "gap",
        severity: "High",
        finding: "A gap exists.",
        recommendation: "Add a test.",
      },
      diagnosticCode: "AI_RESPONSE_MISSING_CITATION",
    },
    {
      name: "missing test evidence",
      value: {
        outcome: "gap",
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
        outcome: "gap",
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
        outcome: "gap",
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
    {
      name: "gap with null fields",
      value: {
        ...noSupportedGap(),
        outcome: "gap",
      },
      diagnosticCode: "AI_RESPONSE_INVALID_SCHEMA",
    },
    {
      name: "no gap with a finding",
      value: {
        ...validFinding(),
        outcome: "no_supported_gap",
      },
      diagnosticCode: "AI_RESPONSE_INVALID_SCHEMA",
    },
    {
      name: "unknown outcome",
      value: {
        ...noSupportedGap(),
        outcome: "unknown",
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
    const execution = await runTargetAiCheck(
      {
        kind: "ready",
        client: createStructuredAiClient(fake.transport),
      },
      TARGET_EVIDENCE,
    );

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

test("credential-bearing provider narratives fail closed before report creation", async () => {
  for (const value of [
    {
      ...validFinding(),
      finding: "Authorization: Bearer response-canary",
    },
    {
      ...validFinding(),
      recommendation: 'Set cookies = "response-cookie-canary".',
    },
  ]) {
    const fake = createFakeStructuredAiClient({
      state: "available",
      value,
      provenanceEvidence: [],
    });
    const execution = await runTargetAiCheck(
      {
        kind: "ready",
        client: fake.client,
      },
      TARGET_EVIDENCE,
    );
    const serialized = JSON.stringify(execution.result);

    assert.equal(execution.incomplete, true);
    assert.equal(execution.result.status, "Skipped");
    assert.equal(execution.result.diagnosticCode, "AI_RESPONSE_INVALID_SCHEMA");
    assert.equal(serialized.includes("response-canary"), false);
    assert.equal(serialized.includes("response-cookie-canary"), false);
  }
});

test("unsafe evidence paths fail closed before reserving a provider request", async () => {
  const fake = createFakeStructuredAiClient(availableFinding());
  const execution = await runTargetAiCheck(
    {
      kind: "ready",
      client: fake.client,
    },
    {
      state: "available",
      documents: [
        TARGET_EVIDENCE.documents[0],
        {
          ...TARGET_EVIDENCE.documents[1],
          path: `tests/sk-proj-${"x".repeat(32)}.test.ts`,
        },
      ],
    },
  );

  assert.equal(fake.requests.length, 0);
  assert.equal(execution.incomplete, false);
  assert.equal(execution.result.status, "Skipped");
  assert.equal(execution.result.diagnosticCode, "AI_EVIDENCE_INSUFFICIENT");
});

test("unrecognized provider output fails closed and affects only the AI check", async () => {
  const fake = createFakeStructuredAiClient({
    state: "unavailable",
    diagnosticCode: "AI_RESPONSE_UNRECOGNIZED",
  });
  const execution = await runTargetAiCheck(
    {
      kind: "ready",
      client: fake.client,
    },
    TARGET_EVIDENCE,
  );

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
  const execution = await runTargetAiCheck(
    {
      kind: "ready",
      client: fake.client,
    },
    TARGET_EVIDENCE,
  );

  assert.equal(execution.incomplete, true);
  assert.equal(execution.result.status, "Skipped");
  assert.equal(execution.result.severity, "Info");
  assert.equal(execution.result.diagnosticCode, "AI_PROVIDER_TIMEOUT");
});

test("unexpected client exceptions are isolated without exposing their message", async () => {
  const sensitiveMessage = "provider-failure-" + Date.now().toString();
  const execution = await runTargetAiCheck(
    {
      kind: "ready",
      client: {
        generate() {
          return Promise.reject(new Error(sensitiveMessage));
        },
      },
    },
    TARGET_EVIDENCE,
  );

  assert.equal(execution.incomplete, true);
  assert.equal(execution.result.diagnosticCode, "AI_PROVIDER_ERROR");
  assert.equal(
    JSON.stringify(execution.result).includes(sensitiveMessage),
    false,
  );
});
