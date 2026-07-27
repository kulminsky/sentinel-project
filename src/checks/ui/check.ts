import type { Check, CheckExecution, ScanContext } from "../../core/check.js";
import {
  createCheckResult,
  type CheckResult,
  type CheckResultInput,
  type Severity,
} from "../../core/result.js";
import {
  runPlaywrightSession,
  type AccessibilityIncompleteObservation,
  type AccessibilityViolationObservation,
  type PageViewportObservation,
  type UiSessionRunner,
} from "./session.js";

const CHECK_ID = "ui.browser-analysis";
const CHECK_TITLE = "Playwright browser analysis";
const EXPECTED_VIEWPORT_COUNT = 2;
const MAX_EVIDENCE_ITEMS = 10;

type ResultInput = Omit<
  CheckResultInput,
  "checkId" | "title" | "level" | "phase"
>;

function result(input: ResultInput): CheckResult {
  return createCheckResult({
    checkId: CHECK_ID,
    title: CHECK_TITLE,
    level: "UI / Browser",
    phase: "runtime",
    ...input,
  });
}

function execution(
  results: readonly CheckResult[],
  incomplete = false,
): CheckExecution {
  return {
    results,
    incomplete,
  };
}

function safeLabel(value: string): string {
  return [...value.trim()]
    .map((character) => {
      const codePoint = character.codePointAt(0);
      if (
        codePoint === undefined ||
        codePoint <= 31 ||
        codePoint === 127 ||
        [
          "!",
          "#",
          "(",
          ")",
          "*",
          "[",
          "\\",
          "]",
          "_",
          "`",
          "|",
          "~",
          "<",
          ">",
        ].includes(character)
      ) {
        return "_";
      }

      return character;
    })
    .join("")
    .slice(0, 80);
}

function pageSubject(category: string, pageName: string): string {
  return `${category}: ${safeLabel(pageName)}`;
}

function viewportEvidence(
  observation: PageViewportObservation,
  description: string,
): string {
  return `${safeLabel(observation.viewportName)}: ${description}`;
}

function navigationResult(
  pageName: string,
  observations: readonly PageViewportObservation[],
): CheckResult {
  const failures = observations.filter(
    (observation) => observation.navigation.state === "failed",
  );

  if (failures.length > 0) {
    return result({
      subject: pageSubject("Page load", pageName),
      status: "Fail",
      severity: "High",
      finding: `The configured page did not load successfully at ${failures.length} configured viewport(s).`,
      recommendation:
        "Correct the page response, navigation failure, or cross-origin redirect and rerun the browser scan.",
      evidence: failures.slice(0, MAX_EVIDENCE_ITEMS).map((observation) => {
        const navigation = observation.navigation;
        if (navigation.state !== "failed") {
          return viewportEvidence(observation, "navigation failed");
        }

        const status =
          navigation.statusCode === undefined
            ? ""
            : `; HTTP ${navigation.statusCode}`;
        return viewportEvidence(observation, `${navigation.reason}${status}`);
      }),
      diagnosticCode: "UI_PAGE_LOAD_FAILED",
    });
  }

  if (observations.length !== EXPECTED_VIEWPORT_COUNT) {
    return result({
      subject: pageSubject("Page load", pageName),
      status: "Skipped",
      severity: "Info",
      finding:
        "Sentinel could not observe the configured page at every configured viewport.",
      recommendation:
        "Review the browser execution diagnostic and rerun the scan.",
      diagnosticCode: "UI_PAGE_OBSERVATION_INCOMPLETE",
    });
  }

  return result({
    subject: pageSubject("Page load", pageName),
    status: "Pass",
    severity: "Info",
    finding:
      "The configured page loaded successfully at both configured viewports.",
    recommendation:
      "Keep the page available with successful same-origin responses.",
    evidence: observations.map((observation) => {
      const statusCode =
        observation.navigation.state === "passed"
          ? observation.navigation.statusCode
          : 0;
      return viewportEvidence(observation, `HTTP ${statusCode}`);
    }),
  });
}

function consoleResult(
  pageName: string,
  observations: readonly PageViewportObservation[],
): CheckResult {
  const pageErrors = observations.reduce(
    (total, observation) => total + observation.pageErrorCount,
    0,
  );
  const consoleErrors = observations.reduce(
    (total, observation) => total + observation.consoleErrorCount,
    0,
  );

  if (pageErrors > 0) {
    return result({
      subject: pageSubject("Console", pageName),
      status: "Fail",
      severity: "High",
      finding: `The page produced ${pageErrors} uncaught browser exception(s).`,
      recommendation:
        "Resolve the uncaught client-side exceptions and rerun the browser scan.",
      evidence: [
        `Uncaught page exceptions: ${pageErrors}`,
        `Console error events: ${consoleErrors}`,
      ],
    });
  }

  if (consoleErrors > 0) {
    return result({
      subject: pageSubject("Console", pageName),
      status: "Warn",
      severity: "Medium",
      finding: `The page produced ${consoleErrors} console error event(s).`,
      recommendation:
        "Remove unexpected console errors or handle the underlying client-side failures.",
      evidence: [`Console error events: ${consoleErrors}`],
    });
  }

  if (
    observations.length !== EXPECTED_VIEWPORT_COUNT ||
    observations.some(
      (observation) => observation.navigation.state !== "passed",
    )
  ) {
    return result({
      subject: pageSubject("Console", pageName),
      status: "Skipped",
      severity: "Info",
      finding:
        "Console behavior could not be verified across every configured viewport.",
      recommendation:
        "Restore successful page navigation and rerun the browser scan.",
      diagnosticCode: "UI_CONSOLE_OBSERVATION_INCOMPLETE",
    });
  }

  return result({
    subject: pageSubject("Console", pageName),
    status: "Pass",
    severity: "Info",
    finding:
      "The page produced no console errors or uncaught exceptions at either configured viewport.",
    recommendation:
      "Keep browser console output free from unexpected error events.",
  });
}

function brokenImageResult(
  pageName: string,
  observations: readonly PageViewportObservation[],
): CheckResult {
  const resourceIds = new Set<string>();
  const paths = new Set<string>();
  let maximumViewportCount = 0;
  let unavailable = false;

  for (const observation of observations) {
    if (observation.brokenImages.state === "unavailable") {
      unavailable = true;
      continue;
    }

    maximumViewportCount = Math.max(
      maximumViewportCount,
      observation.brokenImages.value.totalCount,
    );
    for (const resourceId of observation.brokenImages.value.resourceIds) {
      resourceIds.add(resourceId);
    }

    for (const path of observation.brokenImages.value.evidencePaths) {
      paths.add(path);
    }
  }

  const totalCount = Math.max(resourceIds.size, maximumViewportCount);
  if (totalCount > 0) {
    return result({
      subject: pageSubject("Images", pageName),
      status: "Fail",
      severity: "Medium",
      finding: `The page contains ${totalCount} broken image resource(s).`,
      recommendation:
        "Restore the missing image resources or correct their source paths.",
      evidence: [...paths]
        .slice(0, MAX_EVIDENCE_ITEMS)
        .map((path) => `Image path: ${path}`),
    });
  }

  if (
    unavailable ||
    observations.length !== EXPECTED_VIEWPORT_COUNT ||
    observations.some(
      (observation) => observation.navigation.state !== "passed",
    )
  ) {
    return result({
      subject: pageSubject("Images", pageName),
      status: "Skipped",
      severity: "Info",
      finding:
        "Broken-image coverage could not be completed across every configured viewport.",
      recommendation:
        "Restore page navigation or browser observation support and rerun the scan.",
      diagnosticCode: "UI_IMAGE_OBSERVATION_INCOMPLETE",
    });
  }

  return result({
    subject: pageSubject("Images", pageName),
    status: "Pass",
    severity: "Info",
    finding:
      "No broken image resources were detected at either configured viewport.",
    recommendation: "Keep image resources available and correctly referenced.",
  });
}

const ACCESSIBILITY_RANK: Record<
  AccessibilityViolationObservation["impact"],
  number
> = {
  unknown: 1,
  minor: 1,
  moderate: 2,
  serious: 3,
  critical: 4,
};

function accessibilitySeverity(
  violations: readonly AccessibilityViolationObservation[],
): {
  readonly status: "Fail" | "Warn";
  readonly severity: Severity;
} {
  const rank = Math.max(
    ...violations.map((violation) => ACCESSIBILITY_RANK[violation.impact]),
  );

  if (rank >= ACCESSIBILITY_RANK.serious) {
    return {
      status: "Fail",
      severity: "High",
    };
  }

  if (rank >= ACCESSIBILITY_RANK.moderate) {
    return {
      status: "Warn",
      severity: "Medium",
    };
  }

  return {
    status: "Warn",
    severity: "Low",
  };
}

function accessibilityResult(
  pageName: string,
  observations: readonly PageViewportObservation[],
): CheckResult {
  const violationsByKey = new Map<string, AccessibilityViolationObservation>();
  const incompleteById = new Map<string, AccessibilityIncompleteObservation>();
  let unavailable = false;

  for (const observation of observations) {
    if (observation.accessibility.state === "unavailable") {
      unavailable = true;
      continue;
    }

    for (const violation of observation.accessibility.value.violations) {
      const key = `${violation.id}:${violation.impact}`;
      const existing = violationsByKey.get(key);
      violationsByKey.set(key, {
        ...violation,
        nodeCount: Math.max(existing?.nodeCount ?? 0, violation.nodeCount),
      });
    }

    for (const incomplete of observation.accessibility.value.incomplete) {
      const existing = incompleteById.get(incomplete.id);
      incompleteById.set(incomplete.id, {
        ...incomplete,
        nodeCount: Math.max(existing?.nodeCount ?? 0, incomplete.nodeCount),
      });
    }
  }

  const violations = [...violationsByKey.values()];
  const incomplete = [...incompleteById.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  if (violations.length > 0) {
    const classification = accessibilitySeverity(violations);
    const violationEvidence = violations
      .sort(
        (left, right) =>
          ACCESSIBILITY_RANK[right.impact] - ACCESSIBILITY_RANK[left.impact] ||
          left.id.localeCompare(right.id),
      )
      .map(
        (violation) =>
          `Rule: ${safeLabel(violation.id)}; impact: ${violation.impact}; affected nodes: ${violation.nodeCount}`,
      );
    const incompleteEvidence = incomplete.map(
      (candidate) =>
        `Indeterminate rule: ${safeLabel(candidate.id)}; affected nodes: ${candidate.nodeCount}`,
    );
    return result({
      subject: pageSubject("Accessibility", pageName),
      status: classification.status,
      severity: classification.severity,
      finding:
        incomplete.length === 0
          ? `The axe WCAG A/AA scan detected ${violations.length} accessibility rule violation(s).`
          : `The axe WCAG A/AA scan detected ${violations.length} accessibility rule violation(s), while ${incomplete.length} additional rule(s) remained indeterminate.`,
      recommendation:
        "Correct the reported axe rules and verify the page with assistive-technology-focused testing.",
      evidence: [...violationEvidence, ...incompleteEvidence].slice(
        0,
        MAX_EVIDENCE_ITEMS,
      ),
      ...(unavailable || incomplete.length > 0
        ? {
            diagnosticCode: "UI_ACCESSIBILITY_PARTIAL",
          }
        : {}),
    });
  }

  if (incomplete.length > 0) {
    return result({
      subject: pageSubject("Accessibility", pageName),
      status: "Skipped",
      severity: "Info",
      finding: `The axe WCAG A/AA scan returned ${incomplete.length} indeterminate accessibility rule result(s), so Sentinel cannot claim a pass.`,
      recommendation:
        "Review the indeterminate axe rules manually or simplify the affected rendering conditions, then rerun the browser scan.",
      evidence: incomplete
        .slice(0, MAX_EVIDENCE_ITEMS)
        .map(
          (candidate) =>
            `Indeterminate rule: ${safeLabel(candidate.id)}; affected nodes: ${candidate.nodeCount}`,
        ),
      diagnosticCode: "UI_ACCESSIBILITY_INDETERMINATE",
    });
  }

  if (
    unavailable ||
    observations.length !== EXPECTED_VIEWPORT_COUNT ||
    observations.some(
      (observation) => observation.navigation.state !== "passed",
    )
  ) {
    return result({
      subject: pageSubject("Accessibility", pageName),
      status: "Skipped",
      severity: "Info",
      finding:
        "The axe accessibility pass could not complete across every configured viewport.",
      recommendation:
        "Restore page navigation or axe execution and rerun the browser scan.",
      diagnosticCode: "UI_ACCESSIBILITY_UNAVAILABLE",
    });
  }

  return result({
    subject: pageSubject("Accessibility", pageName),
    status: "Pass",
    severity: "Info",
    finding:
      "The axe WCAG A/AA pass detected no accessibility violations at either configured viewport.",
    recommendation:
      "Keep automated accessibility checks in place and supplement them with manual review.",
  });
}

function horizontalOverflowResult(
  pageName: string,
  observations: readonly PageViewportObservation[],
): CheckResult {
  const overflowing = observations.filter(
    (observation) =>
      observation.horizontalOverflow.state === "available" &&
      observation.horizontalOverflow.value,
  );

  if (overflowing.length > 0) {
    return result({
      subject: pageSubject("Horizontal overflow", pageName),
      status: "Warn",
      severity: "Medium",
      finding: `The page overflows horizontally at ${overflowing.length} configured viewport(s).`,
      recommendation:
        "Correct the overflowing layout and verify it at both configured viewport sizes.",
      evidence: overflowing
        .slice(0, MAX_EVIDENCE_ITEMS)
        .map((observation) =>
          viewportEvidence(observation, "horizontal overflow detected"),
        ),
    });
  }

  if (
    observations.length !== EXPECTED_VIEWPORT_COUNT ||
    observations.some(
      (observation) =>
        observation.navigation.state !== "passed" ||
        observation.horizontalOverflow.state === "unavailable",
    )
  ) {
    return result({
      subject: pageSubject("Horizontal overflow", pageName),
      status: "Skipped",
      severity: "Info",
      finding:
        "Horizontal overflow could not be observed at every configured viewport.",
      recommendation:
        "Restore page navigation or layout observation and rerun the browser scan.",
      diagnosticCode: "UI_HORIZONTAL_OVERFLOW_OBSERVATION_INCOMPLETE",
    });
  }

  return result({
    subject: pageSubject("Horizontal overflow", pageName),
    status: "Pass",
    severity: "Info",
    finding:
      "The page has no horizontal document overflow at either configured viewport.",
    recommendation:
      "Keep horizontal-overflow observations active for both configured viewport sizes; use explicit configured assertions for other layout behavior.",
  });
}

export function createUiBrowserCheck(
  runSession: UiSessionRunner = runPlaywrightSession,
): Check {
  return {
    id: CHECK_ID,
    title: CHECK_TITLE,
    level: "UI / Browser",
    phase: "runtime",
    timeoutMs: 125_000,
    async run(context: ScanContext, signal: AbortSignal) {
      const ui = context.config.ui;
      if (
        ui === undefined ||
        context.reachability.ui.state === "not-configured"
      ) {
        return execution([
          result({
            status: "Skipped",
            severity: "Info",
            finding:
              "No UI service is configured for Playwright browser analysis.",
            recommendation:
              "Add the optional UI configuration when browser verification is required.",
            diagnosticCode: "UI_NOT_CONFIGURED",
          }),
        ]);
      }

      if (context.reachability.ui.state === "unreachable") {
        return execution([
          result({
            status: "Skipped",
            severity: "Info",
            finding:
              "The configured UI service is unavailable, so browser analysis was not started.",
            recommendation:
              "Start the UI service externally or correct its configuration, then retry the scan.",
            diagnosticCode: "UI_RUNTIME_UNAVAILABLE",
          }),
        ]);
      }

      if (ui.pages.length === 0 && (ui.formFlows?.length ?? 0) === 0) {
        return execution([
          result({
            status: "Skipped",
            severity: "Info",
            finding:
              "The UI service is reachable, but no pages or form flows are configured for browser analysis.",
            recommendation:
              "Configure at least one UI page or form flow when browser verification is required.",
            diagnosticCode: "UI_BROWSER_TARGETS_NOT_CONFIGURED",
          }),
        ]);
      }

      const outcome = await runSession({
        config: ui,
        resolveEnvironmentReference: context.resolveEnvironmentReference,
        signal,
      });

      if (outcome.state === "browser-unavailable") {
        return execution(
          [
            result({
              status: "Skipped",
              severity: "Info",
              finding:
                "Playwright could not launch its required Chromium browser.",
              recommendation:
                "Install the compatible browser with `npx playwright install chromium`, then retry the scan.",
              diagnosticCode: "PLAYWRIGHT_BROWSER_UNAVAILABLE",
            }),
          ],
          true,
        );
      }

      if (outcome.state === "session-unavailable") {
        return execution(
          [
            result({
              status: "Skipped",
              severity: "Info",
              finding:
                "Playwright launched Chromium but could not initialize the browser session.",
              recommendation:
                "Review the local Chromium runtime dependencies and retry the scan.",
              diagnosticCode: "PLAYWRIGHT_SESSION_UNAVAILABLE",
            }),
          ],
          true,
        );
      }

      const results: CheckResult[] = [];

      if (outcome.authenticatedTargetsUnavailable) {
        results.push(
          result({
            subject: "Authenticated UI targets",
            status: "Skipped",
            severity: "Info",
            finding:
              "Configured authentication could not be prepared for protected UI targets.",
            recommendation:
              "Provide the referenced header values or a readable Playwright storage-state file, then retry the scan.",
            diagnosticCode: "UI_AUTHENTICATION_UNAVAILABLE",
          }),
        );
      }

      for (const page of ui.pages) {
        if (page.useAuthentication && outcome.authenticatedTargetsUnavailable) {
          continue;
        }

        const observations = outcome.pageObservations.filter(
          (observation) => observation.pageName === page.name,
        );
        if (observations.length === 0) {
          results.push(
            result({
              subject: pageSubject("Page", page.name),
              status: "Skipped",
              severity: "Info",
              finding:
                "Sentinel could not collect browser observations for this configured page.",
              recommendation:
                "Review the browser execution diagnostic and rerun the scan.",
              diagnosticCode: "UI_PAGE_OBSERVATION_UNAVAILABLE",
            }),
          );
          continue;
        }

        results.push(
          navigationResult(page.name, observations),
          consoleResult(page.name, observations),
          brokenImageResult(page.name, observations),
          accessibilityResult(page.name, observations),
          horizontalOverflowResult(page.name, observations),
        );
      }

      const formFlows = ui.formFlows ?? [];
      if (formFlows.length === 0) {
        results.push(
          result({
            subject: "Configured form flows",
            status: "Skipped",
            severity: "Info",
            finding: "No optional UI form flow is configured.",
            recommendation:
              "Configure a bounded form flow when an important user journey requires browser verification.",
            diagnosticCode: "UI_FORM_FLOW_NOT_CONFIGURED",
          }),
        );
      } else {
        for (const flow of formFlows) {
          if (
            flow.useAuthentication &&
            outcome.authenticatedTargetsUnavailable
          ) {
            continue;
          }

          const observation = outcome.formObservations.find(
            (candidate) => candidate.flowName === flow.name,
          );
          if (observation === undefined) {
            results.push(
              result({
                subject: `Form flow: ${safeLabel(flow.name)}`,
                status: "Skipped",
                severity: "Info",
                finding:
                  "Sentinel could not execute this configured form flow.",
                recommendation:
                  "Review the browser execution diagnostic and retry the flow.",
                diagnosticCode: "UI_FORM_FLOW_UNAVAILABLE",
              }),
            );
            continue;
          }

          if (observation.state === "passed") {
            results.push(
              result({
                subject: `Form flow: ${safeLabel(flow.name)}`,
                status: "Pass",
                severity: "Info",
                finding:
                  "The configured form flow completed all actions and assertions.",
                recommendation:
                  "Keep this bounded flow synchronized with the user journey it verifies.",
              }),
            );
            continue;
          }

          if (observation.state === "prerequisite-missing") {
            results.push(
              result({
                subject: `Form flow: ${safeLabel(flow.name)}`,
                status: "Skipped",
                severity: "Info",
                finding:
                  "The configured form flow is missing an environment-backed input value.",
                recommendation:
                  "Provide every referenced form-value environment variable and retry the flow.",
                diagnosticCode: "UI_FORM_PREREQUISITE_MISSING",
              }),
            );
            continue;
          }

          results.push(
            result({
              subject: `Form flow: ${safeLabel(flow.name)}`,
              status: "Fail",
              severity: "High",
              finding: `The configured form flow failed at step ${observation.stepIndex} (${safeLabel(observation.stepType)}).`,
              recommendation:
                "Correct the target behavior or update the configured flow to match the intended user journey.",
              evidence: [
                `Failed step: ${observation.stepIndex}`,
                `Step type: ${safeLabel(observation.stepType)}`,
              ],
              diagnosticCode: "UI_FORM_FLOW_FAILED",
            }),
          );
        }
      }

      if (outcome.budgetExceeded) {
        results.push(
          result({
            subject: "Browser coverage",
            status: "Skipped",
            severity: "Info",
            finding:
              "Sentinel reached the browser-analysis time budget before every target completed.",
            recommendation:
              "Reduce configured browser work or improve target responsiveness, then retry the scan.",
            diagnosticCode: "UI_BROWSER_BUDGET_EXCEEDED",
          }),
        );
      }

      if (results.length === 0) {
        results.push(
          result({
            status: "Skipped",
            severity: "Info",
            finding:
              "No browser result could be produced from the configured UI targets.",
            recommendation:
              "Review UI authentication and browser prerequisites, then retry the scan.",
            diagnosticCode: "UI_BROWSER_ANALYSIS_UNAVAILABLE",
          }),
        );
      }

      return execution(
        results,
        outcome.budgetExceeded || outcome.internalObservationFailure,
      );
    },
  };
}

export const uiBrowserCheck = createUiBrowserCheck();
