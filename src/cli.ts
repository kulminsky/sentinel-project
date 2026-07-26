#!/usr/bin/env node

import { Command } from "commander";

import { resolveAiSetup } from "./ai/config.js";
import { loadSentinelConfig } from "./config/load.js";
import { writeMarkdownReport } from "./report/markdown.js";
import { scanProject } from "./scan.js";

interface CliOptions {
  config?: string;
}

async function main(options: CliOptions): Promise<void> {
  const loaded = await loadSentinelConfig({
    cwd: process.cwd(),
    ...(options.config === undefined
      ? {}
      : {
          configPath: options.config,
        }),
    environment: process.env,
  });
  const report = await scanProject(loaded.config.target.root, {
    ai: resolveAiSetup(loaded.config.ai, loaded.resolveEnvironmentReference),
  });

  await writeMarkdownReport(report, loaded.config.report.path);
  console.log(`Sentinel report written to ${loaded.config.report.path}`);
}

const program = new Command()
  .name("sentinel")
  .description("Scan a local project and produce a quality report.")
  .option("-c, --config <path>", "load configuration from a JSON file")
  .showHelpAfterError()
  .allowExcessArguments(false)
  .action(() => main(program.opts<CliOptions>()));

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Sentinel failed: ${message}`);
  process.exitCode = 1;
});
