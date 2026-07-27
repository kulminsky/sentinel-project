import assert from "node:assert/strict";

import { test, vi } from "vitest";

import { disabledAiSetup } from "../src/ai/config.js";
import { createUiBrowserCheck } from "../src/checks/ui/check.js";
import {
  createPlaywrightSessionRunner,
  normalizeAxeAccessibilityResults,
  type AccessibilityAnalysisObservation,
  type PageViewportObservation,
  type UiSessionOutcome,
  type UiSessionRunner,
} from "../src/checks/ui/session.js";
import { createSentinelConfigSchema } from "../src/config/schema.js";
import type { ScanContext, ServiceReachability } from "../src/core/check.js";

function uiConfiguration(options?: {
  authenticated?: boolean;
  formFlows?: unknown[];
  timeoutMs?: number;
}) {
  return {
    baseUrl: "http://127.0.0.1:4310",
    timeoutMs: options?.timeoutMs ?? 1_000,
    pages: [
      {
        name: "home",
        path: "/",
        useAuthentication: options?.authenticated ?? false,
      },
    ],
    viewports: [
      {
        name: "mobile",
        width: 390,
        height: 844,
      },
      {
        name: "desktop",
        width: 1_440,
        height: 900,
      },
    ],
    ...(options?.authenticated
      ? {
          authentication: {
            kind: "headers",
            headers: {
              Authorization: {
                env: "TARGET_UI_AUTH",
              },
            },
          },
        }
      : {}),
    ...(options?.formFlows === undefined
      ? {}
      : {
          formFlows: options.formFlows,
        }),
  };
}

function contextFor(options?: {
  ui?: ReturnType<typeof uiConfiguration>;
  reachability?: ServiceReachability;
  environment?: Record<string, string>;
}): ScanContext {
  const config = createSentinelConfigSchema(process.cwd()).parse({
    ...(options?.ui === undefined
      ? {}
      : {
          ui: options.ui,
        }),
  });
  const environment = options?.environment ?? {};

  return {
    config,
    repository: {
      root: process.cwd(),
      entries: [],
      complete: true,
      rootComplete: true,
      issues: [],
      nodeProject: false,
      typescriptProject: false,
      packageManifest: {
        state: "absent",
      },
    },
    ai: disabledAiSetup(),
    resolveEnvironmentReference: (name) => environment[name],
    fetch: () => Promise.reject(new Error("Unexpected fetch.")),
    reachability: {
      api: {
        state: "not-configured",
      },
      ui:
        options?.reachability ??
        (options?.ui === undefined
          ? {
              state: "not-configured",
            }
          : {
              state: "reachable",
              statusCode: 200,
              durationMs: 1,
            }),
    },
  };
}

function observation(
  viewportName: string,
  overrides: Partial<PageViewportObservation> = {},
): PageViewportObservation {
  return {
    pageName: "home",
    viewportName,
    navigation: {
      state: "passed",
      statusCode: 200,
    },
    consoleErrorCount: 0,
    pageErrorCount: 0,
    brokenImages: {
      state: "available",
      value: {
        totalCount: 0,
        resourceIds: [],
        evidencePaths: [],
      },
    },
    accessibility: {
      state: "available",
      value: accessibilityAnalysis(),
    },
    horizontalOverflow: {
      state: "available",
      value: false,
    },
    ...overrides,
  };
}

function accessibilityAnalysis(
  violations: AccessibilityAnalysisObservation["violations"] = [],
  incomplete: AccessibilityAnalysisObservation["incomplete"] = [],
): AccessibilityAnalysisObservation {
  return {
    violations,
    incomplete,
  };
}

function completedOutcome(
  overrides: Partial<Extract<UiSessionOutcome, { state: "completed" }>> = {},
): UiSessionOutcome {
  return {
    state: "completed",
    pageObservations: [observation("mobile"), observation("desktop")],
    formObservations: [],
    authenticatedTargetsUnavailable: false,
    budgetExceeded: false,
    internalObservationFailure: false,
    ...overrides,
  };
}

test("missing and unreachable UI targets do not start Playwright", async () => {
  const runSession = vi.fn<UiSessionRunner>();
  const check = createUiBrowserCheck(runSession);

  const missing = await check.run(contextFor(), new AbortController().signal);
  const unreachable = await check.run(
    contextFor({
      ui: uiConfiguration(),
      reachability: {
        state: "unreachable",
        reason: "network-error",
        durationMs: 2,
      },
    }),
    new AbortController().signal,
  );

  assert.equal(runSession.mock.calls.length, 0);
  assert.equal(missing.results[0]?.diagnosticCode, "UI_NOT_CONFIGURED");
  assert.equal(
    unreachable.results[0]?.diagnosticCode,
    "UI_RUNTIME_UNAVAILABLE",
  );
  assert.equal(missing.incomplete, false);
  assert.equal(unreachable.incomplete, false);
});

test("browser launch failure becomes exactly one redacted skipped result", async () => {
  const check = createUiBrowserCheck(() =>
    Promise.resolve({
      state: "browser-unavailable",
    }),
  );

  const execution = await check.run(
    contextFor({
      ui: uiConfiguration(),
    }),
    new AbortController().signal,
  );

  assert.equal(execution.results.length, 1);
  assert.equal(execution.results[0]?.status, "Skipped");
  assert.equal(execution.results[0]?.severity, "Info");
  assert.equal(
    execution.results[0]?.diagnosticCode,
    "PLAYWRIGHT_BROWSER_UNAVAILABLE",
  );
  assert.match(
    execution.results[0]?.recommendation ?? "",
    /npx playwright install chromium/,
  );
  assert.equal(execution.incomplete, true);
});

test("shared page observations render every required UI category honestly", async () => {
  const canary = "TARGET_CONSOLE_SECRET_CANARY";
  const check = createUiBrowserCheck(() =>
    Promise.resolve(
      completedOutcome({
        pageObservations: [
          observation("mobile", {
            consoleErrorCount: 1,
            brokenImages: {
              state: "available",
              value: {
                totalCount: 1,
                resourceIds: ["missing-product"],
                evidencePaths: ["/assets/missing-product.png"],
              },
            },
            accessibility: {
              state: "available",
              value: accessibilityAnalysis([
                {
                  id: "label",
                  impact: "critical",
                  nodeCount: 1,
                },
              ]),
            },
          }),
          observation("desktop", {
            consoleErrorCount: 1,
            brokenImages: {
              state: "available",
              value: {
                totalCount: 1,
                resourceIds: ["missing-product"],
                evidencePaths: ["/assets/missing-product.png"],
              },
            },
            accessibility: {
              state: "available",
              value: accessibilityAnalysis([
                {
                  id: "label",
                  impact: "critical",
                  nodeCount: 1,
                },
              ]),
            },
          }),
        ],
        formObservations: [
          {
            flowName: "subscription",
            state: "passed",
          },
        ],
      }),
    ),
  );

  const execution = await check.run(
    contextFor({
      ui: uiConfiguration({
        formFlows: [
          {
            name: "subscription",
            startPath: "/",
            useAuthentication: false,
            steps: [
              {
                type: "click",
                selector: `#${canary}`,
              },
            ],
          },
        ],
      }),
    }),
    new AbortController().signal,
  );

  assert.deepEqual(
    execution.results.map((result) => [
      result.subject,
      result.status,
      result.severity,
    ]),
    [
      ["Page load: home", "Pass", "Info"],
      ["Console: home", "Warn", "Medium"],
      ["Images: home", "Fail", "Medium"],
      ["Accessibility: home", "Fail", "High"],
      ["Responsive layout: home", "Pass", "Info"],
      ["Form flow: subscription", "Pass", "Info"],
    ],
  );
  assert.equal(execution.incomplete, false);
  assert.equal(JSON.stringify(execution.results).includes(canary), false);
});

test("broken-image findings retain the full count while capping evidence", async () => {
  const resourceIds = Array.from(
    {
      length: 15,
    },
    (_value, index) => `resource-${index}`,
  );
  const evidencePaths = resourceIds
    .slice(0, 10)
    .map((_resourceId, index) => `/assets/missing-${index}.png`);
  const check = createUiBrowserCheck(() =>
    Promise.resolve(
      completedOutcome({
        pageObservations: [
          observation("mobile", {
            brokenImages: {
              state: "available",
              value: {
                totalCount: resourceIds.length,
                resourceIds,
                evidencePaths,
              },
            },
          }),
          observation("desktop", {
            brokenImages: {
              state: "available",
              value: {
                totalCount: resourceIds.length,
                resourceIds,
                evidencePaths,
              },
            },
          }),
        ],
      }),
    ),
  );

  const execution = await check.run(
    contextFor({
      ui: uiConfiguration(),
    }),
    new AbortController().signal,
  );
  const imageResult = execution.results.find(
    (candidate) => candidate.subject === "Images: home",
  );

  assert.match(imageResult?.finding ?? "", /15 broken image resource/);
  assert.equal(imageResult?.evidence?.length, 10);
});

test("partial observations never produce unearned passes", async () => {
  const check = createUiBrowserCheck(() =>
    Promise.resolve(
      completedOutcome({
        pageObservations: [
          observation("mobile", {
            accessibility: {
              state: "unavailable",
            },
            horizontalOverflow: {
              state: "unavailable",
            },
          }),
        ],
        internalObservationFailure: true,
      }),
    ),
  );

  const execution = await check.run(
    contextFor({
      ui: uiConfiguration(),
    }),
    new AbortController().signal,
  );

  assert.deepEqual(
    execution.results.slice(0, 5).map((result) => result.status),
    ["Skipped", "Skipped", "Skipped", "Skipped", "Skipped"],
  );
  assert.equal(execution.incomplete, true);
});

test("indeterminate axe results are preserved and never earn an accessibility pass", async () => {
  const accessibility = normalizeAxeAccessibilityResults({
    violations: [],
    incomplete: [
      {
        id: "color-contrast",
        impact: null,
        nodes: [{}, {}],
      },
    ],
  });
  const check = createUiBrowserCheck(() =>
    Promise.resolve(
      completedOutcome({
        pageObservations: [
          observation("mobile", {
            accessibility: {
              state: "available",
              value: accessibility,
            },
          }),
          observation("desktop", {
            accessibility: {
              state: "available",
              value: accessibility,
            },
          }),
        ],
      }),
    ),
  );

  const execution = await check.run(
    contextFor({
      ui: uiConfiguration(),
    }),
    new AbortController().signal,
  );
  const accessibilityResult = execution.results.find(
    (candidate) => candidate.subject === "Accessibility: home",
  );

  assert.deepEqual(accessibility.incomplete, [
    {
      id: "color-contrast",
      nodeCount: 2,
    },
  ]);
  assert.equal(accessibilityResult?.status, "Skipped");
  assert.equal(accessibilityResult?.severity, "Info");
  assert.equal(
    accessibilityResult?.diagnosticCode,
    "UI_ACCESSIBILITY_INDETERMINATE",
  );
  assert.match(accessibilityResult?.finding ?? "", /cannot claim a pass/);
  assert.deepEqual(accessibilityResult?.evidence, [
    "Indeterminate rule: color-contrast; affected nodes: 2",
  ]);
  assert.equal(execution.incomplete, true);
});

test("navigation, page errors, accessibility impact, and overflow map to bounded findings", async () => {
  const check = createUiBrowserCheck(() =>
    Promise.resolve(
      completedOutcome({
        pageObservations: [
          observation("mobile", {
            navigation: {
              state: "failed",
              reason: "external-redirect",
              statusCode: 302,
            },
            pageErrorCount: 1,
          }),
          observation("desktop", {
            accessibility: {
              state: "available",
              value: accessibilityAnalysis([
                {
                  id: "color-contrast",
                  impact: "moderate",
                  nodeCount: 2,
                },
              ]),
            },
            horizontalOverflow: {
              state: "available",
              value: true,
            },
          }),
        ],
      }),
    ),
  );

  const execution = await check.run(
    contextFor({
      ui: uiConfiguration(),
    }),
    new AbortController().signal,
  );

  assert.deepEqual(
    execution.results
      .slice(0, 5)
      .map((candidate) => [candidate.status, candidate.severity]),
    [
      ["Fail", "High"],
      ["Fail", "High"],
      ["Skipped", "Info"],
      ["Warn", "Medium"],
      ["Warn", "Medium"],
    ],
  );
  assert.equal(JSON.stringify(execution.results).includes("https://"), false);
});

test("authentication and form prerequisites skip only affected targets", async () => {
  const check = createUiBrowserCheck(() =>
    Promise.resolve(
      completedOutcome({
        pageObservations: [],
        formObservations: [],
        authenticatedTargetsUnavailable: true,
      }),
    ),
  );

  const execution = await check.run(
    contextFor({
      ui: uiConfiguration({
        authenticated: true,
        formFlows: [
          {
            name: "protected",
            startPath: "/account",
            useAuthentication: true,
            steps: [
              {
                type: "click",
                selector: "#submit",
              },
            ],
          },
        ],
      }),
    }),
    new AbortController().signal,
  );

  assert.equal(execution.results.length, 1);
  assert.equal(
    execution.results[0]?.diagnosticCode,
    "UI_AUTHENTICATION_UNAVAILABLE",
  );
  assert.equal(execution.incomplete, false);
});

test("missing environment-backed form values produce an ordinary form skip", async () => {
  const check = createUiBrowserCheck(() =>
    Promise.resolve(
      completedOutcome({
        formObservations: [
          {
            flowName: "subscription",
            state: "prerequisite-missing",
          },
        ],
      }),
    ),
  );

  const execution = await check.run(
    contextFor({
      ui: uiConfiguration({
        formFlows: [
          {
            name: "subscription",
            startPath: "/",
            useAuthentication: false,
            steps: [
              {
                type: "fill",
                selector: "#email",
                value: {
                  source: "environment",
                  env: "TARGET_FORM_VALUE",
                },
              },
            ],
          },
        ],
      }),
    }),
    new AbortController().signal,
  );

  assert.equal(
    execution.results.at(-1)?.diagnosticCode,
    "UI_FORM_PREREQUISITE_MISSING",
  );
  assert.equal(execution.incomplete, false);
});

test("the internal budget preserves results and marks coverage incomplete", async () => {
  const check = createUiBrowserCheck(() =>
    Promise.resolve(
      completedOutcome({
        budgetExceeded: true,
      }),
    ),
  );

  const execution = await check.run(
    contextFor({
      ui: uiConfiguration(),
    }),
    new AbortController().signal,
  );

  assert.equal(
    execution.results.at(-1)?.diagnosticCode,
    "UI_BROWSER_BUDGET_EXCEEDED",
  );
  assert.equal(execution.incomplete, true);
});

test("the production session shares resources and deduplicates image URL fragments", async () => {
  const launchBrowser = vi.fn();
  const newContext = vi.fn();
  const closeBrowser = vi.fn(() => Promise.resolve());
  const closeContext = vi.fn(() => Promise.resolve());
  const pages: Array<Record<string, unknown>> = [];

  function fakePage(): Record<string, unknown> {
    const listeners = new Map<string, Array<(value: unknown) => void>>();
    const page = {
      on: vi.fn((event: string, listener: (value: unknown) => void) => {
        const registered = listeners.get(event) ?? [];
        registered.push(listener);
        listeners.set(event, registered);
      }),
      setViewportSize: vi.fn(() => Promise.resolve()),
      setDefaultTimeout: vi.fn(),
      setDefaultNavigationTimeout: vi.fn(),
      goto: vi.fn(() => {
        const consoleMessage = {
          type: () => "error",
        };
        for (const listener of listeners.get("console") ?? []) {
          listener(consoleMessage);
        }
        const imageResponse = {
          request: () => ({
            resourceType: () => "image",
          }),
          status: () => 404,
          url: () => "http://127.0.0.1:4310/assets/missing.png?token=canary",
        };
        for (const listener of listeners.get("response") ?? []) {
          listener(imageResponse);
        }

        return Promise.resolve({
          url: () => "http://127.0.0.1:4310/",
          status: () => 200,
        });
      }),
      locator: vi.fn(() => ({
        evaluateAll: () =>
          Promise.resolve([
            "http://127.0.0.1:4310/assets/missing.png?token=canary#asset",
          ]),
      })),
      evaluate: vi.fn(() => Promise.resolve(false)),
      close: vi.fn(() => Promise.resolve()),
    };
    pages.push(page);
    return page;
  }

  const context = {
    newPage: vi.fn(() => Promise.resolve(fakePage())),
    route: vi.fn(() => Promise.resolve()),
    close: closeContext,
  };
  newContext.mockResolvedValue(context);
  launchBrowser.mockResolvedValue({
    newContext,
    close: closeBrowser,
  });
  const analyzeAccessibility = vi.fn(() =>
    Promise.resolve(
      accessibilityAnalysis([
        {
          id: "label",
          impact: "critical" as const,
          nodeCount: 1,
        },
      ]),
    ),
  );
  const runSession = createPlaywrightSessionRunner({
    launchBrowser,
    analyzeAccessibility,
  });
  const config = contextFor({
    ui: uiConfiguration(),
  }).config.ui;
  assert.ok(config !== undefined);

  const outcome = await runSession({
    config,
    resolveEnvironmentReference: () => undefined,
    signal: new AbortController().signal,
  });

  assert.equal(outcome.state, "completed");
  assert.equal(launchBrowser.mock.calls.length, 1);
  assert.equal(newContext.mock.calls.length, 1);
  assert.equal(context.newPage.mock.calls.length, 2);
  assert.equal(analyzeAccessibility.mock.calls.length, 2);
  assert.equal(closeContext.mock.calls.length, 1);
  assert.equal(closeBrowser.mock.calls.length, 1);
  assert.equal(pages.length, 2);
  if (outcome.state === "completed") {
    const brokenImages = outcome.pageObservations[0]?.brokenImages;
    assert.equal(brokenImages?.state, "available");
    if (brokenImages?.state === "available") {
      assert.equal(brokenImages.value.totalCount, 1);
      assert.equal(brokenImages.value.resourceIds.length, 1);
      assert.deepEqual(brokenImages.value.evidencePaths, [
        "/assets/missing.png",
      ]);
    }
    assert.equal(outcome.pageObservations[0]?.consoleErrorCount, 1);
    assert.equal(JSON.stringify(outcome).includes("token=canary"), false);
  }
});

test("configured UI timeouts close the affected page before continuing", async () => {
  const events: string[] = [];
  let pageNumber = 0;
  function fakePage(number: number) {
    return {
      on: vi.fn(),
      setViewportSize: vi.fn(() => Promise.resolve()),
      setDefaultTimeout: vi.fn(),
      setDefaultNavigationTimeout: vi.fn(),
      goto: vi.fn(() =>
        Promise.resolve({
          url: () => "http://127.0.0.1:4310/",
          status: () => 200,
        }),
      ),
      locator: vi.fn(() => ({
        evaluateAll: () => Promise.resolve([]),
      })),
      evaluate: vi.fn(() => Promise.resolve(false)),
      close: vi.fn(() => {
        events.push(`close-page-${number}`);
        return Promise.resolve();
      }),
    };
  }
  const context = {
    newPage: vi.fn(() => {
      pageNumber += 1;
      events.push(`new-page-${pageNumber}`);
      return Promise.resolve(fakePage(pageNumber));
    }),
    close: vi.fn(() => Promise.resolve()),
  };
  const browser = {
    newContext: vi.fn(() => Promise.resolve(context)),
    close: vi.fn(() => Promise.resolve()),
  };
  const analyzeAccessibility = vi.fn(() => new Promise<never>(() => undefined));
  const runSession = createPlaywrightSessionRunner({
    launchBrowser: () => Promise.resolve(browser as never),
    analyzeAccessibility,
  });
  const config = contextFor({
    ui: uiConfiguration({
      timeoutMs: 10,
    }),
  }).config.ui;
  assert.ok(config !== undefined);

  const outcome = await runSession({
    config,
    resolveEnvironmentReference: () => undefined,
    signal: new AbortController().signal,
  });

  assert.equal(outcome.state, "completed");
  if (outcome.state === "completed") {
    assert.equal(outcome.pageObservations.length, 2);
    assert.equal(outcome.internalObservationFailure, true);
    assert.equal(outcome.budgetExceeded, false);
    assert.deepEqual(
      outcome.pageObservations.map((candidate) => [
        candidate.accessibility.state,
        candidate.horizontalOverflow.state,
      ]),
      [
        ["unavailable", "available"],
        ["unavailable", "available"],
      ],
    );
  }
  assert.equal(analyzeAccessibility.mock.calls.length, 2);
  assert.deepEqual(events, [
    "new-page-1",
    "close-page-1",
    "new-page-2",
    "close-page-2",
  ]);
});

test("browser cleanup shares one deadline and marks the outcome incomplete", async () => {
  vi.useFakeTimers();
  const never = () => new Promise<never>(() => undefined);
  const page = {
    on: vi.fn(),
    setViewportSize: vi.fn(() => Promise.resolve()),
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    goto: vi.fn(() =>
      Promise.resolve({
        url: () => "http://127.0.0.1:4310/",
        status: () => 200,
      }),
    ),
    locator: vi.fn(() => ({
      evaluateAll: () => Promise.resolve([]),
    })),
    evaluate: vi.fn(() => Promise.resolve(false)),
    close: vi.fn(() => Promise.resolve()),
  };
  const closeContext = vi.fn(never);
  const closeBrowser = vi.fn(never);
  const context = {
    newPage: vi.fn(() => Promise.resolve(page)),
    close: closeContext,
  };
  const browser = {
    newContext: vi.fn(() => Promise.resolve(context)),
    close: closeBrowser,
  };
  const runSession = createPlaywrightSessionRunner({
    launchBrowser: () => Promise.resolve(browser as never),
    analyzeAccessibility: () => Promise.resolve(accessibilityAnalysis()),
  });
  const config = contextFor({
    ui: uiConfiguration({
      timeoutMs: 15,
    }),
  }).config.ui;
  assert.ok(config !== undefined);

  try {
    const outcomePromise = runSession({
      config,
      resolveEnvironmentReference: () => undefined,
      signal: new AbortController().signal,
    });
    await vi.advanceTimersByTimeAsync(15);
    const outcome = await outcomePromise;

    assert.equal(outcome.state, "completed");
    if (outcome.state === "completed") {
      assert.equal(outcome.internalObservationFailure, true);
      assert.equal(outcome.budgetExceeded, false);
      assert.equal(outcome.pageObservations.length, 2);
    }
    assert.equal(closeContext.mock.calls.length, 1);
    assert.equal(closeBrowser.mock.calls.length, 1);
  } finally {
    vi.useRealTimers();
  }
});

test("header authentication is added only to same-origin browser requests", async () => {
  const continuations: Array<Record<string, string> | undefined> = [];
  const page = {
    on: vi.fn(),
    setViewportSize: vi.fn(() => Promise.resolve()),
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    goto: vi.fn(() =>
      Promise.resolve({
        url: () => "http://127.0.0.1:4310/",
        status: () => 200,
      }),
    ),
    locator: vi.fn(() => ({
      evaluateAll: () => Promise.resolve([]),
    })),
    evaluate: vi.fn(() => Promise.resolve(false)),
    close: vi.fn(() => Promise.resolve()),
  };
  const context = {
    newPage: vi.fn(() => Promise.resolve(page)),
    route: vi.fn(
      async (
        _pattern: string,
        handler: (route: {
          request(): {
            url(): string;
            headers(): Record<string, string>;
          };
          continue(options?: {
            headers?: Record<string, string>;
          }): Promise<void>;
        }) => Promise<void>,
      ) => {
        for (const url of [
          "http://127.0.0.1:4310/account",
          "https://external.example.test/image.png",
        ]) {
          await handler({
            request: () => ({
              url: () => url,
              headers: () => ({
                accept: "*/*",
              }),
            }),
            continue: (options) => {
              continuations.push(options?.headers);
              return Promise.resolve();
            },
          });
        }
      },
    ),
    close: vi.fn(() => Promise.resolve()),
  };
  const browser = {
    newContext: vi.fn(() => Promise.resolve(context)),
    close: vi.fn(() => Promise.resolve()),
  };
  const runSession = createPlaywrightSessionRunner({
    launchBrowser: () => Promise.resolve(browser as never),
    analyzeAccessibility: () => Promise.resolve(accessibilityAnalysis()),
  });
  const config = contextFor({
    ui: uiConfiguration({
      authenticated: true,
    }),
    environment: {
      TARGET_UI_AUTH: "Bearer SECRET_CANARY",
    },
  }).config.ui;
  assert.ok(config !== undefined);

  await runSession({
    config,
    resolveEnvironmentReference: (name) =>
      name === "TARGET_UI_AUTH" ? "Bearer SECRET_CANARY" : undefined,
    signal: new AbortController().signal,
  });

  assert.equal(continuations.length, 2);
  assert.equal(continuations[0]?.["Authorization"], "Bearer SECRET_CANARY");
  assert.equal(continuations[1], undefined);
});

test("configured form steps select a visible exact-text match and execute in order without exposing values", async () => {
  const calls: string[] = [];
  let currentUrl = "about:blank";
  const locator = {
    evaluateAll: () => Promise.resolve([]),
    fill: (value: string) => {
      calls.push(`fill:${value}`);
      return Promise.resolve();
    },
    check: () => {
      calls.push("check");
      return Promise.resolve();
    },
    uncheck: () => {
      calls.push("uncheck");
      return Promise.resolve();
    },
    click: () => {
      calls.push("click");
      return Promise.resolve();
    },
  };
  const page = {
    on: vi.fn(),
    setViewportSize: vi.fn(() => Promise.resolve()),
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    goto: (url: string) => {
      currentUrl = url;
      calls.push("goto");
      return Promise.resolve({
        url: () => url,
        status: () => 200,
      });
    },
    locator: vi.fn(() => locator),
    getByText: vi.fn(() => ({
      first: () => {
        throw new Error("The first exact match is hidden.");
      },
      filter: (options: { visible?: boolean }) => {
        assert.deepEqual(options, {
          visible: true,
        });
        return {
          first: () => ({
            waitFor: () => {
              calls.push("assertVisibleText");
              return Promise.resolve();
            },
          }),
        };
      },
    })),
    evaluate: vi.fn(() => Promise.resolve(false)),
    url: () => currentUrl,
    close: vi.fn(() => Promise.resolve()),
  };
  const context = {
    newPage: vi.fn(() => Promise.resolve(page)),
    close: vi.fn(() => Promise.resolve()),
  };
  const browser = {
    newContext: vi.fn(() => Promise.resolve(context)),
    close: vi.fn(() => Promise.resolve()),
  };
  const runSession = createPlaywrightSessionRunner({
    launchBrowser: () => Promise.resolve(browser as never),
    analyzeAccessibility: () => Promise.resolve(accessibilityAnalysis()),
  });
  const config = contextFor({
    ui: uiConfiguration({
      formFlows: [
        {
          name: "all-steps",
          startPath: "/",
          useAuthentication: false,
          steps: [
            {
              type: "goto",
              path: "/form",
            },
            {
              type: "fill",
              selector: "#email",
              value: {
                source: "environment",
                env: "TARGET_FORM_VALUE",
              },
            },
            {
              type: "check",
              selector: "#terms",
            },
            {
              type: "uncheck",
              selector: "#terms",
            },
            {
              type: "click",
              selector: "#submit",
            },
            {
              type: "assertVisibleText",
              text: "Saved",
            },
            {
              type: "assertUrl",
              path: "/form",
            },
          ],
        },
      ],
    }),
  }).config.ui;
  assert.ok(config !== undefined);

  const outcome = await runSession({
    config,
    resolveEnvironmentReference: (name) =>
      name === "TARGET_FORM_VALUE" ? "FORM_SECRET_CANARY" : undefined,
    signal: new AbortController().signal,
  });

  assert.equal(outcome.state, "completed");
  if (outcome.state === "completed") {
    assert.equal(outcome.formObservations[0]?.state, "passed");
  }
  assert.deepEqual(calls, [
    "goto",
    "goto",
    "goto",
    "goto",
    "fill:FORM_SECRET_CANARY",
    "check",
    "uncheck",
    "click",
    "assertVisibleText",
  ]);
  assert.equal(JSON.stringify(outcome).includes("FORM_SECRET_CANARY"), false);
});

test("rejected form-page cleanup marks an otherwise successful session incomplete", async () => {
  let currentUrl = "about:blank";
  const page = {
    setViewportSize: vi.fn(() => Promise.resolve()),
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    goto: vi.fn((url: string) => {
      currentUrl = url;
      return Promise.resolve({
        url: () => url,
        status: () => 200,
      });
    }),
    url: () => currentUrl,
    close: vi.fn(() =>
      Promise.reject(new Error("FORM_PAGE_CLOSE_SECRET_CANARY")),
    ),
  };
  const context = {
    newPage: vi.fn(() => Promise.resolve(page)),
    close: vi.fn(() => Promise.resolve()),
  };
  const browser = {
    newContext: vi.fn(() => Promise.resolve(context)),
    close: vi.fn(() => Promise.resolve()),
  };
  const runSession = createPlaywrightSessionRunner({
    launchBrowser: () => Promise.resolve(browser as never),
    analyzeAccessibility: () => Promise.resolve(accessibilityAnalysis()),
  });
  const config = contextFor({
    ui: {
      ...uiConfiguration({
        formFlows: [
          {
            name: "cleanup",
            startPath: "/",
            useAuthentication: false,
            steps: [
              {
                type: "assertUrl",
                path: "/",
              },
            ],
          },
        ],
      }),
      pages: [],
    },
  }).config.ui;
  assert.ok(config !== undefined);

  const outcome = await runSession({
    config,
    resolveEnvironmentReference: () => undefined,
    signal: new AbortController().signal,
  });

  assert.equal(outcome.state, "completed");
  if (outcome.state === "completed") {
    assert.equal(outcome.formObservations[0]?.state, "passed");
    assert.equal(outcome.internalObservationFailure, true);
  }
  assert.equal(
    JSON.stringify(outcome).includes("FORM_PAGE_CLOSE_SECRET_CANARY"),
    false,
  );
});

test("timed-out form-page cleanup marks an otherwise successful session incomplete", async () => {
  vi.useFakeTimers();
  let currentUrl = "about:blank";
  const page = {
    setViewportSize: vi.fn(() => Promise.resolve()),
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    goto: vi.fn((url: string) => {
      currentUrl = url;
      return Promise.resolve({
        url: () => url,
        status: () => 200,
      });
    }),
    url: () => currentUrl,
    close: vi.fn(() => new Promise<never>(() => undefined)),
  };
  const context = {
    newPage: vi.fn(() => Promise.resolve(page)),
    close: vi.fn(() => Promise.resolve()),
  };
  const browser = {
    newContext: vi.fn(() => Promise.resolve(context)),
    close: vi.fn(() => Promise.resolve()),
  };
  const runSession = createPlaywrightSessionRunner({
    launchBrowser: () => Promise.resolve(browser as never),
    analyzeAccessibility: () => Promise.resolve(accessibilityAnalysis()),
  });
  const config = contextFor({
    ui: {
      ...uiConfiguration({
        formFlows: [
          {
            name: "cleanup-timeout",
            startPath: "/",
            useAuthentication: false,
            steps: [
              {
                type: "assertUrl",
                path: "/",
              },
            ],
          },
        ],
        timeoutMs: 10,
      }),
      pages: [],
    },
  }).config.ui;
  assert.ok(config !== undefined);

  try {
    const outcomePromise = runSession({
      config,
      resolveEnvironmentReference: () => undefined,
      signal: new AbortController().signal,
    });
    await vi.advanceTimersByTimeAsync(10);
    const outcome = await outcomePromise;

    assert.equal(outcome.state, "completed");
    if (outcome.state === "completed") {
      assert.equal(outcome.formObservations[0]?.state, "passed");
      assert.equal(outcome.internalObservationFailure, true);
    }
    assert.equal(page.close.mock.calls.length, 1);
  } finally {
    vi.useRealTimers();
  }
});
