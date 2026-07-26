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

export function renderTerminalReport(report: ScanReport): string {
  const validated = parseScanReport(report);
  const summary = validated.overallSummary;
  const lines = [
    "SENTINEL QUALITY REPORT",
    `Target: ${inline(validated.targetName)}`,
    `Generated: ${validated.generatedAt}`,
    "",
    "OVERALL SUMMARY",
    `Scan status: ${summary.scanStatus}`,
    `Results: ${summary.totalResults}`,
    `Status counts: ${STATUSES.map(
      (status) => `${status} ${summary.statusCounts[status]}`,
    ).join(", ")}`,
    `Severity counts: ${SEVERITIES.map(
      (severity) => `${severity} ${summary.severityCounts[severity]}`,
    ).join(", ")}`,
    summary.narrative,
  ];

  for (const level of ANALYSIS_LEVELS) {
    const levelResults = validated.results.filter(
      (result) => result.level === level,
    );

    if (levelResults.length === 0) {
      continue;
    }

    lines.push("", level.toUpperCase());

    for (const result of levelResults) {
      lines.push(
        "",
        inline(result.title),
        `Status: ${result.status}`,
        `Finding: ${inline(result.finding)}`,
        `Severity: ${result.severity}`,
        `Recommendation: ${inline(result.recommendation)}`,
        `Phase: ${result.phase}`,
      );

      if (result.subject !== undefined) {
        lines.push(`Subject: ${inline(result.subject)}`);
      }

      if (result.durationMs !== undefined) {
        lines.push(`Duration: ${result.durationMs} ms`);
      }

      if (result.diagnosticCode !== undefined) {
        lines.push(`Diagnostic: ${inline(result.diagnosticCode)}`);
      }

      if (result.evidence !== undefined) {
        lines.push("Evidence:");
        for (const evidence of result.evidence) {
          lines.push(`  - ${inline(evidence)}`);
        }
      }
    }
  }

  return `${lines.join("\n")}\n`;
}
