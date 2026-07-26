import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "vitest";

import { createSentinelConfigSchema } from "../src/config/schema.js";

const BASE_DIRECTORY = "/tmp/sentinel-schema-base";

function validConfig(): Record<string, unknown> {
  return {
    target: {
      root: "./target",
    },
    report: {
      path: "./reports/result.md",
    },
    api: {
      baseUrl: "http://127.0.0.1:4321",
      healthPath: "/health",
      timeoutMs: 2_000,
      latencyThresholdMs: 500,
      authentication: {
        kind: "headers",
        headers: {
          Authorization: {
            env: "TARGET_API_TOKEN",
          },
        },
      },
      endpoints: [
        {
          name: "items",
          method: "GET",
          path: "/api/items?limit=1",
          expectedStatus: 200,
          expectedContentType: "application/json",
          requiredJsonFields: ["items"],
          useAuthentication: true,
        },
      ],
    },
    ui: {
      baseUrl: "https://ui.example.test:8443/app",
      timeoutMs: 3_000,
      pages: [
        {
          name: "home",
          path: "/",
          useAuthentication: false,
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
      authentication: {
        kind: "storageState",
        path: "./auth/state.json",
      },
      formFlows: [
        {
          name: "signup",
          startPath: "/signup",
          useAuthentication: false,
          steps: [
            {
              type: "fill",
              selector: "[name=email]",
              value: {
                source: "environment",
                env: "TARGET_TEST_EMAIL",
              },
            },
            {
              type: "click",
              selector: "button[type=submit]",
            },
            {
              type: "assertUrl",
              path: "/welcome",
            },
          ],
        },
      ],
    },
    ai: {
      enabled: true,
      provider: "openai",
    },
  };
}

function issuePaths(value: unknown): string[] {
  const result = createSentinelConfigSchema(BASE_DIRECTORY).safeParse(value);
  assert.equal(result.success, false);
  if (result.success) {
    return [];
  }

  return result.error.issues.map((issue) => issue.path.map(String).join("."));
}

test("full target configuration validates and normalizes filesystem paths", () => {
  const config =
    createSentinelConfigSchema(BASE_DIRECTORY).parse(validConfig());

  assert.equal(config.target.root, resolve(BASE_DIRECTORY, "target"));
  assert.equal(
    config.report.path,
    resolve(BASE_DIRECTORY, "reports/result.md"),
  );
  assert.equal(config.report.format, "markdown");
  assert.equal(config.api?.baseUrl, "http://127.0.0.1:4321");
  assert.equal(config.ui?.authentication?.kind, "storageState");
  if (config.ui?.authentication?.kind === "storageState") {
    assert.equal(
      config.ui.authentication.path,
      resolve(BASE_DIRECTORY, "auth/state.json"),
    );
  }
});

test("report formats enforce strict output path rules", () => {
  const schema = createSentinelConfigSchema(BASE_DIRECTORY);
  const markdown = schema.parse({
    report: {},
  });
  const json = schema.parse({
    report: {
      format: "json",
      path: "./reports/result.json",
    },
  });
  const terminal = schema.parse({
    report: {
      format: "terminal",
    },
  });

  assert.deepEqual(markdown.report, {
    format: "markdown",
    path: resolve(BASE_DIRECTORY, "sentinel-report.md"),
  });
  assert.deepEqual(json.report, {
    format: "json",
    path: resolve(BASE_DIRECTORY, "reports/result.json"),
  });
  assert.deepEqual(terminal.report, {
    format: "terminal",
  });
  assert.ok(
    issuePaths({
      report: {
        format: "json",
      },
    }).includes("report.path"),
  );
  assert.ok(
    issuePaths({
      report: {
        format: "terminal",
        path: "./unused.md",
      },
    }).includes("report.path"),
  );
  assert.ok(
    issuePaths({
      report: {
        format: "xml",
      },
    }).includes("report.format"),
  );
});

test("schema rejects unknown keys at every nesting level", () => {
  const topLevel = {
    ...validConfig(),
    unexpected: true,
  };
  const endpoint = structuredClone(validConfig());
  const endpointConfig = endpoint.api as {
    endpoints: Array<Record<string, unknown>>;
  };
  endpointConfig.endpoints[0] = {
    ...endpointConfig.endpoints[0],
    typo: true,
  };
  const formStep = structuredClone(validConfig());
  const uiConfig = formStep.ui as {
    formFlows: Array<{ steps: Array<Record<string, unknown>> }>;
  };
  uiConfig.formFlows[0]?.steps.push({
    type: "click",
    selector: "#submit",
    unsupported: true,
  });

  assert.ok(issuePaths(topLevel).includes(""));
  assert.ok(issuePaths(endpoint).includes("api.endpoints.0"));
  assert.ok(issuePaths(formStep).includes("ui.formFlows.0.steps.3"));
});

test("schema rejects invalid target URLs, paths, methods, and thresholds", () => {
  const invalidUrl = structuredClone(validConfig());
  (invalidUrl.api as Record<string, unknown>).baseUrl =
    "https://user:password@example.test";

  const invalidProtocol = structuredClone(validConfig());
  (invalidProtocol.api as Record<string, unknown>).baseUrl =
    "ftp://api.example.test";

  const invalidFragment = structuredClone(validConfig());
  (invalidFragment.api as Record<string, unknown>).baseUrl =
    "https://api.example.test/#fragment";

  const invalidPath = structuredClone(validConfig());
  const invalidPathUi = invalidPath.ui as {
    pages: Array<Record<string, unknown>>;
  };
  invalidPathUi.pages[0] = {
    ...invalidPathUi.pages[0],
    path: "https://other.example.test/",
  };

  const schemeRelativePath = structuredClone(validConfig());
  const schemeRelativeApi = schemeRelativePath.api as Record<string, unknown>;
  schemeRelativeApi.healthPath = "//other.example.test/health";

  const fragmentedPath = structuredClone(validConfig());
  const fragmentedUi = fragmentedPath.ui as {
    pages: Array<Record<string, unknown>>;
  };
  fragmentedUi.pages[0] = {
    ...fragmentedUi.pages[0],
    path: "/dashboard#private",
  };

  const controlCharacterPath = structuredClone(validConfig());
  (controlCharacterPath.api as Record<string, unknown>).healthPath =
    "/\n/other.example.test";

  const invalidMethod = structuredClone(validConfig());
  const invalidMethodApi = invalidMethod.api as {
    endpoints: Array<Record<string, unknown>>;
  };
  invalidMethodApi.endpoints[0] = {
    ...invalidMethodApi.endpoints[0],
    method: "POST",
  };

  const invalidStatus = structuredClone(validConfig());
  const invalidStatusApi = invalidStatus.api as {
    endpoints: Array<Record<string, unknown>>;
  };
  invalidStatusApi.endpoints[0] = {
    ...invalidStatusApi.endpoints[0],
    expectedStatus: 99,
  };

  const invalidThreshold = structuredClone(validConfig());
  (invalidThreshold.api as Record<string, unknown>).latencyThresholdMs = 3_000;

  const invalidTimeout = structuredClone(validConfig());
  (invalidTimeout.ui as Record<string, unknown>).timeoutMs = 0;

  assert.ok(issuePaths(invalidUrl).includes("api.baseUrl"));
  assert.ok(issuePaths(invalidProtocol).includes("api.baseUrl"));
  assert.ok(issuePaths(invalidFragment).includes("api.baseUrl"));
  assert.ok(issuePaths(invalidPath).includes("ui.pages.0.path"));
  assert.ok(issuePaths(schemeRelativePath).includes("api.healthPath"));
  assert.ok(issuePaths(fragmentedPath).includes("ui.pages.0.path"));
  assert.ok(issuePaths(controlCharacterPath).includes("api.healthPath"));
  assert.ok(issuePaths(invalidMethod).includes("api.endpoints.0.method"));
  assert.ok(
    issuePaths(invalidStatus).includes("api.endpoints.0.expectedStatus"),
  );
  assert.ok(issuePaths(invalidThreshold).includes("api.latencyThresholdMs"));
  assert.ok(issuePaths(invalidTimeout).includes("ui.timeoutMs"));
});

test("schema enforces viewports, unique names, and authentication relationships", () => {
  const invalidViewports = structuredClone(validConfig());
  (invalidViewports.ui as Record<string, unknown>).viewports = [
    {
      name: "only",
      width: 800,
      height: 600,
    },
  ];

  const duplicateEndpoints = structuredClone(validConfig());
  const duplicateApi = duplicateEndpoints.api as {
    endpoints: Array<Record<string, unknown>>;
  };
  const firstEndpoint = duplicateApi.endpoints[0];
  assert.ok(firstEndpoint);
  duplicateApi.endpoints.push(structuredClone(firstEndpoint));

  const duplicateViewports = structuredClone(validConfig());
  const duplicateViewportUi = duplicateViewports.ui as {
    viewports: Array<Record<string, unknown>>;
  };
  const firstViewport = duplicateViewportUi.viewports[0];
  const secondViewport = duplicateViewportUi.viewports[1];
  assert.ok(firstViewport);
  assert.ok(secondViewport);
  duplicateViewportUi.viewports[1] = {
    ...secondViewport,
    name: firstViewport.name,
  };

  const missingAuthentication = structuredClone(validConfig());
  delete (missingAuthentication.api as Record<string, unknown>).authentication;

  const missingPageAuthentication = structuredClone(validConfig());
  const pageUi = missingPageAuthentication.ui as {
    pages: Array<Record<string, unknown>>;
  };
  pageUi.pages[0] = {
    ...pageUi.pages[0],
    useAuthentication: true,
  };
  delete (missingPageAuthentication.ui as Record<string, unknown>)
    .authentication;

  const missingFlowAuthentication = structuredClone(validConfig());
  const flowUi = missingFlowAuthentication.ui as {
    formFlows: Array<Record<string, unknown>>;
  };
  flowUi.formFlows[0] = {
    ...flowUi.formFlows[0],
    useAuthentication: true,
  };
  delete (missingFlowAuthentication.ui as Record<string, unknown>)
    .authentication;

  const unknownAuthenticationKey = structuredClone(validConfig());
  const authentication = (
    unknownAuthenticationKey.api as Record<string, unknown>
  ).authentication as Record<string, unknown>;
  authentication.unexpected = true;

  assert.ok(issuePaths(invalidViewports).includes("ui.viewports"));
  assert.ok(issuePaths(duplicateEndpoints).includes("api.endpoints.1.name"));
  assert.ok(issuePaths(duplicateViewports).includes("ui.viewports.1.name"));
  assert.ok(
    issuePaths(missingAuthentication).includes(
      "api.endpoints.0.useAuthentication",
    ),
  );
  assert.ok(
    issuePaths(missingPageAuthentication).includes(
      "ui.pages.0.useAuthentication",
    ),
  );
  assert.ok(
    issuePaths(missingFlowAuthentication).includes(
      "ui.formFlows.0.useAuthentication",
    ),
  );
  assert.ok(
    issuePaths(unknownAuthenticationKey).includes("api.authentication"),
  );
});

test("enabled AI requires a supported provider", () => {
  assert.ok(
    issuePaths({
      ai: {
        enabled: true,
      },
    }).includes("ai.provider"),
  );
  assert.ok(
    issuePaths({
      ai: {
        enabled: true,
        provider: "unsupported",
      },
    }).includes("ai.provider"),
  );
});
