#!/usr/bin/env node

import { resolve } from "node:path";

import { writeMarkdownReport } from "./report/markdown.js";
import { scanProject } from "./scan.js";

const DEFAULT_REPORT_NAME = "sentinel-report.md";

async function main(): Promise<void> {
  const targetRoot = process.cwd();
  const outputPath = resolve(targetRoot, DEFAULT_REPORT_NAME);
  const report = await scanProject(targetRoot);

  await writeMarkdownReport(report, outputPath);
  console.log(`Sentinel report written to ${outputPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Sentinel failed: ${message}`);
  process.exitCode = 1;
});
