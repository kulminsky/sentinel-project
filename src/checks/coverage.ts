import type { Check } from "../core/check.js";
import { createCheckResult, type AnalysisLevel } from "../core/result.js";

interface CoverageMetadata {
  readonly id: string;
  readonly title: string;
  readonly level: Exclude<AnalysisLevel, "Code & Repository">;
  readonly finding: string;
  readonly recommendation: string;
}

function createCoverageCheck(metadata: CoverageMetadata): Check {
  return {
    id: metadata.id,
    title: metadata.title,
    level: metadata.level,
    phase: "static",
    timeoutMs: 1_000,
    run: () =>
      Promise.resolve({
        results: [
          createCheckResult({
            checkId: metadata.id,
            title: metadata.title,
            level: metadata.level,
            phase: "static",
            status: "Skipped",
            severity: "Info",
            finding: metadata.finding,
            recommendation: metadata.recommendation,
            diagnosticCode: "LEVEL_NOT_IMPLEMENTED",
          }),
        ],
        incomplete: false,
      }),
  };
}

export const securityCoverageCheck = createCoverageCheck({
  id: "security.coverage",
  title: "Security analysis coverage",
  level: "Security",
  finding:
    "Security analysis checks are not implemented in the current milestone.",
  recommendation:
    "Implement the approved secret detection and npm vulnerability-analysis milestone.",
});

export const apiCoverageCheck = createCoverageCheck({
  id: "api.coverage",
  title: "API / Backend analysis coverage",
  level: "API / Backend",
  finding:
    "API contract and runtime assertion checks are not implemented in the current milestone.",
  recommendation:
    "Implement the approved shallow OpenAPI fallback and read-only API assertion milestone.",
});

export const uiCoverageCheck = createCoverageCheck({
  id: "ui.coverage",
  title: "UI / Browser analysis coverage",
  level: "UI / Browser",
  finding:
    "Playwright browser checks are not implemented in the current milestone.",
  recommendation:
    "Implement the approved Playwright Chromium verification milestone.",
});
