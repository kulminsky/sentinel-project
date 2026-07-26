import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { runSyntheticAiCheck } from "./ai/check.js";
import {
  disabledAiSetup,
  type AiCheckSetup,
} from "./ai/config.js";
import { checkRepositoryReadme } from "./checks/repository-readme.js";
import { createCheckResult, type CheckResult, type ScanReport } from "./core/result.js";

export interface ScanOptions {
  ai?: AiCheckSetup;
}

export async function scanProject(
  targetRoot: string,
  options: ScanOptions = {},
): Promise<ScanReport> {
  const resolvedRoot = resolve(targetRoot);
  const targetStat = await stat(resolvedRoot);

  if (!targetStat.isDirectory()) {
    throw new Error("Target root must be a directory.");
  }

  await access(resolvedRoot, constants.R_OK);

  let incomplete = false;
  const results: CheckResult[] = [];

  try {
    results.push(...(await checkRepositoryReadme(resolvedRoot)));
  } catch {
    incomplete = true;
    results.push(
      createCheckResult({
        checkId: "repository.readme",
        title: "Repository README",
        level: "Code & Repository",
        phase: "static",
        status: "Skipped",
        severity: "Info",
        finding: "Sentinel could not execute the repository README check.",
        recommendation:
          "Review the Sentinel execution diagnostic and retry the scan.",
        diagnosticCode: "CHECK_EXECUTION_ERROR",
      }),
    );
  }

  const aiExecution = await runSyntheticAiCheck(
    options.ai ?? disabledAiSetup(),
  );
  results.push(aiExecution.result);
  incomplete ||= aiExecution.incomplete;

  return {
    targetName: basename(resolvedRoot) || resolvedRoot,
    generatedAt: new Date().toISOString(),
    incomplete,
    results,
  };
}
