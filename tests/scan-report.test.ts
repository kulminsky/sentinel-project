import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { resolveAiSetup } from "../src/ai/config.js";
import { createSentinelConfigSchema } from "../src/config/schema.js";
import { renderMarkdownReport } from "../src/report/markdown.js";
import { scanProject } from "../src/scan.js";
import { createFakeStructuredAiClient } from "./support/fake-ai-provider.js";

const GOOD_README = `# Fixture

This fixture documents a small project used to verify Sentinel without relying on any running target service.

## Development Setup

Install project dependencies and run the local quality checks before making a change.

## Usage

Run the project command and review the generated quality report.
`;

async function withTemporaryRepository(
  run: (targetRoot: string) => Promise<void>,
): Promise<void> {
  const targetRoot = await mkdtemp(join(tmpdir(), "sentinel-test-"));

  try {
    await run(targetRoot);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
}

function configForTarget(targetRoot: string) {
  return createSentinelConfigSchema(targetRoot).parse({
    target: {
      root: targetRoot,
    },
  });
}

function configForAiTarget(targetRoot: string) {
  return createSentinelConfigSchema(targetRoot).parse({
    target: {
      root: targetRoot,
    },
    api: {
      baseUrl: "http://127.0.0.1:4321",
      healthPath: "/health",
      openApiPath: "./openapi.json",
      timeoutMs: 1_000,
      latencyThresholdMs: 500,
      endpoints: [],
    },
  });
}

async function writeAiEvidence(targetRoot: string): Promise<void> {
  await writeFile(
    join(targetRoot, "openapi.json"),
    JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Fixture API", version: "1" },
      paths: {
        "/accounts/{accountId}/export": {
          get: {
            operationId: "exportAccount",
            responses: {
              403: {
                description: "Cross-account access denied.",
              },
            },
          },
        },
      },
    }),
    "utf8",
  );
  await writeFile(
    join(targetRoot, "account-export.test.ts"),
    'test("owner export", async () => exportAccount("own"));\n',
    "utf8",
  );
}

test("scanProject emits deterministic repository and coverage rows", async () => {
  await withTemporaryRepository(async (targetRoot) => {
    await writeFile(join(targetRoot, "README.md"), GOOD_README, "utf8");

    const report = await scanProject(configForTarget(targetRoot));

    assert.equal(report.overallSummary.scanStatus, "Complete");
    assert.deepEqual(
      report.results.map((result) => result.checkId),
      [
        "repository.gitignore",
        "repository.code-style",
        "repository.tests",
        "repository.ci",
        "repository.tsconfig-strict",
        "repository.dependency-freshness",
        "repository.lockfile",
        "repository.readme",
        "security.npm-audit",
        "security.secret-scan",
        "security.env-hygiene",
        "security.headers",
        "security.headers",
        "security.debug-endpoints",
        "api.service-availability",
        "api.runtime-contract",
        "api.openapi-fallback",
        "ai.api-test-gap",
        "ui.service-availability",
        "ui.browser-analysis",
      ],
    );
    assert.equal(
      report.results.find((result) => result.checkId === "repository.readme")
        ?.status,
      "Pass",
    );
    assert.deepEqual(
      report.results
        .filter((result) => result.diagnosticCode === "LEVEL_NOT_IMPLEMENTED")
        .map((result) => result.checkId),
      [],
    );
  });
});

test("scanProject warns when a repository README is absent", async () => {
  await withTemporaryRepository(async (targetRoot) => {
    const report = await scanProject(configForTarget(targetRoot));
    const readme = report.results.find(
      (result) => result.checkId === "repository.readme",
    );

    assert.equal(report.overallSummary.scanStatus, "Complete");
    assert.equal(readme?.status, "Warn");
    assert.equal(readme?.severity, "Medium");
  });
});

test("renderMarkdownReport includes the required result fields and summary", async () => {
  await withTemporaryRepository(async (targetRoot) => {
    await writeFile(join(targetRoot, "README.md"), GOOD_README, "utf8");

    const markdown = renderMarkdownReport(
      await scanProject(configForTarget(targetRoot)),
    );

    assert.match(markdown, /## Overall Summary/);
    assert.match(markdown, /\*\*Status counts:\*\* Pass 3/);
    assert.match(markdown, /Skipped 13/);
    assert.match(markdown, /\*\*Status:\*\* Pass/);
    assert.match(markdown, /\*\*Duration:\*\* \d+ ms/);
    assert.match(markdown, /\*\*Finding:\*\*/);
    assert.match(markdown, /\*\*Severity:\*\* Info/);
    assert.match(markdown, /\*\*Recommendation:\*\*/);
  });
});

test("scanProject appends one valid AI result without affecting repository checks", async () => {
  await withTemporaryRepository(async (targetRoot) => {
    await writeFile(join(targetRoot, "README.md"), GOOD_README, "utf8");
    await writeAiEvidence(targetRoot);
    const fake = createFakeStructuredAiClient({
      state: "available",
      value: {
        outcome: "gap",
        severity: "High",
        finding:
          "The tests omit the authenticated cross-account export rejection.",
        recommendation: "Add the missing authorization test.",
        citations: ["openapi.json", "account-export.test.ts"],
      },
      provenanceEvidence: ["Provider: openai; model: deterministic-fake"],
    });

    const report = await scanProject(configForAiTarget(targetRoot), {
      ai: {
        kind: "ready",
        createClient: () => fake.client,
      },
      fetch: () => Promise.resolve(new Response(null, { status: 503 })),
    });

    assert.equal(report.overallSummary.scanStatus, "Complete");
    assert.equal(
      report.results.find((result) => result.checkId === "repository.readme")
        ?.status,
      "Pass",
    );
    assert.equal(
      report.results.find((result) => result.checkId === "ai.api-test-gap")
        ?.status,
      "Fail",
    );
  });
});

test("provider credentials never appear in normalized or rendered output", async () => {
  await withTemporaryRepository(async (targetRoot) => {
    await writeFile(join(targetRoot, "README.md"), GOOD_README, "utf8");
    await writeAiEvidence(targetRoot);
    const credential = randomUUID();
    const ai = resolveAiSetup(
      {
        enabled: true,
        provider: "openai",
      },
      (name) => (name === "OPENAI_API_KEY" ? credential : undefined),
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: {
                    content: JSON.stringify({
                      outcome: "gap",
                      severity: "High",
                      finding:
                        "The tests omit the authenticated cross-account export rejection.",
                      recommendation: "Add the missing authorization test.",
                      citations: ["openapi.json", "account-export.test.ts"],
                    }),
                  },
                },
              ],
              usage: {
                prompt_tokens: 100,
                completion_tokens: 30,
              },
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json",
              },
            },
          ),
        ),
    );

    const report = await scanProject(configForAiTarget(targetRoot), {
      ai,
      fetch: () => Promise.resolve(new Response(null, { status: 503 })),
    });
    const markdown = renderMarkdownReport(report);

    assert.equal(JSON.stringify(report).includes(credential), false);
    assert.equal(markdown.includes(credential), false);
  });
});

test("an AI execution failure leaves repository results intact and marks the scan incomplete", async () => {
  await withTemporaryRepository(async (targetRoot) => {
    await writeFile(join(targetRoot, "README.md"), GOOD_README, "utf8");
    await writeAiEvidence(targetRoot);
    const fake = createFakeStructuredAiClient({
      state: "unavailable",
      diagnosticCode: "AI_PROVIDER_ERROR",
    });

    const report = await scanProject(configForAiTarget(targetRoot), {
      ai: {
        kind: "ready",
        createClient: () => fake.client,
      },
      fetch: () => Promise.resolve(new Response(null, { status: 503 })),
    });

    assert.equal(report.overallSummary.scanStatus, "Incomplete");
    assert.equal(
      report.results.find((result) => result.checkId === "repository.readme")
        ?.status,
      "Pass",
    );
    const aiResult = report.results.find(
      (result) => result.checkId === "ai.api-test-gap",
    );
    assert.equal(aiResult?.status, "Skipped");
    assert.equal(aiResult?.diagnosticCode, "AI_PROVIDER_ERROR");
  });
});

test("scanProject needs no running services when runtime targets are absent", async () => {
  await withTemporaryRepository(async (targetRoot) => {
    let requestCount = 0;
    const report = await scanProject(configForTarget(targetRoot), {
      fetch: () => {
        requestCount += 1;
        return Promise.reject(new Error("Unexpected request."));
      },
    });

    assert.equal(requestCount, 0);
    assert.equal(report.overallSummary.scanStatus, "Complete");
    assert.equal(
      report.results.find(
        (result) => result.checkId === "api.service-availability",
      )?.diagnosticCode,
      "SERVICE_NOT_CONFIGURED",
    );
    assert.equal(
      report.results.find(
        (result) => result.checkId === "ui.service-availability",
      )?.diagnosticCode,
      "SERVICE_NOT_CONFIGURED",
    );
  });
});
