import { writeFile } from "node:fs/promises";

import {
  ANALYSIS_LEVELS,
  SEVERITIES,
  STATUSES,
  type CheckResult,
  type ScanReport,
} from "../core/result.js";

function countResults(
  results: readonly CheckResult[],
  field: "status" | "severity",
  value: string,
): number {
  return results.filter((result) => result[field] === value).length;
}

function inline(value: string): string {
  return value.replaceAll("\n", " ").trim();
}

export function renderMarkdownReport(report: ScanReport): string {
  const lines = [
    "# Sentinel Quality Report",
    "",
    `- **Target:** ${inline(report.targetName)}`,
    `- **Generated:** ${report.generatedAt}`,
    "",
    "## Overall Summary",
    "",
    `- **Scan status:** ${report.incomplete ? "Incomplete" : "Complete"}`,
    `- **Results:** ${report.results.length}`,
    `- **Status counts:** ${STATUSES.map(
      (status) => `${status} ${countResults(report.results, "status", status)}`,
    ).join(", ")}`,
    `- **Severity counts:** ${SEVERITIES.map(
      (severity) =>
        `${severity} ${countResults(report.results, "severity", severity)}`,
    ).join(", ")}`,
    "",
    report.incomplete
      ? "Sentinel completed the available checks, but one or more checks encountered an internal execution error."
      : "Sentinel completed every check available in this scan.",
  ];

  for (const level of ANALYSIS_LEVELS) {
    const levelResults = report.results.filter(
      (result) => result.level === level,
    );

    if (levelResults.length === 0) {
      continue;
    }

    lines.push("", `## ${level}`);

    for (const result of levelResults) {
      lines.push(
        "",
        `### ${inline(result.title)}`,
        "",
        `- **Status:** ${result.status}`,
        `- **Severity:** ${result.severity}`,
        `- **Phase:** ${result.phase}`,
      );

      if (result.subject) {
        lines.push(`- **Subject:** ${inline(result.subject)}`);
      }

      if (result.durationMs !== undefined) {
        lines.push(`- **Duration:** ${result.durationMs} ms`);
      }

      lines.push(
        `- **Finding:** ${inline(result.finding)}`,
        `- **Recommendation:** ${inline(result.recommendation)}`,
      );

      if (result.diagnosticCode) {
        lines.push(`- **Diagnostic:** ${inline(result.diagnosticCode)}`);
      }

      if (result.evidence && result.evidence.length > 0) {
        lines.push("- **Evidence:**");
        for (const evidence of result.evidence) {
          lines.push(`  - ${inline(evidence)}`);
        }
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

export async function writeMarkdownReport(
  report: ScanReport,
  outputPath: string,
): Promise<void> {
  await writeFile(outputPath, renderMarkdownReport(report), "utf8");
}
