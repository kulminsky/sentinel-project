import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { resolveAiSetup } from "../src/ai/config.js";
import type { AiProviderOutcome } from "../src/ai/provider.js";
import { createSentinelConfigSchema } from "../src/config/schema.js";
import { renderMarkdownReport } from "../src/report/markdown.js";
import { scanProject } from "../src/scan.js";
import { createFakeAiProvider } from "./support/fake-ai-provider.js";

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
        "security.coverage",
        "api.service-availability",
        "ai.api-test-gap",
        "api.coverage",
        "ui.service-availability",
        "ui.coverage",
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
      ["security.coverage", "api.coverage", "ui.coverage"],
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
    assert.match(markdown, /\*\*Status counts:\*\* Pass 1/);
    assert.match(markdown, /Skipped 9/);
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
    const outcome: AiProviderOutcome = {
      ok: true,
      response: {
        content: JSON.stringify({
          severity: "High",
          finding:
            "The tests omit the authenticated cross-account export rejection.",
          recommendation: "Add the missing authorization test.",
          citations: [
            "synthetic/api/account-export-contract.md",
            "synthetic/tests/account-export.test.md",
          ],
        }),
        provider: "openai",
        model: "deterministic-fake",
      },
    };
    const fake = createFakeAiProvider(outcome);

    const report = await scanProject(configForTarget(targetRoot), {
      ai: {
        kind: "ready",
        provider: fake.provider,
      },
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
                      severity: "High",
                      finding:
                        "The tests omit the authenticated cross-account export rejection.",
                      recommendation: "Add the missing authorization test.",
                      citations: [
                        "synthetic/api/account-export-contract.md",
                        "synthetic/tests/account-export.test.md",
                      ],
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

    const report = await scanProject(configForTarget(targetRoot), { ai });
    const markdown = renderMarkdownReport(report);

    assert.equal(JSON.stringify(report).includes(credential), false);
    assert.equal(markdown.includes(credential), false);
  });
});

test("an AI execution failure leaves repository results intact and marks the scan incomplete", async () => {
  await withTemporaryRepository(async (targetRoot) => {
    await writeFile(join(targetRoot, "README.md"), GOOD_README, "utf8");
    const fake = createFakeAiProvider({
      ok: false,
      diagnosticCode: "AI_PROVIDER_ERROR",
    });

    const report = await scanProject(configForTarget(targetRoot), {
      ai: {
        kind: "ready",
        provider: fake.provider,
      },
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
