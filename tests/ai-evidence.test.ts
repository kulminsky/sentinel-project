import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { runTargetAiCheck } from "../src/ai/check.js";
import { selectTargetAiEvidence } from "../src/ai/evidence.js";
import { createSentinelConfigSchema } from "../src/config/schema.js";
import { inspectRepository } from "../src/repository/inspection.js";
import { createFakeStructuredAiClient } from "./support/fake-ai-provider.js";

async function withTarget(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "sentinel-ai-evidence-"));

  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function apiConfig(root: string) {
  return createSentinelConfigSchema(root).parse({
    target: {
      root: ".",
    },
    api: {
      baseUrl: "http://127.0.0.1:4321",
      healthPath: "/health",
      openApiPath: "./openapi.json",
      timeoutMs: 1_000,
      latencyThresholdMs: 500,
      endpoints: [],
    },
  }).api;
}

test("selects bounded target contract and related test evidence with credential redaction", async () => {
  await withTarget(async (root) => {
    const openAiCanary = ["sk", "proj", "a".repeat(32)].join("-");
    const anthropicCanary = ["sk", "ant", "b".repeat(32)].join("-");
    const genericPasswordCanary = ["target", "password", "canary"].join("-");
    const sensitiveCanaries = {
      authorization: "authorization-inline-canary",
      bearer: "standalone-bearer-canary",
      apiKey: "camel-api-key-canary",
      xApiKey: "header-api-key-canary",
      accessToken: "access-token-canary",
      refreshToken: "refresh-token-canary",
      cookie: "cookie-value-canary",
      nestedHeader: "nested-header-canary",
    };
    await mkdir(join(root, "tests"));
    await writeFile(
      join(root, "openapi.json"),
      JSON.stringify({
        openapi: "3.1.0",
        info: { title: "Target", version: "1" },
        paths: {
          "/api/profile": {
            get: {
              operationId: "getProfile",
              description: `Example credential ${openAiCanary}`,
              responses: { 200: { description: "Profile" } },
            },
          },
        },
      }),
      "utf8",
    );
    await writeFile(
      join(root, "tests", "profile.test.ts"),
      [
        `const apiKey = "${anthropicCanary}";`,
        `const password = "${genericPasswordCanary}";`,
        `const authorization = "${sensitiveCanaries.authorization}";`,
        `const bearerExample = "Bearer ${sensitiveCanaries.bearer}";`,
        `client.apiKey = "${sensitiveCanaries.apiKey}";`,
        `const headers = { "x-api-key": "${sensitiveCanaries.xApiKey}", nested: { Authorization: "Basic ${sensitiveCanaries.nestedHeader}" } };`,
        `const accessToken = "${sensitiveCanaries.accessToken}";`,
        `const values = { refreshToken: "${sensitiveCanaries.refreshToken}", cookies: { session: "${sensitiveCanaries.cookie}" } };`,
        'test("profile response", async () => {',
        '  const response = await fetch("/api/profile");',
        "  expect(response.status).toBe(200);",
        "});",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(root, "tests", "unrelated.test.ts"),
      'test("math", () => expect(1 + 1).toBe(2));\n',
      "utf8",
    );

    const inspection = await inspectRepository(root);
    const selected = await selectTargetAiEvidence(
      inspection,
      apiConfig(root),
      new AbortController().signal,
    );

    assert.equal(selected.state, "available");
    if (selected.state !== "available") {
      return;
    }

    assert.deepEqual(
      selected.documents.map(({ path, kind }) => ({ path, kind })),
      [
        { path: "openapi.json", kind: "contract" },
        { path: "tests/profile.test.ts", kind: "test" },
      ],
    );
    const serialized = JSON.stringify(selected.documents);
    assert.equal(serialized.includes(openAiCanary), false);
    assert.equal(serialized.includes(anthropicCanary), false);
    assert.equal(serialized.includes(genericPasswordCanary), false);
    for (const canary of Object.values(sensitiveCanaries)) {
      assert.equal(serialized.includes(canary), false);
    }
    assert.match(serialized, /\[REDACTED/);
    assert.ok(
      selected.documents.reduce(
        (total, document) =>
          total +
          Buffer.byteLength(document.path) +
          Buffer.byteLength(document.content),
        0,
      ) <=
        8 * 1024,
    );

    const fake = createFakeStructuredAiClient({
      state: "available",
      value: {
        outcome: "no_supported_gap",
        severity: null,
        finding: null,
        recommendation: null,
        citations: selected.documents.map((document) => document.path),
      },
      provenanceEvidence: [],
    });
    await runTargetAiCheck(
      {
        kind: "ready",
        client: fake.client,
      },
      selected,
    );
    const prompt = fake.requests[0]?.userPrompt ?? "";
    for (const canary of Object.values(sensitiveCanaries)) {
      assert.equal(prompt.includes(canary), false);
    }
  });
});

test("insufficient target evidence skips without reserving a paid request", async () => {
  await withTarget(async (root) => {
    const inspection = await inspectRepository(root);
    const selection = await selectTargetAiEvidence(
      inspection,
      undefined,
      new AbortController().signal,
    );
    const fake = createFakeStructuredAiClient({
      state: "available",
      value: {
        outcome: "gap",
        severity: "High",
        finding: "This must not be used.",
        recommendation: "This must not be used.",
        citations: [],
      },
      provenanceEvidence: [],
    });
    const execution = await runTargetAiCheck(
      {
        kind: "ready",
        client: fake.client,
      },
      selection,
    );

    assert.equal(fake.requests.length, 0);
    assert.equal(execution.incomplete, false);
    assert.equal(execution.result.status, "Skipped");
    assert.equal(execution.result.diagnosticCode, "AI_EVIDENCE_INSUFFICIENT");
  });
});

test("an unrelated or empty test set cannot trigger target AI analysis", async () => {
  await withTarget(async (root) => {
    await mkdir(join(root, "tests"));
    await writeFile(
      join(root, "openapi.json"),
      JSON.stringify({
        openapi: "3.1.0",
        info: { title: "Target", version: "1" },
        paths: {
          "/api/profile": {
            get: {
              operationId: "getProfile",
              responses: { 200: { description: "Profile" } },
            },
          },
        },
      }),
      "utf8",
    );
    await writeFile(join(root, "tests", "math.test.ts"), "", "utf8");

    const selection = await selectTargetAiEvidence(
      await inspectRepository(root),
      apiConfig(root),
      new AbortController().signal,
    );

    assert.equal(selection.state, "insufficient");
    assert.equal(selection.diagnosticCode, "AI_EVIDENCE_INSUFFICIENT");
  });
});
