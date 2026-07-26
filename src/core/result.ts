export const ANALYSIS_LEVELS = [
  "Code & Repository",
  "Security",
  "API / Backend",
  "UI / Browser",
] as const;

export const STATUSES = ["Pass", "Warn", "Fail", "Skipped"] as const;
export const SEVERITIES = ["Critical", "High", "Medium", "Low", "Info"] as const;

export type AnalysisLevel = (typeof ANALYSIS_LEVELS)[number];
export type CheckStatus = (typeof STATUSES)[number];
export type Severity = (typeof SEVERITIES)[number];
export type CheckPhase = "static" | "runtime" | "AI";

export interface CheckResult {
  checkId: string;
  title: string;
  level: AnalysisLevel;
  phase: CheckPhase;
  status: CheckStatus;
  severity: Severity;
  finding: string;
  recommendation: string;
  subject?: string;
  evidence?: readonly string[];
  durationMs?: number;
  diagnosticCode?: string;
}

export interface ScanReport {
  targetName: string;
  generatedAt: string;
  incomplete: boolean;
  results: readonly CheckResult[];
}

export function createCheckResult(result: CheckResult): CheckResult {
  const requiredText = {
    checkId: result.checkId,
    title: result.title,
    finding: result.finding,
    recommendation: result.recommendation,
  };

  for (const [field, value] of Object.entries(requiredText)) {
    if (value.trim().length === 0) {
      throw new Error(`${field} must not be empty`);
    }
  }

  if (
    (result.status === "Pass" || result.status === "Skipped") &&
    result.severity !== "Info"
  ) {
    throw new Error(`${result.status} results must use Info severity`);
  }

  if (result.durationMs !== undefined && result.durationMs < 0) {
    throw new Error("durationMs must not be negative");
  }

  return result;
}
