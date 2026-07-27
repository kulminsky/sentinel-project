import { z } from "zod";

export const ANALYSIS_LEVELS = [
  "Code & Repository",
  "Security",
  "API / Backend",
  "UI / Browser",
] as const;

export const STATUSES = ["Pass", "Warn", "Fail", "Skipped"] as const;
export const SEVERITIES = [
  "Critical",
  "High",
  "Medium",
  "Low",
  "Info",
] as const;
export const CHECK_PHASES = ["static", "runtime", "AI"] as const;
export const SCAN_STATUSES = ["Complete", "Incomplete"] as const;

export type AnalysisLevel = (typeof ANALYSIS_LEVELS)[number];
export type CheckStatus = (typeof STATUSES)[number];
export type Severity = (typeof SEVERITIES)[number];
export type CheckPhase = (typeof CHECK_PHASES)[number];
export type ScanStatus = (typeof SCAN_STATUSES)[number];

const requiredTextSchema = z
  .string()
  .trim()
  .min(1, "Expected a non-empty string.");

export const checkResultSchema = z
  .strictObject({
    checkId: requiredTextSchema,
    title: requiredTextSchema,
    level: z.enum(ANALYSIS_LEVELS),
    phase: z.enum(CHECK_PHASES),
    status: z.enum(STATUSES),
    severity: z.enum(SEVERITIES),
    finding: requiredTextSchema,
    recommendation: requiredTextSchema,
    subject: requiredTextSchema.optional(),
    evidence: z.array(requiredTextSchema).min(1).optional(),
    durationMs: z.number().finite().nonnegative().optional(),
    diagnosticCode: requiredTextSchema.optional(),
  })
  .superRefine((result, context) => {
    if (
      (result.status === "Pass" || result.status === "Skipped") &&
      result.severity !== "Info"
    ) {
      context.addIssue({
        code: "custom",
        path: ["severity"],
        message: `${result.status} results must use Info severity.`,
      });
    }
  });

const statusCountsSchema = z.strictObject({
  Pass: z.number().int().nonnegative(),
  Warn: z.number().int().nonnegative(),
  Fail: z.number().int().nonnegative(),
  Skipped: z.number().int().nonnegative(),
});

const severityCountsSchema = z.strictObject({
  Critical: z.number().int().nonnegative(),
  High: z.number().int().nonnegative(),
  Medium: z.number().int().nonnegative(),
  Low: z.number().int().nonnegative(),
  Info: z.number().int().nonnegative(),
});

export const overallSummarySchema = z.strictObject({
  scanStatus: z.enum(SCAN_STATUSES),
  totalResults: z.number().int().nonnegative(),
  statusCounts: statusCountsSchema,
  severityCounts: severityCountsSchema,
  narrative: requiredTextSchema,
});

export type CheckResult = z.output<typeof checkResultSchema>;
export type CheckResultInput = z.input<typeof checkResultSchema>;
export type OverallSummary = z.output<typeof overallSummarySchema>;

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function buildOverallSummary(
  scanStatus: ScanStatus,
  results: readonly CheckResult[],
): OverallSummary {
  const statusCounts: OverallSummary["statusCounts"] = {
    Pass: 0,
    Warn: 0,
    Fail: 0,
    Skipped: 0,
  };
  const severityCounts: OverallSummary["severityCounts"] = {
    Critical: 0,
    High: 0,
    Medium: 0,
    Low: 0,
    Info: 0,
  };

  for (const result of results) {
    statusCounts[result.status] += 1;
    severityCounts[result.severity] += 1;
  }

  const totalResults = results.length;
  const resultLabel = pluralize(totalResults, "result", "results");
  const warningLabel = pluralize(statusCounts.Warn, "warning", "warnings");
  const executionNarrative =
    scanStatus === "Incomplete"
      ? "One or more checks had incomplete execution or coverage, so review their diagnostic rows before relying on the full scan."
      : "All available checks completed without internal execution errors.";

  return overallSummarySchema.parse({
    scanStatus,
    totalResults,
    statusCounts,
    severityCounts,
    narrative: `Sentinel produced ${totalResults} ${resultLabel}: ${statusCounts.Pass} passed, ${statusCounts.Warn} ${warningLabel}, ${statusCounts.Fail} failed, and ${statusCounts.Skipped} skipped. ${executionNarrative}`,
  });
}

export const scanReportSchema = z
  .strictObject({
    targetName: requiredTextSchema,
    generatedAt: z.iso.datetime(),
    overallSummary: overallSummarySchema,
    results: z.array(checkResultSchema),
  })
  .superRefine((report, context) => {
    const expected = buildOverallSummary(
      report.overallSummary.scanStatus,
      report.results,
    );

    if (JSON.stringify(report.overallSummary) !== JSON.stringify(expected)) {
      context.addIssue({
        code: "custom",
        path: ["overallSummary"],
        message: "Overall summary does not match the report results.",
      });
    }
  });

export type ScanReport = z.output<typeof scanReportSchema>;

export interface ScanReportInput {
  readonly targetName: string;
  readonly generatedAt: string;
  readonly incomplete: boolean;
  readonly results: readonly CheckResult[];
}

export function createCheckResult(result: CheckResultInput): CheckResult {
  return checkResultSchema.parse(result);
}

export function parseCheckResult(result: unknown): CheckResult {
  return checkResultSchema.parse(result);
}

export function createScanReport(input: ScanReportInput): ScanReport {
  const results = input.results.map((result) => parseCheckResult(result));
  const scanStatus: ScanStatus = input.incomplete ? "Incomplete" : "Complete";

  return scanReportSchema.parse({
    targetName: input.targetName,
    generatedAt: input.generatedAt,
    overallSummary: buildOverallSummary(scanStatus, results),
    results,
  });
}

export function parseScanReport(report: unknown): ScanReport {
  return scanReportSchema.parse(report);
}
