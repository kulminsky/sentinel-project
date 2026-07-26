import { readdir } from "node:fs/promises";

import type { Check } from "../core/check.js";
import { createCheckResult, type CheckResult } from "../core/result.js";

const README_NAMES = new Set([
  "readme",
  "readme.md",
  "readme.rst",
  "readme.txt",
]);

export async function checkRepositoryReadme(
  targetRoot: string,
): Promise<readonly CheckResult[]> {
  const entries = await readdir(targetRoot, { withFileTypes: true });
  const readme = entries.find(
    (entry) => entry.isFile() && README_NAMES.has(entry.name.toLowerCase()),
  );

  if (readme) {
    return [
      createCheckResult({
        checkId: "repository.readme",
        title: "Repository README",
        level: "Code & Repository",
        phase: "static",
        subject: readme.name,
        status: "Pass",
        severity: "Info",
        finding: `${readme.name} is present at the repository root.`,
        recommendation:
          "Keep repository setup, usage, and project guidance current.",
      }),
    ];
  }

  return [
    createCheckResult({
      checkId: "repository.readme",
      title: "Repository README",
      level: "Code & Repository",
      phase: "static",
      status: "Warn",
      severity: "Low",
      finding: "No recognized README file was found at the repository root.",
      recommendation:
        "Add a README that explains the project purpose and verified development workflow.",
    }),
  ];
}

export const repositoryReadmeCheck: Check = {
  id: "repository.readme",
  title: "Repository README",
  level: "Code & Repository",
  phase: "static",
  timeoutMs: 5_000,
  run: async (context) => ({
    results: await checkRepositoryReadme(context.config.target.root),
    incomplete: false,
  }),
};
