import assert from "node:assert/strict";
import { test } from "vitest";

import {
  createCheckResult,
  createScanReport,
  type ScanReport,
} from "../src/core/result.js";
import { renderJsonReport } from "../src/report/json.js";
import { renderMarkdownReport } from "../src/report/markdown.js";
import { renderTerminalReport } from "../src/report/terminal.js";

function representativeReport(incomplete = false): ScanReport {
  return createScanReport({
    targetName: "fixture",
    generatedAt: "2026-07-27T00:00:00.000Z",
    incomplete,
    results: [
      createCheckResult({
        checkId: "code.pass",
        title: "Passing code check",
        level: "Code & Repository",
        phase: "static",
        status: "Pass",
        severity: "Info",
        finding: "The code check passed.",
        recommendation: "Keep the check enabled.",
      }),
      createCheckResult({
        checkId: "security.warn",
        title: "Security warning",
        level: "Security",
        phase: "static",
        status: "Warn",
        severity: "Low",
        finding: "A low-risk security concern was found.",
        recommendation: "Review the affected configuration.",
      }),
      createCheckResult({
        checkId: "api.fail",
        title: "API failure",
        level: "API / Backend",
        phase: "runtime",
        status: "Fail",
        severity: "High",
        finding: "The API contract check failed.",
        recommendation: "Correct the API behavior.",
        evidence: ["Expected status: 200"],
      }),
      createCheckResult({
        checkId: "ui.skip",
        title: "Skipped UI check",
        level: "UI / Browser",
        phase: "runtime",
        status: "Skipped",
        severity: "Info",
        finding: "The UI service is not configured.",
        recommendation: "Configure the UI service to enable this check.",
        diagnosticCode: "SERVICE_NOT_CONFIGURED",
      }),
    ],
  });
}

test("createScanReport calculates complete counts and narrative once", () => {
  const report = representativeReport();

  assert.deepEqual(report.overallSummary.statusCounts, {
    Pass: 1,
    Warn: 1,
    Fail: 1,
    Skipped: 1,
  });
  assert.deepEqual(report.overallSummary.severityCounts, {
    Critical: 0,
    High: 1,
    Medium: 0,
    Low: 1,
    Info: 2,
  });
  assert.equal(report.overallSummary.totalResults, 4);
  assert.equal(report.overallSummary.scanStatus, "Complete");
  assert.equal(
    report.overallSummary.narrative,
    "Sentinel produced 4 results: 1 passed, 1 warning, 1 failed, and 1 skipped. All available checks completed without internal execution errors.",
  );
});

test("createScanReport produces the incomplete narrative variant", () => {
  const report = representativeReport(true);

  assert.equal(report.overallSummary.scanStatus, "Incomplete");
  assert.match(
    report.overallSummary.narrative,
    /internal execution error, so the scan is incomplete\.$/,
  );
});

test("all renderers use the normalized summary and required result fields", () => {
  const report = representativeReport();
  const markdown = renderMarkdownReport(report);
  const terminal = renderTerminalReport(report);
  const jsonText = renderJsonReport(report);
  const json = JSON.parse(jsonText) as Record<string, unknown>;
  const jsonResults = json.results as Array<Record<string, unknown>>;

  assert.deepEqual(json.overallSummary, report.overallSummary);
  assert.match(
    markdown,
    /\*\*Status counts:\*\* Pass 1, Warn 1, Fail 1, Skipped 1/,
  );
  assert.match(terminal, /Status counts: Pass 1, Warn 1, Fail 1, Skipped 1/);
  assert.ok(markdown.includes(report.overallSummary.narrative));
  assert.ok(terminal.includes(report.overallSummary.narrative));

  report.results.forEach((result, index) => {
    assert.ok(markdown.includes(`**Status:** ${result.status}`));
    assert.ok(markdown.includes(`**Finding:** ${result.finding}`));
    assert.ok(markdown.includes(`**Severity:** ${result.severity}`));
    assert.ok(
      markdown.includes(`**Recommendation:** ${result.recommendation}`),
    );
    assert.ok(terminal.includes(`Status: ${result.status}`));
    assert.ok(terminal.includes(`Finding: ${result.finding}`));
    assert.ok(terminal.includes(`Severity: ${result.severity}`));
    assert.ok(terminal.includes(`Recommendation: ${result.recommendation}`));
    assert.equal(jsonResults[index]?.status, result.status);
    assert.equal(jsonResults[index]?.finding, result.finding);
    assert.equal(jsonResults[index]?.severity, result.severity);
    assert.equal(jsonResults[index]?.recommendation, result.recommendation);
  });
});

test("JSON is stable, pretty-printed, parseable, and newline-terminated", () => {
  const jsonText = renderJsonReport(representativeReport());
  const parsed = JSON.parse(jsonText) as Record<string, unknown>;

  assert.deepEqual(Object.keys(parsed), [
    "targetName",
    "generatedAt",
    "overallSummary",
    "results",
  ]);
  assert.ok(jsonText.includes('\n  "overallSummary": {'));
  assert.ok(jsonText.endsWith("\n"));
});

test("terminal output is deterministic plain text without ANSI sequences", () => {
  const output = renderTerminalReport(representativeReport());

  assert.match(output, /^SENTINEL QUALITY REPORT\n/);
  assert.equal(output.includes(String.fromCodePoint(27)), false);
});

test("all renderers reject malformed report rows at runtime", () => {
  const malformed = structuredClone(representativeReport()) as unknown as {
    results: Array<Record<string, unknown>>;
  };
  delete malformed.results[3]?.recommendation;

  assert.throws(() => renderMarkdownReport(malformed as unknown as ScanReport));
  assert.throws(() => renderJsonReport(malformed as unknown as ScanReport));
  assert.throws(() => renderTerminalReport(malformed as unknown as ScanReport));
});
