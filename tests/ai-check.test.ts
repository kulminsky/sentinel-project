import assert from "node:assert/strict";
import test from "node:test";

import { runSyntheticAiCheck } from "../src/ai/check.js";
import { disabledAiSetup } from "../src/ai/config.js";
import type { AiProviderOutcome } from "../src/ai/provider.js";
import { renderMarkdownReport } from "../src/report/markdown.js";
import { createFakeAiProvider } from "./support/fake-ai-provider.js";

const CONTRACT_PATH = "synthetic/api/account-export-contract.md";
const TEST_PATH = "synthetic/tests/account-export.test.md";

function validProviderOutcome(
  severity = "High",
): AiProviderOutcome {
  return {
    ok: true,
    response: {
      content: JSON.stringify({
        severity,
        finding:
          "The tests omit the authenticated cross-account export rejection.",
        recommendation:
          "Add a test asserting HTTP 403 for an authenticated request to another account.",
        citations: [CONTRACT_PATH, TEST_PATH],
      }),
      provider: "openai",
      model: "deterministic-fake",
      inputTokens: 120,
      outputTokens: 35,
    },
  };
}

test("disabled AI is a normal skipped prerequisite", async () => {
  const execution = await runSyntheticAiCheck(disabledAiSetup());

  assert.equal(execution.incomplete, false);
  assert.equal(execution.result.status, "Skipped");
  assert.equal(execution.result.severity, "Info");
  assert.equal(execution.result.diagnosticCode, "AI_DISABLED");
});

test("a valid AI finding maps to the normalized result and Markdown report", async () => {
  const fake = createFakeAiProvider(validProviderOutcome());
  const execution = await runSyntheticAiCheck({
    kind: "ready",
    provider: fake.provider,
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

  const markdown = renderMarkdownReport({
    targetName: "synthetic",
    generatedAt: "2026-01-01T00:00:00.000Z",
    incomplete: execution.incomplete,
    results: [execution.result],
  });
  assert.match(markdown, /## API \/ Backend/);
  assert.match(markdown, /\*\*Phase:\*\* AI/);
  assert.match(markdown, /authenticated cross-account/);
  assert.match(markdown, /synthetic\/api\/account-export-contract\.md/);
});

test("medium and low AI findings map to warnings", async () => {
  for (const severity of ["Medium", "Low"]) {
    const fake = createFakeAiProvider(validProviderOutcome(severity));
    const execution = await runSyntheticAiCheck({
      kind: "ready",
      provider: fake.provider,
    });

    assert.equal(execution.result.status, "Warn");
    assert.equal(execution.result.severity, severity);
  }
});

test("invalid AI findings are isolated and make the report incomplete", async () => {
  const cases: ReadonlyArray<{
    name: string;
    content: string;
    diagnosticCode: string;
  }> = [
    {
      name: "invalid JSON",
      content: "not-json",
      diagnosticCode: "AI_RESPONSE_INVALID_JSON",
    },
    {
      name: "unknown severity",
      content: JSON.stringify({
        severity: "Urgent",
        finding: "A gap exists.",
        recommendation: "Add a test.",
        citations: [CONTRACT_PATH, TEST_PATH],
      }),
      diagnosticCode: "AI_RESPONSE_INVALID_SCHEMA",
    },
    {
      name: "missing citations",
      content: JSON.stringify({
        severity: "High",
        finding: "A gap exists.",
        recommendation: "Add a test.",
      }),
      diagnosticCode: "AI_RESPONSE_MISSING_CITATION",
    },
    {
      name: "missing test evidence",
      content: JSON.stringify({
        severity: "High",
        finding: "A gap exists.",
        recommendation: "Add a test.",
        citations: [CONTRACT_PATH],
      }),
      diagnosticCode: "AI_RESPONSE_MISSING_CITATION",
    },
    {
      name: "invented path",
      content: JSON.stringify({
        severity: "High",
        finding: "A gap exists.",
        recommendation: "Add a test.",
        citations: [CONTRACT_PATH, "synthetic/tests/invented.test.md"],
      }),
      diagnosticCode: "AI_RESPONSE_UNSUPPORTED_CITATION",
    },
    {
      name: "additional property",
      content: JSON.stringify({
        severity: "High",
        finding: "A gap exists.",
        recommendation: "Add a test.",
        citations: [CONTRACT_PATH, TEST_PATH],
        confidence: 0.99,
      }),
      diagnosticCode: "AI_RESPONSE_INVALID_SCHEMA",
    },
  ];

  for (const testCase of cases) {
    const fake = createFakeAiProvider({
      ok: true,
      response: {
        content: testCase.content,
        provider: "claude",
        model: "deterministic-fake",
      },
    });
    const execution = await runSyntheticAiCheck({
      kind: "ready",
      provider: fake.provider,
    });

    assert.equal(
      execution.incomplete,
      true,
      `${testCase.name} should make the report incomplete`,
    );
    assert.equal(execution.result.status, "Skipped");
    assert.equal(execution.result.severity, "Info");
    assert.equal(execution.result.diagnosticCode, testCase.diagnosticCode);
    assert.equal(
      JSON.stringify(execution.result).includes(testCase.content),
      false,
    );
  }
});

test("provider failures affect only the AI check", async () => {
  const fake = createFakeAiProvider({
    ok: false,
    diagnosticCode: "AI_PROVIDER_TIMEOUT",
  });
  const execution = await runSyntheticAiCheck({
    kind: "ready",
    provider: fake.provider,
  });

  assert.equal(execution.incomplete, true);
  assert.equal(execution.result.status, "Skipped");
  assert.equal(execution.result.severity, "Info");
  assert.equal(execution.result.diagnosticCode, "AI_PROVIDER_TIMEOUT");
});

test("unexpected provider exceptions are isolated without exposing their message", async () => {
  const sensitiveMessage = "provider-failure-" + Date.now().toString();
  const execution = await runSyntheticAiCheck({
    kind: "ready",
    provider: {
      name: "openai",
      async analyze() {
        throw new Error(sensitiveMessage);
      },
    },
  });

  assert.equal(execution.incomplete, true);
  assert.equal(execution.result.diagnosticCode, "AI_PROVIDER_ERROR");
  assert.equal(JSON.stringify(execution.result).includes(sensitiveMessage), false);
});
