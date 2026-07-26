#!/usr/bin/env node

import { resolve } from "node:path";

import { Command } from "commander";

import { resolveAiSetup } from "./ai/config.js";
import { writeMarkdownReport } from "./report/markdown.js";
import { scanProject } from "./scan.js";

const DEFAULT_REPORT_NAME = "sentinel-report.md";

async function main(): Promise<void> {
  const targetRoot = process.cwd();
  const outputPath = resolve(targetRoot, DEFAULT_REPORT_NAME);
  const report = await scanProject(targetRoot, {
    ai: resolveAiSetup(process.env),
  });

  await writeMarkdownReport(report, outputPath);
  console.log(`Sentinel report written to ${outputPath}`);
}

const program = new Command()
  .name("sentinel")
  .description("Scan a local project and produce a quality report.")
  .showHelpAfterError()
  .allowExcessArguments(false)
  .action(main);

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Sentinel failed: ${message}`);
  process.exitCode = 1;
});
