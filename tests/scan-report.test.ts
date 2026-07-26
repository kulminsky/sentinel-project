import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveAiSetup } from "../src/ai/config.js";
import type { AiProviderOutcome } from "../src/ai/provider.js";
import { renderMarkdownReport } from "../src/report/markdown.js";
import { scanProject } from "../src/scan.js";
import { createFakeAiProvider } from "./support/fake-ai-provider.js";

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

test("scanProject passes when a repository README is present", async () => {
  await withTemporaryRepository(async (targetRoot) => {
    await writeFile(join(targetRoot, "README.md"), "# Fixture\n", "utf8");

    const report = await scanProject(targetRoot);

    assert.equal(report.incomplete, false);
    assert.equal(report.results.length, 2);
    assert.equal(report.results[0]?.checkId, "repository.readme");
    assert.equal(report.results[0]?.status, "Pass");
    assert.equal(report.results[1]?.checkId, "ai.api-test-gap");
    assert.equal(report.results[1]?.status, "Skipped");
    assert.equal(report.results[1]?.diagnosticCode, "AI_DISABLED");
  });
});

test("scanProject warns when a repository README is absent", async () => {
  await withTemporaryRepository(async (targetRoot) => {
    const report = await scanProject(targetRoot);

    assert.equal(report.incomplete, false);
    assert.equal(report.results[0]?.status, "Warn");
    assert.equal(report.results[0]?.severity, "Low");
  });
});

test("renderMarkdownReport includes the required result fields and summary", async () => {
  await withTemporaryRepository(async (targetRoot) => {
    await writeFile(join(targetRoot, "README.md"), "# Fixture\n", "utf8");

    const markdown = renderMarkdownReport(await scanProject(targetRoot));

    assert.match(markdown, /## Overall Summary/);
    assert.match(markdown, /\*\*Status counts:\*\* Pass 1/);
    assert.match(markdown, /Skipped 1/);
    assert.match(markdown, /\*\*Status:\*\* Pass/);
    assert.match(markdown, /\*\*Finding:\*\*/);
    assert.match(markdown, /\*\*Severity:\*\* Info/);
    assert.match(markdown, /\*\*Recommendation:\*\*/);
  });
});

test("scanProject appends one valid AI result without affecting repository checks", async () => {
  await withTemporaryRepository(async (targetRoot) => {
    await writeFile(join(targetRoot, "README.md"), "# Fixture\n", "utf8");
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

    const report = await scanProject(targetRoot, {
      ai: {
        kind: "ready",
        provider: fake.provider,
      },
    });

    assert.equal(report.incomplete, false);
    assert.deepEqual(
      report.results.map((result) => result.checkId),
      ["repository.readme", "ai.api-test-gap"],
    );
    assert.deepEqual(
      report.results.map((result) => result.status),
      ["Pass", "Fail"],
    );
  });
});

test("provider credentials never appear in normalized or rendered output", async () => {
  await withTemporaryRepository(async (targetRoot) => {
    await writeFile(join(targetRoot, "README.md"), "# Fixture\n", "utf8");
    const credential = randomUUID();
    const ai = resolveAiSetup(
      {
        SENTINEL_AI_ENABLED: "true",
        SENTINEL_AI_PROVIDER: "openai",
        OPENAI_API_KEY: credential,
      },
      async () =>
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
    );

    const report = await scanProject(targetRoot, { ai });
    const markdown = renderMarkdownReport(report);

    assert.equal(JSON.stringify(report).includes(credential), false);
    assert.equal(markdown.includes(credential), false);
  });
});

test("an AI execution failure leaves repository results intact and marks the scan incomplete", async () => {
  await withTemporaryRepository(async (targetRoot) => {
    await writeFile(join(targetRoot, "README.md"), "# Fixture\n", "utf8");
    const fake = createFakeAiProvider({
      ok: false,
      diagnosticCode: "AI_PROVIDER_ERROR",
    });

    const report = await scanProject(targetRoot, {
      ai: {
        kind: "ready",
        provider: fake.provider,
      },
    });

    assert.equal(report.incomplete, true);
    assert.equal(report.results[0]?.status, "Pass");
    assert.equal(report.results[1]?.status, "Skipped");
    assert.equal(
      report.results[1]?.diagnosticCode,
      "AI_PROVIDER_ERROR",
    );
  });
});
