import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { renderMarkdownReport } from "../src/report/markdown.js";
import { scanProject } from "../src/scan.js";

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
    assert.equal(report.results.length, 1);
    assert.equal(report.results[0]?.checkId, "repository.readme");
    assert.equal(report.results[0]?.status, "Pass");
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
    assert.match(markdown, /\*\*Status:\*\* Pass/);
    assert.match(markdown, /\*\*Finding:\*\*/);
    assert.match(markdown, /\*\*Severity:\*\* Info/);
    assert.match(markdown, /\*\*Recommendation:\*\*/);
  });
});
