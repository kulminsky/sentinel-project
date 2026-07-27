import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "vitest";

import { loadSentinelConfig, SentinelConfigError } from "../src/config/load.js";

async function withTemporaryDirectory(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "sentinel-config-test-"));

  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function validApiConfig(): Record<string, unknown> {
  return {
    baseUrl: "https://api.file.example.test",
    healthPath: "/health",
    openApiPath: "./openapi.json",
    timeoutMs: 2_000,
    latencyThresholdMs: 500,
    endpoints: [
      {
        name: "file-endpoint",
        method: "GET",
        path: "/file",
        expectedStatus: 200,
        useAuthentication: false,
      },
    ],
  };
}

function validUiConfig(): Record<string, unknown> {
  return {
    baseUrl: "https://ui.file.example.test",
    timeoutMs: 3_000,
    pages: [
      {
        name: "file-page",
        path: "/file",
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
  };
}

async function captureConfigError(
  run: () => Promise<unknown>,
): Promise<SentinelConfigError> {
  try {
    await run();
  } catch (error: unknown) {
    assert.ok(error instanceof SentinelConfigError);
    return error;
  }

  assert.fail("Expected SentinelConfigError.");
}

test("zero configuration uses only the clean-run target and report defaults", async () => {
  await withTemporaryDirectory(async (directory) => {
    const loaded = await loadSentinelConfig({
      cwd: directory,
      environment: {},
    });

    assert.equal(loaded.config.target.root, directory);
    assert.equal(loaded.config.report.format, "markdown");
    assert.equal(
      loaded.config.report.path,
      join(directory, "sentinel-report.md"),
    );
    assert.deepEqual(loaded.config.ai, {
      enabled: false,
    });
    assert.equal(loaded.config.api, undefined);
    assert.equal(loaded.config.ui, undefined);
  });
});

test("report format environment mappings preserve precedence and strict path rules", async () => {
  await withTemporaryDirectory(async (directory) => {
    const jsonPath = join(directory, "report.json");
    const jsonConfig = await loadSentinelConfig({
      cwd: directory,
      environment: {
        SENTINEL_REPORT_FORMAT: "json",
        SENTINEL_REPORT_PATH: "./report.json",
      },
    });
    const terminalConfig = await loadSentinelConfig({
      cwd: directory,
      environment: {
        SENTINEL_REPORT_FORMAT: "terminal",
      },
    });
    const missingJsonPath = await captureConfigError(() =>
      loadSentinelConfig({
        cwd: directory,
        environment: {
          SENTINEL_REPORT_FORMAT: "json",
        },
      }),
    );
    const conflictingTerminalPath = await captureConfigError(() =>
      loadSentinelConfig({
        cwd: directory,
        environment: {
          SENTINEL_REPORT_FORMAT: "terminal",
          SENTINEL_REPORT_PATH: "./unused.md",
        },
      }),
    );
    const unsupportedFormat = await captureConfigError(() =>
      loadSentinelConfig({
        cwd: directory,
        environment: {
          SENTINEL_REPORT_FORMAT: "xml",
        },
      }),
    );
    await writeFile(
      join(directory, "sentinel.config.json"),
      JSON.stringify({
        report: {
          path: "./lower-precedence.md",
        },
      }),
      "utf8",
    );
    const lowerPrecedenceConflict = await captureConfigError(() =>
      loadSentinelConfig({
        cwd: directory,
        environment: {
          SENTINEL_REPORT_FORMAT: "terminal",
        },
      }),
    );

    assert.deepEqual(jsonConfig.config.report, {
      format: "json",
      path: jsonPath,
    });
    assert.deepEqual(terminalConfig.config.report, {
      format: "terminal",
    });
    assert.ok(
      missingJsonPath.issues.some((issue) => issue.path === "report.path"),
    );
    assert.ok(
      conflictingTerminalPath.issues.some(
        (issue) => issue.path === "report.path",
      ),
    );
    assert.ok(
      unsupportedFormat.issues.some((issue) => issue.path === "report.format"),
    );
    assert.ok(
      lowerPrecedenceConflict.issues.some(
        (issue) => issue.path === "report.path",
      ),
    );
  });
});

test("process environment overrides .env, which overrides JSON", async () => {
  await withTemporaryDirectory(async (directory) => {
    await writeFile(
      join(directory, "sentinel.config.json"),
      JSON.stringify({
        target: {
          root: "./json-target",
        },
        report: {
          format: "json",
          path: "./json-report.json",
        },
        api: {
          ...validApiConfig(),
          openApiPath: "./json-target/openapi.json",
        },
        ai: {
          enabled: false,
          provider: "claude",
        },
      }),
      "utf8",
    );
    await writeFile(
      join(directory, ".env"),
      [
        "SENTINEL_TARGET_ROOT=./dotenv-target",
        "SENTINEL_REPORT_FORMAT=markdown",
        "SENTINEL_REPORT_PATH=./dotenv-report.md",
        "SENTINEL_API_BASE_URL=https://api.dotenv.example.test",
        "SENTINEL_API_OPENAPI_PATH=./dotenv-target/openapi.yaml",
        "SENTINEL_AI_ENABLED=true",
        "SENTINEL_AI_PROVIDER=claude",
      ].join("\n"),
      "utf8",
    );

    const loaded = await loadSentinelConfig({
      cwd: directory,
      environment: {
        SENTINEL_TARGET_ROOT: "./process-target",
        SENTINEL_REPORT_FORMAT: "json",
        SENTINEL_REPORT_PATH: "./process-report.json",
        SENTINEL_API_BASE_URL: "https://api.process.example.test:9443",
        SENTINEL_API_OPENAPI_PATH: "./process-target/openapi.yml",
        SENTINEL_AI_PROVIDER: "openai",
      },
    });

    assert.equal(loaded.config.target.root, join(directory, "process-target"));
    assert.equal(
      loaded.config.report.path,
      join(directory, "process-report.json"),
    );
    assert.equal(loaded.config.report.format, "json");
    assert.equal(
      loaded.config.api?.baseUrl,
      "https://api.process.example.test:9443",
    );
    assert.equal(
      loaded.config.api?.openApiPath,
      join(directory, "process-target", "openapi.yml"),
    );
    assert.deepEqual(loaded.config.ai, {
      enabled: true,
      provider: "openai",
    });
  });
});

test("structured environment values populate every API and UI collection", async () => {
  await withTemporaryDirectory(async (directory) => {
    const secret = "runtime-only-" + Date.now().toString();
    const loaded = await loadSentinelConfig({
      cwd: directory,
      environment: {
        SENTINEL_API_BASE_URL: "https://api.environment.example.test",
        SENTINEL_API_HEALTH_PATH: "/ready",
        SENTINEL_API_OPENAPI_PATH: "./openapi.json",
        SENTINEL_API_TIMEOUT_MS: "2500",
        SENTINEL_API_LATENCY_THRESHOLD_MS: "400",
        SENTINEL_API_AUTHENTICATION: JSON.stringify({
          kind: "headers",
          headers: {
            Authorization: {
              env: "SENTINEL_TARGET_TOKEN",
            },
          },
        }),
        SENTINEL_API_ENDPOINTS: JSON.stringify([
          {
            name: "environment-endpoint",
            method: "HEAD",
            path: "/status",
            expectedStatus: 204,
            useAuthentication: true,
          },
        ]),
        SENTINEL_UI_BASE_URL: "https://ui.environment.example.test",
        SENTINEL_UI_TIMEOUT_MS: "3500",
        SENTINEL_UI_PAGES: JSON.stringify([
          {
            name: "environment-page",
            path: "/dashboard",
            useAuthentication: true,
          },
        ]),
        SENTINEL_UI_VIEWPORTS: JSON.stringify([
          {
            name: "narrow",
            width: 375,
            height: 812,
          },
          {
            name: "wide",
            width: 1_280,
            height: 800,
          },
        ]),
        SENTINEL_UI_AUTHENTICATION: JSON.stringify({
          kind: "headers",
          headers: {
            "X-Test-Token": {
              env: "SENTINEL_TARGET_TOKEN",
            },
          },
        }),
        SENTINEL_UI_FORM_FLOWS: JSON.stringify([
          {
            name: "environment-flow",
            startPath: "/form",
            useAuthentication: false,
            steps: [
              {
                type: "fill",
                selector: "#email",
                value: {
                  source: "environment",
                  env: "TARGET_FORM_EMAIL",
                },
              },
            ],
          },
        ]),
        SENTINEL_TARGET_TOKEN: secret,
        TARGET_FORM_EMAIL: "fixture@example.test",
        UNRELATED_PROJECT_VALUE: "ignored",
      },
    });

    assert.equal(loaded.config.api?.endpoints[0]?.path, "/status");
    assert.equal(loaded.config.ui?.pages[0]?.path, "/dashboard");
    assert.equal(loaded.config.ui?.viewports[1]?.name, "wide");
    assert.equal(loaded.config.ui?.formFlows?.[0]?.name, "environment-flow");
    assert.equal(
      loaded.resolveEnvironmentReference("SENTINEL_TARGET_TOKEN"),
      secret,
    );
    assert.equal(JSON.stringify(loaded.config).includes(secret), false);
  });
});

test("custom config location becomes the base for filesystem paths", async () => {
  await withTemporaryDirectory(async (directory) => {
    const configPath = join(directory, "configuration", "custom.json");
    await mkdir(dirname(configPath), {
      recursive: true,
    });
    await writeFile(
      configPath,
      JSON.stringify({
        target: {
          root: "../target",
        },
        report: {
          path: "./reports/result.md",
        },
        ui: {
          ...validUiConfig(),
          authentication: {
            kind: "storageState",
            path: "./auth/state.json",
          },
        },
      }),
      "utf8",
    );
    await writeFile(
      join(directory, ".env"),
      "SENTINEL_REPORT_PATH=./wrong-directory.md",
      "utf8",
    );
    await writeFile(
      join(dirname(configPath), ".env"),
      "SENTINEL_REPORT_PATH=./reports/from-adjacent-env.md",
      "utf8",
    );

    const loaded = await loadSentinelConfig({
      cwd: directory,
      configPath: "./configuration/custom.json",
      environment: {},
    });

    assert.equal(
      loaded.config.target.root,
      resolve(directory, "configuration", "../target"),
    );
    assert.equal(
      loaded.config.report.path,
      resolve(directory, "configuration", "reports/from-adjacent-env.md"),
    );
    assert.equal(loaded.config.ui?.authentication?.kind, "storageState");
    if (loaded.config.ui?.authentication?.kind === "storageState") {
      assert.equal(
        loaded.config.ui.authentication.path,
        resolve(directory, "configuration", "auth/state.json"),
      );
    }
  });
});

test("tool defaults remain rooted in the invocation directory", async () => {
  await withTemporaryDirectory(async (directory) => {
    const configPath = join(directory, "configuration", "custom.json");
    await mkdir(dirname(configPath), {
      recursive: true,
    });
    await writeFile(
      configPath,
      JSON.stringify({
        ai: {
          enabled: false,
        },
      }),
      "utf8",
    );

    const loaded = await loadSentinelConfig({
      cwd: directory,
      configPath,
      environment: {},
    });

    assert.equal(loaded.config.target.root, directory);
    assert.equal(
      loaded.config.report.path,
      join(directory, "sentinel-report.md"),
    );
  });
});

test("missing conventional files are optional but an explicit missing config is fatal", async () => {
  await withTemporaryDirectory(async (directory) => {
    await loadSentinelConfig({
      cwd: directory,
      environment: {},
    });

    const error = await captureConfigError(() =>
      loadSentinelConfig({
        cwd: directory,
        configPath: "./missing.json",
        environment: {},
      }),
    );

    assert.deepEqual(error.issues, [
      {
        path: "configFile",
        message: "The explicitly requested file does not exist.",
      },
    ]);
  });
});

test("malformed source values fail without exposing their contents", async () => {
  await withTemporaryDirectory(async (directory) => {
    const sensitiveMarker = "do-not-render-" + Date.now().toString();
    await writeFile(
      join(directory, "sentinel.config.json"),
      `{"api": ${sensitiveMarker}`,
      "utf8",
    );

    const jsonError = await captureConfigError(() =>
      loadSentinelConfig({
        cwd: directory,
        environment: {},
      }),
    );
    await rm(join(directory, "sentinel.config.json"));
    const environmentError = await captureConfigError(() =>
      loadSentinelConfig({
        cwd: directory,
        environment: {
          SENTINEL_API_ENDPOINTS: sensitiveMarker,
        },
      }),
    );

    assert.equal(jsonError.issues[0]?.path, "configFile");
    assert.equal(
      environmentError.issues[0]?.path,
      "environment.SENTINEL_API_ENDPOINTS",
    );
    assert.equal(jsonError.message.includes(sensitiveMarker), false);
    assert.equal(environmentError.message.includes(sensitiveMarker), false);
  });
});

test("malformed .env syntax fails at envFile without exposing the line", async () => {
  await withTemporaryDirectory(async (directory) => {
    const sensitiveMarker = "invalid-line-" + Date.now().toString();
    await writeFile(
      join(directory, ".env"),
      `not an assignment ${sensitiveMarker}`,
      "utf8",
    );

    const error = await captureConfigError(() =>
      loadSentinelConfig({
        cwd: directory,
        environment: {},
      }),
    );

    assert.deepEqual(error.issues, [
      {
        path: "envFile",
        message: "The .env file could not be parsed.",
      },
    ]);
    assert.equal(error.message.includes(sensitiveMarker), false);
  });
});

test("a UTF-8 BOM does not hide Sentinel environment mappings", async () => {
  await withTemporaryDirectory(async (directory) => {
    await writeFile(
      join(directory, ".env"),
      ["\uFEFFSENTINEL_AI_ENABLED=true", "SENTINEL_AI_PROVIDER=openai"].join(
        "\n",
      ),
      "utf8",
    );

    const loaded = await loadSentinelConfig({
      cwd: directory,
      environment: {},
    });

    assert.deepEqual(loaded.config.ai, {
      enabled: true,
      provider: "openai",
    });
  });
});

test("quoted .env values allow comments but reject other trailing content", async () => {
  await withTemporaryDirectory(async (directory) => {
    const sensitiveMarker = "discarded-" + Date.now().toString();
    const environmentPath = join(directory, ".env");
    const malformedValues = [
      `SENTINEL_REPORT_PATH="report.md" ${sensitiveMarker}`,
      String.raw`SENTINEL_REPORT_PATH="report\".md"`,
    ];

    for (const malformedValue of malformedValues) {
      await writeFile(environmentPath, malformedValue, "utf8");
      const error = await captureConfigError(() =>
        loadSentinelConfig({
          cwd: directory,
          environment: {},
        }),
      );

      assert.deepEqual(error.issues, [
        {
          path: "envFile",
          message: "The .env file could not be parsed.",
        },
      ]);
      assert.equal(error.message.includes(sensitiveMarker), false);
    }

    await writeFile(
      environmentPath,
      'SENTINEL_REPORT_PATH="report.md" # accepted comment',
      "utf8",
    );
    const loaded = await loadSentinelConfig({
      cwd: directory,
      environment: {},
    });

    assert.equal(loaded.config.report.path, join(directory, "report.md"));
  });
});

test("unknown JSON and Sentinel environment keys are path-specific errors", async () => {
  await withTemporaryDirectory(async (directory) => {
    await writeFile(
      join(directory, "sentinel.config.json"),
      JSON.stringify({
        api: {
          ...validApiConfig(),
          unexpected: true,
        },
      }),
      "utf8",
    );

    const jsonError = await captureConfigError(() =>
      loadSentinelConfig({
        cwd: directory,
        environment: {},
      }),
    );
    await rm(join(directory, "sentinel.config.json"));
    const environmentError = await captureConfigError(() =>
      loadSentinelConfig({
        cwd: directory,
        environment: {
          SENTINEL_UNKNOWN_SETTING: "value",
        },
      }),
    );

    assert.ok(
      jsonError.issues.some((issue) => issue.path === "api.unexpected"),
    );
    assert.equal(
      environmentError.issues[0]?.path,
      "environment.SENTINEL_UNKNOWN_SETTING",
    );
  });
});

test("invalid supplied sections never fall back to an omitted-section default", async () => {
  await withTemporaryDirectory(async (directory) => {
    await writeFile(
      join(directory, "sentinel.config.json"),
      JSON.stringify({
        api: {
          ...validApiConfig(),
          baseUrl: "not-a-url",
        },
        ai: {
          enabled: true,
        },
      }),
      "utf8",
    );

    const error = await captureConfigError(() =>
      loadSentinelConfig({
        cwd: directory,
        environment: {},
      }),
    );

    assert.ok(error.issues.some((issue) => issue.path === "api.baseUrl"));
    assert.ok(error.issues.some((issue) => issue.path === "ai.provider"));
  });
});

test("invalid environment scalars fail at their environment path", async () => {
  await withTemporaryDirectory(async (directory) => {
    const booleanError = await captureConfigError(() =>
      loadSentinelConfig({
        cwd: directory,
        environment: {
          SENTINEL_AI_ENABLED: "TRUE",
        },
      }),
    );
    const numberError = await captureConfigError(() =>
      loadSentinelConfig({
        cwd: directory,
        environment: {
          SENTINEL_API_TIMEOUT_MS: "not-a-number",
        },
      }),
    );

    assert.equal(
      booleanError.issues[0]?.path,
      "environment.SENTINEL_AI_ENABLED",
    );
    assert.equal(
      numberError.issues[0]?.path,
      "environment.SENTINEL_API_TIMEOUT_MS",
    );
  });
});
