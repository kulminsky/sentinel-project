import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { checkEnvironmentHygiene } from "../src/checks/security/env-hygiene.js";
import { checkSecrets } from "../src/checks/security/secrets.js";
import { createScanReport } from "../src/core/result.js";
import { renderMarkdownReport } from "../src/report/markdown.js";
import { inspectRepository } from "../src/repository/inspection.js";

async function withTemporaryRepository(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "sentinel-security-file-test-"));

  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("secret scan detects supported high-confidence signatures without disclosing values", async () => {
  await withTemporaryRepository(async (root) => {
    const canaries = [
      ["-----BEGIN ", "PRIVATE KEY-----"].join(""),
      ["AKIA", "1234567890ABCDEF"].join(""),
      ["ghp_", "A".repeat(30)].join(""),
      ["xoxb-", "A".repeat(20)].join(""),
      ["sk_live_", "A".repeat(16)].join(""),
      ["sk-", "A".repeat(20)].join(""),
      ["sk-ant-", "A".repeat(20)].join(""),
      ["AIza", "A".repeat(35)].join(""),
    ];
    await writeFile(join(root, "credentials.txt"), canaries.join("\n"), "utf8");

    const execution = await checkSecrets(
      await inspectRepository(root),
      new AbortController().signal,
    );
    const rendered = renderMarkdownReport(
      createScanReport({
        targetName: "fixture",
        generatedAt: "2026-01-01T00:00:00.000Z",
        incomplete: execution.incomplete,
        results: execution.results,
      }),
    );
    const categories = execution.results.flatMap(
      (result) => result.evidence ?? [],
    );

    assert.ok(categories.some((value) => value.includes("Private key")));
    assert.ok(categories.some((value) => value.includes("AWS access-key ID")));
    assert.ok(categories.some((value) => value.includes("GitHub credential")));
    assert.ok(categories.some((value) => value.includes("Slack credential")));
    assert.ok(
      categories.some((value) => value.includes("Stripe live credential")),
    );
    assert.ok(
      categories.some((value) => value.includes("OpenAI API credential")),
    );
    assert.ok(
      categories.some((value) => value.includes("Anthropic API credential")),
    );
    assert.ok(
      categories.some((value) => value.includes("Google API credential")),
    );
    assert.ok(
      execution.results.some((result) => result.severity === "Critical"),
    );

    for (const canary of canaries) {
      assert.equal(JSON.stringify(execution).includes(canary), false);
      assert.equal(rendered.includes(canary), false);
    }
  });
});

test("secret scan checks environment assignments and ignores placeholders", async () => {
  await withTemporaryRepository(async (root) => {
    const canary = ["fixture", "-", "credential", "-", "value"].join("");
    await writeFile(
      join(root, ".env"),
      [
        `SERVICE_TOKEN=${canary}`,
        "EMPTY_SECRET=",
        "EXAMPLE_TOKEN=replace_me",
        'QUOTED_EXAMPLE_TOKEN="replace_me" # documented placeholder',
        "REFERENCE_SECRET=${SERVICE_SECRET}",
      ].join("\n"),
      "utf8",
    );

    const execution = await checkSecrets(
      await inspectRepository(root),
      new AbortController().signal,
    );

    assert.equal(execution.results.length, 1);
    assert.equal(execution.results[0]?.status, "Fail");
    assert.match(
      execution.results[0]?.evidence?.join(" ") ?? "",
      /Environment credential assignment/,
    );
    assert.equal(JSON.stringify(execution).includes(canary), false);
  });
});

test("secret scan excludes ignored environment files and recognized generated artifacts", async () => {
  await withTemporaryRepository(async (root) => {
    const canary = ["sk-", "B".repeat(20)].join("");
    await writeFile(join(root, ".gitignore"), ".env\n", "utf8");
    await writeFile(join(root, ".env"), `API_KEY=${canary}\n`, "utf8");
    await writeFile(join(root, "application.min.js"), canary, "utf8");
    await writeFile(join(root, "application.js.map"), canary, "utf8");

    const execution = await checkSecrets(
      await inspectRepository(root),
      new AbortController().signal,
    );

    assert.equal(execution.results[0]?.status, "Pass");
    assert.equal(JSON.stringify(execution).includes(canary), false);
  });
});

test("secret scan preserves findings and marks bounded coverage incomplete", async () => {
  await withTemporaryRepository(async (root) => {
    const canary = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");
    await writeFile(join(root, "a.txt"), canary, "utf8");
    await writeFile(join(root, "b.txt"), "bounded inventory", "utf8");
    const inspection = await inspectRepository(root, {
      maxEntries: 1,
    });
    const execution = await checkSecrets(
      inspection,
      new AbortController().signal,
    );

    assert.equal(execution.incomplete, true);
    assert.ok(
      execution.results.some(
        (result) => result.diagnosticCode === "SECRET_SCAN_INCOMPLETE",
      ),
    );
    assert.equal(JSON.stringify(execution).includes(canary), false);
  });
});

test("secret scan preserves findings when its internal time budget is exhausted", async () => {
  await withTemporaryRepository(async (root) => {
    const canary = ["-----BEGIN ", "PRIVATE KEY-----"].join("");
    await writeFile(join(root, "a.txt"), canary, "utf8");
    await writeFile(join(root, "b.txt"), "remaining content", "utf8");
    const times = [0, 0, 8_000];
    const execution = await checkSecrets(
      await inspectRepository(root),
      new AbortController().signal,
      () => times.shift() ?? 8_000,
    );

    assert.equal(execution.incomplete, true);
    assert.ok(
      execution.results.some(
        (result) => result.status === "Fail" && result.severity === "Critical",
      ),
    );
    assert.ok(
      execution.results.some(
        (result) => result.diagnosticCode === "SECRET_SCAN_INCOMPLETE",
      ),
    );
    assert.equal(JSON.stringify(execution).includes(canary), false);
  });
});

test("oversized secret-scan inputs prevent a false clean claim", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "oversized.txt"),
      "x".repeat(128 * 1024 + 1),
      "utf8",
    );
    const execution = await checkSecrets(
      await inspectRepository(root),
      new AbortController().signal,
    );

    assert.equal(execution.incomplete, true);
    assert.equal(
      execution.results[0]?.diagnosticCode,
      "SECRET_SCAN_INCOMPLETE",
    );
    assert.notEqual(execution.results[0]?.status, "Pass");
  });
});

test("environment hygiene warns for an unignored real environment file", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(join(root, ".gitignore"), ".DS_Store\n", "utf8");
    await writeFile(join(root, ".env.local"), "PLACEHOLDER=value\n", "utf8");

    const execution = await checkEnvironmentHygiene(
      await inspectRepository(root),
    );

    assert.equal(execution.results[0]?.status, "Warn");
    assert.equal(execution.results[0]?.severity, "High");
    assert.equal(execution.results[0]?.subject, ".env.local");
  });
});

test("environment hygiene understands ignore negation and ignored templates", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(join(root, ".env"), "PLACEHOLDER=value\n", "utf8");
    await writeFile(join(root, ".env.example"), "TOKEN=replace_me\n", "utf8");
    await writeFile(join(root, ".gitignore"), ".env*\n", "utf8");

    const ignoredTemplate = await checkEnvironmentHygiene(
      await inspectRepository(root),
    );
    assert.equal(ignoredTemplate.results[0]?.status, "Warn");
    assert.equal(ignoredTemplate.results[0]?.severity, "Low");
    assert.equal(ignoredTemplate.results[0]?.subject, ".env.example");

    await writeFile(join(root, ".gitignore"), ".env*\n!.env.example\n", "utf8");
    const reviewableTemplate = await checkEnvironmentHygiene(
      await inspectRepository(root),
    );
    assert.equal(reviewableTemplate.results[0]?.status, "Pass");
  });
});

test("unavailable ignore policy prevents a false environment-hygiene pass", async () => {
  await withTemporaryRepository(async (root) => {
    const canary = ["sk-", "C".repeat(20)].join("");
    await writeFile(join(root, ".env"), `API_KEY=${canary}\n`, "utf8");
    await writeFile(
      join(root, ".gitignore"),
      "x".repeat(128 * 1024 + 1),
      "utf8",
    );

    const execution = await checkEnvironmentHygiene(
      await inspectRepository(root),
    );

    assert.equal(execution.results[0]?.status, "Skipped");
    assert.equal(
      execution.results[0]?.diagnosticCode,
      "ENV_HYGIENE_IGNORE_UNAVAILABLE",
    );
    assert.equal(execution.incomplete, true);

    const secrets = await checkSecrets(
      await inspectRepository(root),
      new AbortController().signal,
    );
    assert.equal(secrets.results[0]?.status, "Skipped");
    assert.equal(secrets.incomplete, true);
    assert.equal(JSON.stringify(secrets).includes(canary), false);
  });
});
