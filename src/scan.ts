import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

import {
  disabledAiSetup,
  type AiCheckSetup,
  type EnvironmentReferenceResolver,
} from "./ai/config.js";
import { CHECKS } from "./checks/registry.js";
import type { SentinelConfig } from "./config/schema.js";
import type { FetchLike, ScanContext } from "./core/check.js";
import { createScanReport, type ScanReport } from "./core/result.js";
import { runChecks } from "./core/runner.js";
import { inspectRepository } from "./repository/inspection.js";
import { probeConfiguredServices } from "./runtime/reachability.js";

export interface ScanOptions {
  ai?: AiCheckSetup;
  resolveEnvironmentReference?: EnvironmentReferenceResolver;
  fetch?: FetchLike;
}

export async function scanProject(
  config: SentinelConfig,
  options: ScanOptions = {},
): Promise<ScanReport> {
  const resolvedRoot = resolve(config.target.root);
  const targetStat = await stat(resolvedRoot);

  if (!targetStat.isDirectory()) {
    throw new Error("Target root must be a directory.");
  }

  await access(resolvedRoot, constants.R_OK);

  const repository = await inspectRepository(resolvedRoot);
  const fetchImplementation = options.fetch ?? fetch;
  const reachability = await probeConfiguredServices(
    config,
    fetchImplementation,
  );
  const context: ScanContext = {
    config,
    repository,
    ai: options.ai ?? disabledAiSetup(),
    resolveEnvironmentReference:
      options.resolveEnvironmentReference ?? (() => undefined),
    fetch: fetchImplementation,
    reachability,
  };
  const execution = await runChecks(CHECKS, context);

  return createScanReport({
    targetName: basename(resolvedRoot) || resolvedRoot,
    generatedAt: new Date().toISOString(),
    incomplete: execution.incomplete,
    results: execution.results,
  });
}
