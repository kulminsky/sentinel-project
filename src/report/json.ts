import { writeFile } from "node:fs/promises";

import { parseScanReport, type ScanReport } from "../core/result.js";

export function renderJsonReport(report: ScanReport): string {
  return `${JSON.stringify(parseScanReport(report), null, 2)}\n`;
}

export async function writeJsonReport(
  report: ScanReport,
  outputPath: string,
): Promise<void> {
  await writeFile(outputPath, renderJsonReport(report), "utf8");
}
