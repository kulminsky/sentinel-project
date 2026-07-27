import type { Check, CheckExecution } from "../../core/check.js";
import type { RepositoryInspection } from "../../repository/inspection.js";
import {
  createSecurityResult,
  securityExecution,
  type SecurityCheckMetadata,
} from "./common.js";
import {
  isEnvironmentTemplate,
  isRealEnvironmentFile,
  loadIgnorePolicy,
} from "./files.js";

const ENV_HYGIENE_CHECK: SecurityCheckMetadata = {
  id: "security.env-hygiene",
  title: "Environment file hygiene",
  phase: "static",
};

export async function checkEnvironmentHygiene(
  inspection: RepositoryInspection,
): Promise<CheckExecution> {
  const environmentFiles = inspection.entries
    .filter(
      (entry) =>
        entry.kind === "file" &&
        (isRealEnvironmentFile(entry.path) ||
          isEnvironmentTemplate(entry.path)),
    )
    .map((entry) => entry.path);
  const ignorePolicy = await loadIgnorePolicy(inspection);

  if (ignorePolicy.state === "unavailable" && environmentFiles.length > 0) {
    return securityExecution(
      [
        createSecurityResult(ENV_HYGIENE_CHECK, {
          status: "Skipped",
          severity: "Info",
          finding:
            "Environment files are present, but root ignore rules could not be interpreted safely.",
          recommendation:
            "Correct or restore the root .gitignore before reviewing environment-file hygiene.",
          diagnosticCode: "ENV_HYGIENE_IGNORE_UNAVAILABLE",
        }),
      ],
      true,
    );
  }

  const results = environmentFiles.flatMap((path) => {
    const ignored =
      ignorePolicy.state !== "unavailable" && ignorePolicy.ignores(path);

    if (isRealEnvironmentFile(path) && !ignored) {
      return [
        createSecurityResult(ENV_HYGIENE_CHECK, {
          subject: path,
          status: "Warn",
          severity: "High",
          finding:
            "A real environment file is present without matching root ignore coverage.",
          recommendation:
            "Ignore the environment file and ensure no sensitive version has been committed.",
        }),
      ];
    }

    if (isEnvironmentTemplate(path) && ignored) {
      return [
        createSecurityResult(ENV_HYGIENE_CHECK, {
          subject: path,
          status: "Warn",
          severity: "Low",
          finding: "An environment template is hidden by root ignore rules.",
          recommendation:
            "Negate the template path so a placeholder-only example can remain reviewable.",
        }),
      ];
    }

    return [];
  });

  if (!inspection.complete) {
    results.push(
      createSecurityResult(ENV_HYGIENE_CHECK, {
        subject: "Environment file coverage",
        status: "Skipped",
        severity: "Info",
        finding:
          "The bounded repository inventory was incomplete, so environment-file hygiene coverage is incomplete.",
        recommendation:
          "Reduce unreadable or oversized repository structure and rerun Sentinel.",
        diagnosticCode: "ENV_HYGIENE_INCOMPLETE",
      }),
    );
    return securityExecution(results, true);
  }

  if (results.length === 0) {
    const realFiles = environmentFiles.filter(isRealEnvironmentFile).length;
    const templates = environmentFiles.filter(isEnvironmentTemplate).length;

    results.push(
      createSecurityResult(ENV_HYGIENE_CHECK, {
        status: "Pass",
        severity: "Info",
        finding: "No problematic environment-file ignore state was detected.",
        recommendation:
          "Keep real environment files ignored and templates limited to placeholders.",
        evidence: [
          `Real environment files reviewed: ${realFiles}`,
          `Environment templates reviewed: ${templates}`,
        ],
      }),
    );
  }

  return securityExecution(results);
}

export const securityEnvironmentHygieneCheck: Check = {
  id: ENV_HYGIENE_CHECK.id,
  title: ENV_HYGIENE_CHECK.title,
  level: "Security",
  phase: ENV_HYGIENE_CHECK.phase,
  timeoutMs: 5_000,
  run: (context) => checkEnvironmentHygiene(context.repository),
};
