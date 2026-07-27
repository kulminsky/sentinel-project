import { createHash } from "node:crypto";

import { AxeBuilder } from "@axe-core/playwright";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "playwright";

import type { EnvironmentReferenceResolver } from "../../ai/config.js";
import type { SentinelConfig } from "../../config/schema.js";

const ACCESSIBILITY_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
] as const;
const INTERNAL_BUDGET_MS = 120_000;
const CLEANUP_BUDGET_MS = 4_000;
const MAX_EVIDENCE_ITEMS = 10;

type UiConfig = NonNullable<SentinelConfig["ui"]>;
type UiPage = UiConfig["pages"][number];
type UiViewport = UiConfig["viewports"][number];
type UiFormFlow = NonNullable<UiConfig["formFlows"]>[number];
type CompletedUiSessionOutcome = Extract<
  UiSessionOutcome,
  {
    state: "completed";
  }
>;
type MutableCompletedUiSessionOutcome = {
  -readonly [
    Key in keyof CompletedUiSessionOutcome
  ]: CompletedUiSessionOutcome[Key];
};

export interface AccessibilityViolationObservation {
  readonly id: string;
  readonly impact: "critical" | "serious" | "moderate" | "minor" | "unknown";
  readonly nodeCount: number;
}

export interface AccessibilityIncompleteObservation {
  readonly id: string;
  readonly nodeCount: number;
}

export interface AccessibilityAnalysisObservation {
  readonly violations: readonly AccessibilityViolationObservation[];
  readonly incomplete: readonly AccessibilityIncompleteObservation[];
}

export type ObservationState<T> =
  | {
      readonly state: "available";
      readonly value: T;
    }
  | {
      readonly state: "unavailable";
    };

export type NavigationObservation =
  | {
      readonly state: "passed";
      readonly statusCode: number;
    }
  | {
      readonly state: "failed";
      readonly reason: "http-error" | "navigation-error" | "external-redirect";
      readonly statusCode?: number;
    };

export interface BrokenImageObservation {
  readonly totalCount: number;
  readonly resourceIds: readonly string[];
  readonly evidencePaths: readonly string[];
}

export interface PageViewportObservation {
  readonly pageName: string;
  readonly viewportName: string;
  readonly navigation: NavigationObservation;
  readonly consoleErrorCount: number;
  readonly pageErrorCount: number;
  readonly brokenImages: ObservationState<BrokenImageObservation>;
  readonly accessibility: ObservationState<AccessibilityAnalysisObservation>;
  readonly horizontalOverflow: ObservationState<boolean>;
}

export type FormFlowObservation =
  | {
      readonly flowName: string;
      readonly state: "passed";
    }
  | {
      readonly flowName: string;
      readonly state: "failed";
      readonly stepIndex: number;
      readonly stepType: string;
    }
  | {
      readonly flowName: string;
      readonly state: "prerequisite-missing";
    };

export type UiSessionOutcome =
  | {
      readonly state: "browser-unavailable";
    }
  | {
      readonly state: "session-unavailable";
    }
  | {
      readonly state: "completed";
      readonly pageObservations: readonly PageViewportObservation[];
      readonly formObservations: readonly FormFlowObservation[];
      readonly authenticatedTargetsUnavailable: boolean;
      readonly budgetExceeded: boolean;
      readonly internalObservationFailure: boolean;
    };

export interface UiSessionInput {
  readonly config: UiConfig;
  readonly resolveEnvironmentReference: EnvironmentReferenceResolver;
  readonly signal: AbortSignal;
}

export type UiSessionRunner = (
  input: UiSessionInput,
) => Promise<UiSessionOutcome>;

interface SessionDependencies {
  readonly launchBrowser: (timeoutMs: number) => Promise<Browser>;
  readonly analyzeAccessibility: (
    page: Page,
  ) => Promise<AccessibilityAnalysisObservation>;
}

interface FormFlowExecution {
  readonly observation: FormFlowObservation;
  internalFailure: boolean;
}

class BudgetExceededError extends Error {}
class OperationTimeoutError extends Error {}

function remainingBudget(deadline: number): number {
  return Math.max(0, Math.floor(deadline - performance.now()));
}

function operationTimeout(configuredTimeout: number, deadline: number): number {
  const remaining = remainingBudget(deadline);
  if (remaining <= 0) {
    throw new BudgetExceededError();
  }

  return Math.max(1, Math.min(configuredTimeout, remaining));
}

async function runPlaywrightOperation<T>(
  operation: () => Promise<T>,
  configuredTimeout: number,
  deadline: number,
  disposeLateResult?: (value: T) => Promise<unknown>,
): Promise<T> {
  const remaining = remainingBudget(deadline);
  if (remaining <= 0) {
    throw new BudgetExceededError();
  }

  const timeoutMs = Math.max(1, Math.min(configuredTimeout, remaining));
  const timeoutError =
    remaining <= configuredTimeout
      ? new BudgetExceededError()
      : new OperationTimeoutError();
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(timeoutError);
    }, timeoutMs);
  });
  try {
    const operationPromise = operation();
    if (disposeLateResult !== undefined) {
      void operationPromise
        .then(async (value) => {
          if (timedOut) {
            await disposeLateResult(value);
          }
        })
        .catch(() => undefined);
    }

    return await Promise.race([operationPromise, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function closePlaywrightResource(
  close: () => Promise<unknown>,
  deadline: number,
): Promise<boolean> {
  const remaining = remainingBudget(deadline);
  if (remaining <= 0) {
    try {
      void close().catch(() => undefined);
    } catch {
      // The shared cleanup deadline has already elapsed.
    }
    return false;
  }

  const timeoutMs = Math.max(1, remaining);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new OperationTimeoutError()), timeoutMs);
  });

  try {
    await Promise.race([close(), timeout]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function createCleanupDeadline(
  configuredTimeout: number,
  sessionDeadline: number,
): number {
  return Math.min(
    sessionDeadline,
    performance.now() + Math.min(configuredTimeout, CLEANUP_BUDGET_MS),
  );
}

function containsUnsafeHeaderCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

function resolveAuthenticationHeaders(
  config: UiConfig,
  resolveEnvironmentReference: EnvironmentReferenceResolver,
): Record<string, string> | undefined {
  if (
    config.authentication === undefined ||
    config.authentication.kind !== "headers"
  ) {
    return {};
  }

  const headers: Record<string, string> = {};

  try {
    for (const [name, reference] of Object.entries(
      config.authentication.headers,
    )) {
      const value = resolveEnvironmentReference(reference.env);
      if (
        value === undefined ||
        value.trim().length === 0 ||
        containsUnsafeHeaderCharacter(value)
      ) {
        return undefined;
      }

      headers[name] = value;
    }
  } catch {
    return undefined;
  }

  return headers;
}

async function createAuthenticatedContext(
  browser: Browser,
  config: UiConfig,
  resolveEnvironmentReference: EnvironmentReferenceResolver,
  deadline: number,
  sessionDeadline: number,
): Promise<BrowserContext | undefined> {
  const authentication = config.authentication;
  if (authentication === undefined) {
    return undefined;
  }

  if (authentication.kind === "storageState") {
    try {
      return await runPlaywrightOperation(
        () =>
          browser.newContext({
            storageState: authentication.path,
          }),
        config.timeoutMs,
        deadline,
        (context) =>
          closePlaywrightResource(
            () => context.close(),
            createCleanupDeadline(config.timeoutMs, sessionDeadline),
          ),
      );
    } catch (error: unknown) {
      if (
        error instanceof BudgetExceededError ||
        error instanceof OperationTimeoutError
      ) {
        throw error;
      }

      return undefined;
    }
  }

  const headers = resolveAuthenticationHeaders(
    config,
    resolveEnvironmentReference,
  );
  if (headers === undefined) {
    return undefined;
  }

  let context: BrowserContext;
  try {
    context = await runPlaywrightOperation(
      () => browser.newContext(),
      config.timeoutMs,
      deadline,
      (context) =>
        closePlaywrightResource(
          () => context.close(),
          createCleanupDeadline(config.timeoutMs, sessionDeadline),
        ),
    );
  } catch (error: unknown) {
    if (
      error instanceof BudgetExceededError ||
      error instanceof OperationTimeoutError
    ) {
      throw error;
    }

    return undefined;
  }

  const baseOrigin = new URL(config.baseUrl).origin;

  try {
    await runPlaywrightOperation(
      () =>
        context.route("**/*", async (route) => {
          let sameOrigin = false;
          try {
            sameOrigin = new URL(route.request().url()).origin === baseOrigin;
          } catch {
            sameOrigin = false;
          }

          if (!sameOrigin) {
            await runPlaywrightOperation(
              () => route.continue(),
              config.timeoutMs,
              deadline,
            );
            return;
          }

          await runPlaywrightOperation(
            () =>
              route.continue({
                headers: {
                  ...route.request().headers(),
                  ...headers,
                },
              }),
            config.timeoutMs,
            deadline,
          );
        }),
      config.timeoutMs,
      deadline,
    );
  } catch (error: unknown) {
    await closePlaywrightResource(
      () => context.close(),
      createCleanupDeadline(config.timeoutMs, sessionDeadline),
    );
    if (
      error instanceof BudgetExceededError ||
      error instanceof OperationTimeoutError
    ) {
      throw error;
    }

    return undefined;
  }

  return context;
}

function brokenImageResourceId(value: string): string {
  let canonicalValue = value;

  try {
    const url = new URL(value);
    url.hash = "";
    canonicalValue = url.href;
  } catch {
    // Invalid values remain distinct without being rendered.
  }

  return createHash("sha256").update(canonicalValue).digest("hex");
}

function safeImagePath(value: string, baseOrigin: string): string {
  try {
    const url = new URL(value);
    if (url.origin !== baseOrigin) {
      return "External image resource";
    }

    const pathname = [...url.pathname]
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
          return `%${(codePoint ?? 0).toString(16).toUpperCase()}`;
        }

        return character;
      })
      .join("");

    return pathname.slice(0, 160);
  } catch {
    return "Invalid image resource";
  }
}

async function observePageAtViewport(
  context: BrowserContext,
  config: UiConfig,
  pageConfig: UiPage,
  viewport: UiViewport,
  deadline: number,
  sessionDeadline: number,
  analyzeAccessibility: SessionDependencies["analyzeAccessibility"],
): Promise<{
  readonly observation: PageViewportObservation;
  readonly internalFailure: boolean;
}> {
  const page = await runPlaywrightOperation(
    () => context.newPage(),
    config.timeoutMs,
    deadline,
    (page) =>
      closePlaywrightResource(
        () => page.close(),
        createCleanupDeadline(config.timeoutMs, sessionDeadline),
      ),
  );
  let pageOutcome:
    | {
        observation: PageViewportObservation;
        internalFailure: boolean;
      }
    | undefined;
  const baseOrigin = new URL(config.baseUrl).origin;
  const consoleErrors: number[] = [];
  const pageErrors: number[] = [];
  const brokenImages = new Map<string, string>();
  const recordBrokenImage = (value: string): void => {
    brokenImages.set(
      brokenImageResourceId(value),
      safeImagePath(value, baseOrigin),
    );
  };

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(1);
    }
  });
  page.on("pageerror", () => {
    pageErrors.push(1);
  });
  page.on("requestfailed", (request) => {
    if (request.resourceType() === "image") {
      recordBrokenImage(request.url());
    }
  });
  page.on("response", (response) => {
    if (
      response.request().resourceType() === "image" &&
      response.status() >= 400
    ) {
      recordBrokenImage(response.url());
    }
  });

  try {
    await runPlaywrightOperation(
      () =>
        page.setViewportSize({
          width: viewport.width,
          height: viewport.height,
        }),
      config.timeoutMs,
      deadline,
    );
    page.setDefaultTimeout(operationTimeout(config.timeoutMs, deadline));
    page.setDefaultNavigationTimeout(
      operationTimeout(config.timeoutMs, deadline),
    );

    let navigation: NavigationObservation;
    try {
      const response = await runPlaywrightOperation(
        () =>
          page.goto(new URL(pageConfig.path, config.baseUrl).href, {
            waitUntil: "load",
            timeout: operationTimeout(config.timeoutMs, deadline),
          }),
        config.timeoutMs,
        deadline,
      );

      if (response === null) {
        navigation = {
          state: "failed",
          reason: "navigation-error",
        };
      } else if (new URL(response.url()).origin !== baseOrigin) {
        navigation = {
          state: "failed",
          reason: "external-redirect",
          statusCode: response.status(),
        };
      } else if (response.status() < 200 || response.status() >= 400) {
        navigation = {
          state: "failed",
          reason: "http-error",
          statusCode: response.status(),
        };
      } else {
        navigation = {
          state: "passed",
          statusCode: response.status(),
        };
      }
    } catch (error: unknown) {
      if (error instanceof BudgetExceededError) {
        throw error;
      }

      navigation = {
        state: "failed",
        reason: "navigation-error",
      };
    }

    if (navigation.state === "failed") {
      pageOutcome = {
        observation: {
          pageName: pageConfig.name,
          viewportName: viewport.name,
          navigation,
          consoleErrorCount: consoleErrors.length,
          pageErrorCount: pageErrors.length,
          brokenImages: {
            state: "unavailable",
          },
          accessibility: {
            state: "unavailable",
          },
          horizontalOverflow: {
            state: "unavailable",
          },
        },
        internalFailure: false,
      };
      return pageOutcome;
    }

    let images: ObservationState<BrokenImageObservation> = {
      state: "unavailable",
    };
    let accessibility: ObservationState<AccessibilityAnalysisObservation> = {
      state: "unavailable",
    };
    let horizontalOverflow: ObservationState<boolean> = {
      state: "unavailable",
    };
    let internalFailure = false;
    const finishObservation = (): {
      observation: PageViewportObservation;
      internalFailure: boolean;
    } => {
      pageOutcome = {
        observation: {
          pageName: pageConfig.name,
          viewportName: viewport.name,
          navigation,
          consoleErrorCount: consoleErrors.length,
          pageErrorCount: pageErrors.length,
          brokenImages: images,
          accessibility,
          horizontalOverflow,
        },
        internalFailure,
      };
      return pageOutcome;
    };

    try {
      const domImageSources = await runPlaywrightOperation(
        () =>
          page
            .locator("img")
            .evaluateAll((images) =>
              images
                .filter(
                  (image): image is HTMLImageElement =>
                    image instanceof HTMLImageElement &&
                    image.complete &&
                    (image.naturalWidth === 0 || image.naturalHeight === 0),
                )
                .map((image) => image.currentSrc || image.src),
            ),
        config.timeoutMs,
        deadline,
      );
      for (const source of domImageSources) {
        recordBrokenImage(source);
      }
      images = {
        state: "available",
        value: {
          totalCount: brokenImages.size,
          resourceIds: [...brokenImages.keys()],
          evidencePaths: [...new Set(brokenImages.values())].slice(
            0,
            MAX_EVIDENCE_ITEMS,
          ),
        },
      };
    } catch (error: unknown) {
      if (error instanceof BudgetExceededError) {
        throw error;
      }

      internalFailure = true;
      if (error instanceof OperationTimeoutError) {
        return finishObservation();
      }
    }

    try {
      horizontalOverflow = {
        state: "available",
        value: await runPlaywrightOperation(
          () =>
            page.evaluate(
              () =>
                document.documentElement.scrollWidth >
                document.documentElement.clientWidth + 1,
            ),
          config.timeoutMs,
          deadline,
        ),
      };
    } catch (error: unknown) {
      if (error instanceof BudgetExceededError) {
        throw error;
      }

      internalFailure = true;
      if (error instanceof OperationTimeoutError) {
        return finishObservation();
      }
    }

    try {
      accessibility = {
        state: "available",
        value: await runPlaywrightOperation(
          () => analyzeAccessibility(page),
          config.timeoutMs,
          deadline,
        ),
      };
    } catch (error: unknown) {
      if (error instanceof BudgetExceededError) {
        throw error;
      }

      internalFailure = true;
      if (error instanceof OperationTimeoutError) {
        return finishObservation();
      }
    }

    return finishObservation();
  } finally {
    const pageClosed = await closePlaywrightResource(
      () => page.close(),
      createCleanupDeadline(config.timeoutMs, sessionDeadline),
    );
    if (!pageClosed && pageOutcome !== undefined) {
      pageOutcome.internalFailure = true;
    }
  }
}

function resolveFormValues(
  flow: UiFormFlow,
  resolveEnvironmentReference: EnvironmentReferenceResolver,
): readonly (string | undefined)[] | undefined {
  const values: Array<string | undefined> = [];

  try {
    for (const step of flow.steps) {
      if (step.type !== "fill") {
        values.push(undefined);
        continue;
      }

      if (step.value.source === "literal") {
        values.push(step.value.value);
        continue;
      }

      const value = resolveEnvironmentReference(step.value.env);
      if (value === undefined) {
        return undefined;
      }

      values.push(value);
    }
  } catch {
    return undefined;
  }

  return values;
}

async function navigateFormPage(
  page: Page,
  config: UiConfig,
  path: string,
  deadline: number,
): Promise<void> {
  const response = await runPlaywrightOperation(
    () =>
      page.goto(new URL(path, config.baseUrl).href, {
        waitUntil: "load",
        timeout: operationTimeout(config.timeoutMs, deadline),
      }),
    config.timeoutMs,
    deadline,
  );
  if (
    response === null ||
    response.status() < 200 ||
    response.status() >= 400 ||
    new URL(response.url()).origin !== new URL(config.baseUrl).origin
  ) {
    throw new Error("Form navigation failed.");
  }
}

async function executeFormFlow(
  context: BrowserContext,
  config: UiConfig,
  flow: UiFormFlow,
  resolveEnvironmentReference: EnvironmentReferenceResolver,
  deadline: number,
  sessionDeadline: number,
): Promise<FormFlowExecution> {
  const values = resolveFormValues(flow, resolveEnvironmentReference);
  if (values === undefined) {
    return {
      observation: {
        flowName: flow.name,
        state: "prerequisite-missing",
      },
      internalFailure: false,
    };
  }

  const page = await runPlaywrightOperation(
    () => context.newPage(),
    config.timeoutMs,
    deadline,
    (page) =>
      closePlaywrightResource(
        () => page.close(),
        createCleanupDeadline(config.timeoutMs, sessionDeadline),
      ),
  );
  const widestViewport = [...config.viewports].sort(
    (left, right) => right.width - left.width,
  )[0];
  let execution: FormFlowExecution | undefined;
  const complete = (observation: FormFlowObservation): FormFlowExecution => {
    execution = {
      observation,
      internalFailure: false,
    };
    return execution;
  };

  try {
    if (widestViewport === undefined) {
      return complete({
        flowName: flow.name,
        state: "failed",
        stepIndex: 0,
        stepType: "start",
      });
    }

    await runPlaywrightOperation(
      () =>
        page.setViewportSize({
          width: widestViewport.width,
          height: widestViewport.height,
        }),
      config.timeoutMs,
      deadline,
    );
    page.setDefaultTimeout(operationTimeout(config.timeoutMs, deadline));
    page.setDefaultNavigationTimeout(
      operationTimeout(config.timeoutMs, deadline),
    );

    try {
      await navigateFormPage(page, config, flow.startPath, deadline);
    } catch (error: unknown) {
      if (error instanceof BudgetExceededError) {
        throw error;
      }

      return complete({
        flowName: flow.name,
        state: "failed",
        stepIndex: 0,
        stepType: "start",
      });
    }

    for (const [index, step] of flow.steps.entries()) {
      try {
        switch (step.type) {
          case "goto":
            await navigateFormPage(page, config, step.path, deadline);
            break;
          case "fill":
            await runPlaywrightOperation(
              () =>
                page.locator(step.selector).fill(values[index] ?? "", {
                  timeout: operationTimeout(config.timeoutMs, deadline),
                }),
              config.timeoutMs,
              deadline,
            );
            break;
          case "check":
            await runPlaywrightOperation(
              () =>
                page.locator(step.selector).check({
                  timeout: operationTimeout(config.timeoutMs, deadline),
                }),
              config.timeoutMs,
              deadline,
            );
            break;
          case "uncheck":
            await runPlaywrightOperation(
              () =>
                page.locator(step.selector).uncheck({
                  timeout: operationTimeout(config.timeoutMs, deadline),
                }),
              config.timeoutMs,
              deadline,
            );
            break;
          case "click":
            await runPlaywrightOperation(
              () =>
                page.locator(step.selector).click({
                  timeout: operationTimeout(config.timeoutMs, deadline),
                }),
              config.timeoutMs,
              deadline,
            );
            break;
          case "assertVisibleText":
            await runPlaywrightOperation(
              () =>
                page
                  .getByText(step.text, {
                    exact: true,
                  })
                  .filter({
                    visible: true,
                  })
                  .first()
                  .waitFor({
                    state: "visible",
                    timeout: operationTimeout(config.timeoutMs, deadline),
                  }),
              config.timeoutMs,
              deadline,
            );
            break;
          case "assertUrl":
            if (page.url() !== new URL(step.path, config.baseUrl).href) {
              throw new Error("URL assertion failed.");
            }
            break;
        }
      } catch (error: unknown) {
        if (error instanceof BudgetExceededError) {
          throw error;
        }

        return complete({
          flowName: flow.name,
          state: "failed",
          stepIndex: index + 1,
          stepType: step.type,
        });
      }
    }

    if (new URL(page.url()).origin !== new URL(config.baseUrl).origin) {
      return complete({
        flowName: flow.name,
        state: "failed",
        stepIndex: flow.steps.length,
        stepType: "final-url",
      });
    }

    return complete({
      flowName: flow.name,
      state: "passed",
    });
  } finally {
    const pageClosed = await closePlaywrightResource(
      () => page.close(),
      createCleanupDeadline(config.timeoutMs, sessionDeadline),
    );
    if (!pageClosed && execution !== undefined) {
      execution.internalFailure = true;
    }
  }
}

interface AxeRuleResult {
  readonly id: string;
  readonly impact?: string | null;
  readonly nodes: readonly unknown[];
}

export function normalizeAxeAccessibilityResults(results: {
  readonly violations: readonly AxeRuleResult[];
  readonly incomplete: readonly AxeRuleResult[];
}): AccessibilityAnalysisObservation {
  return {
    violations: results.violations.map((violation) => ({
      id: violation.id,
      impact:
        violation.impact === "critical" ||
        violation.impact === "serious" ||
        violation.impact === "moderate" ||
        violation.impact === "minor"
          ? violation.impact
          : "unknown",
      nodeCount: violation.nodes.length,
    })),
    incomplete: results.incomplete.map((incomplete) => ({
      id: incomplete.id,
      nodeCount: incomplete.nodes.length,
    })),
  };
}

async function defaultAccessibilityAnalysis(
  page: Page,
): Promise<AccessibilityAnalysisObservation> {
  return normalizeAxeAccessibilityResults(
    await new AxeBuilder({ page }).withTags([...ACCESSIBILITY_TAGS]).analyze(),
  );
}

export function createPlaywrightSessionRunner(
  dependencies: SessionDependencies = {
    launchBrowser: (timeoutMs) =>
      chromium.launch({
        headless: true,
        timeout: timeoutMs,
      }),
    analyzeAccessibility: defaultAccessibilityAnalysis,
  },
): UiSessionRunner {
  return async ({
    config,
    resolveEnvironmentReference,
    signal,
  }): Promise<UiSessionOutcome> => {
    const deadline = performance.now() + INTERNAL_BUDGET_MS;
    const sessionDeadline = deadline + CLEANUP_BUDGET_MS;
    let browser: Browser;

    try {
      browser = await runPlaywrightOperation(
        () =>
          dependencies.launchBrowser(
            operationTimeout(config.timeoutMs, deadline),
          ),
        config.timeoutMs,
        deadline,
        (browser) =>
          closePlaywrightResource(
            () => browser.close(),
            createCleanupDeadline(config.timeoutMs, sessionDeadline),
          ),
      );
    } catch (error: unknown) {
      if (error instanceof BudgetExceededError) {
        return {
          state: "completed",
          pageObservations: [],
          formObservations: [],
          authenticatedTargetsUnavailable: false,
          budgetExceeded: true,
          internalObservationFailure: false,
        };
      }

      return {
        state: "browser-unavailable",
      };
    }

    const contexts: BrowserContext[] = [];
    let publicContext: BrowserContext | undefined;
    let authenticatedContext: BrowserContext | undefined;
    let authenticatedTargetsUnavailable = false;
    let contextInitializationFailure = false;
    let completedOutcome: MutableCompletedUiSessionOutcome | undefined;
    const complete = (
      input: Omit<MutableCompletedUiSessionOutcome, "state">,
    ): MutableCompletedUiSessionOutcome => {
      completedOutcome = {
        state: "completed",
        ...input,
      };
      return completedOutcome;
    };
    const needsPublicContext =
      config.pages.some((page) => !page.useAuthentication) ||
      (config.formFlows ?? []).some((flow) => !flow.useAuthentication);
    const needsAuthenticatedContext =
      config.pages.some((page) => page.useAuthentication) ||
      (config.formFlows ?? []).some((flow) => flow.useAuthentication);
    const abortHandler = (): void => {
      void closePlaywrightResource(
        () => browser.close(),
        createCleanupDeadline(config.timeoutMs, sessionDeadline),
      );
    };
    signal.addEventListener("abort", abortHandler, {
      once: true,
    });

    try {
      if (needsPublicContext) {
        try {
          publicContext = await runPlaywrightOperation(
            () => browser.newContext({} satisfies BrowserContextOptions),
            config.timeoutMs,
            deadline,
            (context) =>
              closePlaywrightResource(
                () => context.close(),
                createCleanupDeadline(config.timeoutMs, sessionDeadline),
              ),
          );
          contexts.push(publicContext);
        } catch (error: unknown) {
          if (error instanceof BudgetExceededError) {
            return complete({
              pageObservations: [],
              formObservations: [],
              authenticatedTargetsUnavailable: false,
              budgetExceeded: true,
              internalObservationFailure: false,
            });
          }

          return {
            state: "session-unavailable",
          };
        }
      }

      if (needsAuthenticatedContext) {
        try {
          authenticatedContext = await createAuthenticatedContext(
            browser,
            config,
            resolveEnvironmentReference,
            deadline,
            sessionDeadline,
          );
        } catch (error: unknown) {
          if (error instanceof BudgetExceededError) {
            return complete({
              pageObservations: [],
              formObservations: [],
              authenticatedTargetsUnavailable: false,
              budgetExceeded: true,
              internalObservationFailure: false,
            });
          }

          if (error instanceof OperationTimeoutError) {
            contextInitializationFailure = true;
          }
          authenticatedContext = undefined;
        }
        if (authenticatedContext === undefined) {
          authenticatedTargetsUnavailable = true;
        } else {
          contexts.push(authenticatedContext);
        }
      }

      const pageObservations: PageViewportObservation[] = [];
      const formObservations: FormFlowObservation[] = [];
      let budgetExceeded = false;
      let internalObservationFailure = contextInitializationFailure;

      pageLoop: for (const pageConfig of config.pages) {
        const context = pageConfig.useAuthentication
          ? authenticatedContext
          : publicContext;
        if (context === undefined) {
          continue;
        }

        for (const viewport of config.viewports) {
          try {
            const observation = await observePageAtViewport(
              context,
              config,
              pageConfig,
              viewport,
              deadline,
              sessionDeadline,
              dependencies.analyzeAccessibility,
            );
            pageObservations.push(observation.observation);
            internalObservationFailure ||= observation.internalFailure;
          } catch (error: unknown) {
            if (error instanceof BudgetExceededError) {
              budgetExceeded = true;
              break pageLoop;
            }

            internalObservationFailure = true;
          }
        }
      }

      if (!budgetExceeded) {
        for (const flow of config.formFlows ?? []) {
          const context = flow.useAuthentication
            ? authenticatedContext
            : publicContext;
          if (context === undefined) {
            continue;
          }

          try {
            const formExecution = await executeFormFlow(
              context,
              config,
              flow,
              resolveEnvironmentReference,
              deadline,
              sessionDeadline,
            );
            formObservations.push(formExecution.observation);
            internalObservationFailure ||= formExecution.internalFailure;
          } catch (error: unknown) {
            if (error instanceof BudgetExceededError) {
              budgetExceeded = true;
              break;
            }

            internalObservationFailure = true;
          }
        }
      }

      return complete({
        pageObservations,
        formObservations,
        authenticatedTargetsUnavailable,
        budgetExceeded,
        internalObservationFailure,
      });
    } finally {
      signal.removeEventListener("abort", abortHandler);
      const finalCleanupDeadline = createCleanupDeadline(
        config.timeoutMs,
        sessionDeadline,
      );
      const contextCleanupResults = await Promise.all(
        contexts.map((context) =>
          closePlaywrightResource(() => context.close(), finalCleanupDeadline),
        ),
      );
      const browserClosed = await closePlaywrightResource(
        () => browser.close(),
        finalCleanupDeadline,
      );
      if (
        completedOutcome !== undefined &&
        (!browserClosed ||
          contextCleanupResults.some((contextClosed) => !contextClosed))
      ) {
        completedOutcome.internalObservationFailure = true;
      }
    }
  };
}

export const runPlaywrightSession = createPlaywrightSessionRunner();
