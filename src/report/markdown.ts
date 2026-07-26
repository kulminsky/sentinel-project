import { writeFile } from "node:fs/promises";

import {
  ANALYSIS_LEVELS,
  SEVERITIES,
  STATUSES,
  parseScanReport,
  type ScanReport,
} from "../core/result.js";

function inline(value: string): string {
  return value.replaceAll("\n", " ").trim();
}

export function renderMarkdownReport(report: ScanReport): string {
  const validated = parseScanReport(report);
  const summary = validated.overallSummary;
  const lines = [
    "# Sentinel Quality Report",
    "",
    `- **Target:** ${inline(validated.targetName)}`,
    `- **Generated:** ${validated.generatedAt}`,
    "",
    "## Overall Summary",
    "",
    `- **Scan status:** ${summary.scanStatus}`,
    `- **Results:** ${summary.totalResults}`,
    `- **Status counts:** ${STATUSES.map(
      (status) => `${status} ${summary.statusCounts[status]}`,
    ).join(", ")}`,
    `- **Severity counts:** ${SEVERITIES.map(
      (severity) => `${severity} ${summary.severityCounts[severity]}`,
    ).join(", ")}`,
    "",
    summary.narrative,
  ];

  for (const level of ANALYSIS_LEVELS) {
    const levelResults = validated.results.filter(
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
