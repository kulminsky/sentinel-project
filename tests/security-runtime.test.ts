import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { disabledAiSetup } from "../src/ai/config.js";
import { checkDebugEndpoints } from "../src/checks/security/debug-endpoints.js";
import { checkSecurityHeaders } from "../src/checks/security/headers.js";
import { CHECKS } from "../src/checks/registry.js";
import { createSentinelConfigSchema } from "../src/config/schema.js";
import type {
  FetchLike,
  ScanContext,
  ServiceReachabilityCache,
} from "../src/core/check.js";
import { createScanReport } from "../src/core/result.js";
import { renderMarkdownReport } from "../src/report/markdown.js";
import { inspectRepository } from "../src/repository/inspection.js";

async function withTemporaryRepository(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "sentinel-security-runtime-"));

  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function endpoint(name: string, path: string, useAuthentication = false) {
  return {
    name,
    method: "GET" as const,
    path,
    expectedStatus: 200,
    useAuthentication,
  };
}

function runtimeConfig(
  root: string,
  options: {
    readonly apiBaseUrl?: string;
    readonly apiEndpoints?: ReturnType<typeof endpoint>[];
    readonly apiAuthentication?: boolean;
    readonly timeoutMs?: number;
    readonly uiBaseUrl?: string;
    readonly uiPages?: Array<{
      name: string;
      path: string;
      useAuthentication: boolean;
    }>;
  } = {},
) {
  const timeoutMs = options.timeoutMs ?? 100;

  return createSentinelConfigSchema(root).parse({
    target: { root },
    api: {
      baseUrl: options.apiBaseUrl ?? "https://api.example.test",
      healthPath: "/health",
      openApiPath: "./openapi.json",
      timeoutMs,
      latencyThresholdMs: Math.min(timeoutMs, 50),
      ...(options.apiAuthentication === true
        ? {
            authentication: {
              kind: "headers",
              headers: {
                Authorization: {
                  env: "FIXTURE_AUTHORIZATION",
                },
              },
            },
          }
        : {}),
      endpoints: options.apiEndpoints ?? [],
    },
    ui: {
      baseUrl: options.uiBaseUrl ?? "https://ui.example.test",
      timeoutMs,
      pages: options.uiPages ?? [
        {
          name: "home",
          path: "/",
          useAuthentication: false,
        },
      ],
      viewports: [
        { name: "mobile", width: 390, height: 844 },
        { name: "desktop", width: 1_440, height: 900 },
      ],
    },
  });
}

async function scanContext(
  root: string,
  fetch: FetchLike,
  options: Parameters<typeof runtimeConfig>[1] = {},
  reachability: ServiceReachabilityCache = {
    api: {
      state: "reachable",
      statusCode: 200,
      durationMs: 1,
    },
    ui: {
      state: "reachable",
      statusCode: 200,
      durationMs: 1,
    },
  },
): Promise<ScanContext> {
  return {
    config: runtimeConfig(root, options),
    repository: await inspectRepository(root),
    ai: disabledAiSetup(),
    resolveEnvironmentReference: () => undefined,
    fetch,
    reachability,
  };
}

function secureHeaders(kind: "api" | "ui"): Record<string, string> {
  return {
    "content-security-policy":
      kind === "ui"
        ? "default-src 'self'; frame-ancestors 'none'"
        : "default-src 'none'",
    "permissions-policy": "geolocation=()",
    "referrer-policy": "no-referrer",
    "strict-transport-security": "max-age=31536000",
    "x-content-type-options": "nosniff",
  };
}

test("Security checks replace the placeholder in deterministic registry order", () => {
  assert.deepEqual(
    CHECKS.filter((check) => check.level === "Security").map(
      (check) => check.id,
    ),
    [
      "security.npm-audit",
      "security.secret-scan",
      "security.env-hygiene",
      "security.headers",
      "security.debug-endpoints",
    ],
  );
  assert.equal(
    CHECKS.some((check) => check.id === "security.coverage"),
    false,
  );
});

test("runtime headers do not reuse the health probe or invent passes without configured targets", async () => {
  await withTemporaryRepository(async (root) => {
    let requests = 0;
    const execution = await checkSecurityHeaders(
      await scanContext(
        root,
        () => {
          requests += 1;
          return Promise.reject(new Error("no request expected"));
        },
        {
          apiEndpoints: [],
          uiPages: [],
        },
      ),
      new AbortController().signal,
    );

    assert.equal(requests, 0);
    assert.equal(execution.incomplete, false);
    assert.deepEqual(
      execution.results.map((result) => [result.status, result.diagnosticCode]),
      [
        ["Skipped", "SECURITY_API_NO_ENDPOINTS"],
        ["Skipped", "SECURITY_UI_NO_PAGES"],
      ],
    );
    assert.equal(
      execution.results.some((result) => result.status === "Pass"),
      false,
    );
  });
});

test("runtime headers report missing baselines and wildcard CORS without exposing values", async () => {
  await withTemporaryRepository(async (root) => {
    const responseCanary = "header-value-canary";
    const requests: Array<{
      target: string;
      headers: HeadersInit | undefined;
      redirect: RequestRedirect | undefined;
    }> = [];
    const fetch: FetchLike = (input, init) => {
      const target =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      requests.push({
        target,
        headers: init?.headers,
        redirect: init?.redirect,
      });
      return Promise.resolve(
        new Response(null, {
          status: 200,
          headers: target.endsWith("/public")
            ? {
                "access-control-allow-origin": "*",
                "x-response-canary": responseCanary,
              }
            : {
                "x-response-canary": responseCanary,
              },
        }),
      );
    };
    const execution = await checkSecurityHeaders(
      await scanContext(root, fetch, {
        apiEndpoints: [endpoint("public", "/public")],
      }),
      new AbortController().signal,
    );
    const serialized = JSON.stringify(execution);

    assert.ok(
      execution.results.some(
        (result) =>
          result.subject === "API response headers" && result.status === "Warn",
      ),
    );
    assert.ok(
      execution.results.some(
        (result) =>
          result.subject === "UI response headers" && result.status === "Warn",
      ),
    );
    assert.ok(
      execution.results.some(
        (result) =>
          result.subject === "API CORS policy" &&
          result.status === "Warn" &&
          result.severity === "Medium",
      ),
    );
    assert.equal(serialized.includes(responseCanary), false);
    assert.equal(serialized.includes("api.example.test"), false);
    assert.equal(serialized.includes("ui.example.test"), false);
    assert.equal(
      requests.some((request) => request.target.endsWith("/health")),
      false,
    );
    assert.equal(requests.length, 2);
    assert.ok(requests.every((request) => request.headers === undefined));
    assert.ok(requests.every((request) => request.redirect === "manual"));
  });
});

test("a wildcard frame-ancestors directive does not earn UI frame protection", async () => {
  await withTemporaryRepository(async (root) => {
    const fetch: FetchLike = (input) => {
      const target =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const headers = secureHeaders(
        target.includes("ui.example.test") ? "ui" : "api",
      );
      if (target.includes("ui.example.test")) {
        headers["content-security-policy"] =
          "default-src 'self'; frame-ancestors *";
      }
      return Promise.resolve(new Response(null, { status: 200, headers }));
    };
    const execution = await checkSecurityHeaders(
      await scanContext(root, fetch),
      new AbortController().signal,
    );
    const ui = execution.results.find(
      (result) => result.subject === "UI response headers",
    );

    assert.equal(ui?.status, "Warn");
    assert.match(ui?.evidence?.join(" ") ?? "", /frame protection/);
  });
});

test("non-enforcing CSP and disabled HSTS do not earn header passes", async () => {
  await withTemporaryRepository(async (root) => {
    const fetch: FetchLike = (input) => {
      const target =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const headers = secureHeaders(
        target.includes("ui.example.test") ? "ui" : "api",
      );
      headers["strict-transport-security"] = "max-age=0";

      if (target.includes("ui.example.test")) {
        headers["content-security-policy"] = "report-uri /csp-report";
        headers["x-frame-options"] = "DENY";
      }

      return Promise.resolve(new Response(null, { status: 200, headers }));
    };
    const execution = await checkSecurityHeaders(
      await scanContext(root, fetch, {
        apiEndpoints: [endpoint("catalog", "/catalog")],
      }),
      new AbortController().signal,
    );
    const api = execution.results.find(
      (result) => result.subject === "API response headers",
    );
    const ui = execution.results.find(
      (result) => result.subject === "UI response headers",
    );

    assert.equal(api?.status, "Warn");
    assert.match(api?.evidence?.join(" ") ?? "", /Strict-Transport-Security/);
    assert.equal(ui?.status, "Warn");
    assert.match(ui?.evidence?.join(" ") ?? "", /Content-Security-Policy/);
    assert.match(ui?.evidence?.join(" ") ?? "", /Strict-Transport-Security/);
  });
});

test("runtime headers pass when the bounded HTTP and HTTPS baseline is present", async () => {
  await withTemporaryRepository(async (root) => {
    const fetch: FetchLike = (input) => {
      const target =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      return Promise.resolve(
        new Response(null, {
          status: 204,
          headers: secureHeaders(
            target.includes("ui.example.test") ? "ui" : "api",
          ),
        }),
      );
    };
    const execution = await checkSecurityHeaders(
      await scanContext(root, fetch, {
        apiEndpoints: [endpoint("catalog", "/catalog")],
      }),
      new AbortController().signal,
    );

    assert.deepEqual(
      execution.results.map((result) => [result.subject, result.status]),
      [
        ["API response headers", "Pass"],
        ["API CORS policy", "Pass"],
        ["UI response headers", "Pass"],
      ],
    );
  });
});

test("HTTP targets do not require HSTS", async () => {
  await withTemporaryRepository(async (root) => {
    const fetch: FetchLike = (input) => {
      const target =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const headers = secureHeaders(
        target.includes("ui.example.test") ? "ui" : "api",
      );
      delete headers["strict-transport-security"];
      return Promise.resolve(new Response(null, { status: 200, headers }));
    };
    const execution = await checkSecurityHeaders(
      await scanContext(root, fetch, {
        apiBaseUrl: "http://api.example.test",
        apiEndpoints: [endpoint("catalog", "/catalog")],
        uiBaseUrl: "http://ui.example.test",
      }),
      new AbortController().signal,
    );

    assert.ok(
      execution.results
        .filter((result) => result.subject?.includes("response headers"))
        .every((result) => result.status === "Pass"),
    );
  });
});

test("non-success and timed-out runtime observations remain scoped skips", async () => {
  await withTemporaryRepository(async (root) => {
    const nonSuccess = await checkSecurityHeaders(
      await scanContext(
        root,
        () => Promise.resolve(new Response(null, { status: 500 })),
        {
          apiEndpoints: [endpoint("catalog", "/catalog")],
        },
      ),
      new AbortController().signal,
    );

    assert.equal(nonSuccess.incomplete, false);
    assert.ok(
      nonSuccess.results.every((result) => result.status === "Skipped"),
    );
    assert.ok(
      nonSuccess.results.every(
        (result) =>
          result.diagnosticCode === "SECURITY_HEADER_OBSERVATION_UNAVAILABLE",
      ),
    );

    const timedOut = await checkSecurityHeaders(
      await scanContext(
        root,
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new Error("timeout canary")),
              { once: true },
            );
          }),
        {
          apiEndpoints: [endpoint("catalog", "/catalog")],
          timeoutMs: 5,
        },
      ),
      new AbortController().signal,
    );

    assert.equal(timedOut.incomplete, false);
    assert.ok(timedOut.results.every((result) => result.status === "Skipped"));
    assert.equal(JSON.stringify(timedOut).includes("timeout canary"), false);
  });
});

test("runtime headers exclude authenticated targets without resolving credentials", async () => {
  await withTemporaryRepository(async (root) => {
    let requests = 0;
    const context = await scanContext(
      root,
      (_input, init) => {
        requests += 1;
        assert.equal(init?.headers, undefined);
        return Promise.resolve(
          new Response(null, {
            status: 200,
            headers: secureHeaders("api"),
          }),
        );
      },
      {
        apiAuthentication: true,
        apiEndpoints: [endpoint("private", "/private", true)],
        uiPages: [],
      },
    );
    const guardedContext: ScanContext = {
      ...context,
      resolveEnvironmentReference: () => {
        throw new Error("Target credentials must not be resolved.");
      },
    };
    const execution = await checkSecurityHeaders(
      guardedContext,
      new AbortController().signal,
    );

    assert.equal(requests, 0);
    assert.ok(
      execution.results.some(
        (result) =>
          result.diagnosticCode === "SECURITY_AUTHENTICATED_TARGET_SKIPPED",
      ),
    );
  });
});

test("unreachable services produce header notes without additional requests", async () => {
  await withTemporaryRepository(async (root) => {
    let requests = 0;
    const execution = await checkSecurityHeaders(
      await scanContext(
        root,
        () => {
          requests += 1;
          return Promise.reject(new Error("must not request"));
        },
        {},
        {
          api: {
            state: "unreachable",
            reason: "network-error",
            durationMs: 1,
          },
          ui: {
            state: "unreachable",
            reason: "timeout",
            durationMs: 1,
          },
        },
      ),
      new AbortController().signal,
    );

    assert.equal(requests, 0);
    assert.equal(execution.incomplete, false);
    assert.ok(execution.results.every((result) => result.status === "Skipped"));
  });
});

test("runtime header target bounds are visible and mark coverage incomplete", async () => {
  await withTemporaryRepository(async (root) => {
    const endpoints = Array.from({ length: 13 }, (_, index) =>
      endpoint(`endpoint-${index}`, `/endpoint-${index}`),
    );
    let requests = 0;
    const execution = await checkSecurityHeaders(
      await scanContext(
        root,
        () => {
          requests += 1;
          return Promise.resolve(
            new Response(null, {
              status: 200,
              headers: secureHeaders("api"),
            }),
          );
        },
        {
          apiEndpoints: endpoints,
          uiPages: [],
        },
      ),
      new AbortController().signal,
    );

    assert.equal(requests, 12);
    assert.equal(execution.incomplete, true);
    assert.ok(
      execution.results.some(
        (result) => result.diagnosticCode === "SECURITY_HEADER_TARGET_LIMIT",
      ),
    );
  });
});

test("debug discovery rejects multiline routes and sanitizes source-path evidence", async () => {
  await withTemporaryRepository(async (root) => {
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "package.json"),
      `${JSON.stringify({ name: "fixture" })}\n`,
      "utf8",
    );
    await writeFile(
      join(root, "src", "app.ts"),
      "app.get(`/debug/\\nROUTE_INJECTION_MARKER`, handler);\n",
      "utf8",
    );
    await writeFile(
      join(root, "src", "unsafe\nSOURCE_INJECTION_MARKER.ts"),
      'app.get("/debug/config", handler);\n',
      "utf8",
    );
    const execution = await checkDebugEndpoints(
      await scanContext(root, () =>
        Promise.resolve(new Response(null, { status: 404 })),
      ),
      new AbortController().signal,
    );
    const report = renderMarkdownReport(
      createScanReport({
        targetName: "fixture",
        generatedAt: "2026-01-01T00:00:00.000Z",
        incomplete: execution.incomplete,
        results: execution.results,
      }),
    );

    assert.equal(execution.results.length, 1);
    assert.equal(execution.results[0]?.status, "Warn");
    assert.match(
      execution.results[0]?.evidence?.join(" ") ?? "",
      /source path omitted: unsafe characters/,
    );
    assert.equal(report.includes("ROUTE_INJECTION_MARKER"), false);
    assert.equal(report.includes("SOURCE_INJECTION_MARKER"), false);
  });
});

test("debug discovery proves public exposure from a source declaration", async () => {
  await withTemporaryRepository(async (root) => {
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "package.json"),
      `${JSON.stringify({ name: "fixture" })}\n`,
      "utf8",
    );
    await writeFile(
      join(root, "src", "app.ts"),
      'app.get("/debug/config", (_request, response) => response.json({}));\n',
      "utf8",
    );
    let requestedTarget = "";
    const execution = await checkDebugEndpoints(
      await scanContext(root, (input, init) => {
        requestedTarget =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        assert.equal(init?.method, "GET");
        assert.equal(init?.headers, undefined);
        assert.equal(init?.redirect, "manual");
        return Promise.resolve(new Response(null, { status: 200 }));
      }),
      new AbortController().signal,
    );

    assert.equal(requestedTarget, "https://api.example.test/debug/config");
    assert.equal(execution.results[0]?.status, "Fail");
    assert.equal(execution.results[0]?.severity, "High");
    assert.match(
      execution.results[0]?.evidence?.join(" ") ?? "",
      /src\/app\.ts:1/,
    );
    assert.equal(JSON.stringify(execution).includes("api.example.test"), false);
  });
});

test("debug discovery recognizes configured and source-declared phpinfo.php routes", async () => {
  await withTemporaryRepository(async (root) => {
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "package.json"),
      `${JSON.stringify({ name: "fixture" })}\n`,
      "utf8",
    );
    await writeFile(
      join(root, "src", "app.ts"),
      'app.get("/phpinfo.php", handler);\n',
      "utf8",
    );
    let requests = 0;
    const execution = await checkDebugEndpoints(
      await scanContext(
        root,
        () => {
          requests += 1;
          return Promise.resolve(new Response(null, { status: 200 }));
        },
        {
          apiEndpoints: [endpoint("phpinfo", "/phpinfo.php")],
        },
      ),
      new AbortController().signal,
    );

    assert.equal(requests, 1);
    assert.equal(execution.results.length, 1);
    assert.equal(execution.results[0]?.status, "Fail");
    assert.equal(execution.results[0]?.subject, "API /phpinfo.php");
    assert.match(
      execution.results[0]?.evidence?.join(" ") ?? "",
      /Source: src\/app\.ts:1/,
    );
  });
});

test("configured UI debug paths are observed while authenticated debug paths are not requested", async () => {
  await withTemporaryRepository(async (root) => {
    let uiRequests = 0;
    const uiExecution = await checkDebugEndpoints(
      await scanContext(
        root,
        (input, init) => {
          uiRequests += 1;
          const target =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url;
          assert.equal(target, "https://ui.example.test/debug/status");
          assert.equal(init?.headers, undefined);
          return Promise.resolve(new Response(null, { status: 200 }));
        },
        {
          uiPages: [
            {
              name: "debug",
              path: "/debug/status",
              useAuthentication: false,
            },
          ],
        },
      ),
      new AbortController().signal,
    );

    assert.equal(uiRequests, 1);
    assert.equal(uiExecution.results[0]?.status, "Fail");
    assert.equal(uiExecution.results[0]?.subject, "UI /debug/status");

    let authenticatedRequests = 0;
    const authenticatedContext = await scanContext(
      root,
      () => {
        authenticatedRequests += 1;
        return Promise.resolve(new Response(null, { status: 200 }));
      },
      {
        apiAuthentication: true,
        apiEndpoints: [endpoint("debug", "/debug/config", true)],
        uiPages: [],
      },
    );
    const guardedContext: ScanContext = {
      ...authenticatedContext,
      resolveEnvironmentReference: () => {
        throw new Error("Target credentials must not be resolved.");
      },
    };
    const authenticatedExecution = await checkDebugEndpoints(
      guardedContext,
      new AbortController().signal,
    );

    assert.equal(authenticatedRequests, 0);
    assert.equal(authenticatedExecution.results[0]?.status, "Warn");
    assert.match(
      authenticatedExecution.results[0]?.finding ?? "",
      /requires authentication/,
    );
  });
});

test("declared debug routes remain warnings when protected or unsafe", async () => {
  await withTemporaryRepository(async (root) => {
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "package.json"),
      `${JSON.stringify({ name: "fixture" })}\n`,
      "utf8",
    );
    await writeFile(
      join(root, "src", "app.ts"),
      [
        'app.get("/debug/config", handler);',
        'app.post("/actuator/env", handler);',
      ].join("\n"),
      "utf8",
    );
    let requests = 0;
    const execution = await checkDebugEndpoints(
      await scanContext(root, () => {
        requests += 1;
        return Promise.resolve(new Response(null, { status: 403 }));
      }),
      new AbortController().signal,
    );

    assert.equal(requests, 1);
    assert.equal(execution.results.length, 2);
    assert.ok(execution.results.every((result) => result.status === "Warn"));
    assert.ok(execution.results.some((result) => result.severity === "Medium"));
    assert.ok(execution.results.some((result) => result.severity === "Low"));
  });
});

test("debug 404 and transport failures retain static warnings without raw errors", async () => {
  await withTemporaryRepository(async (root) => {
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "package.json"),
      `${JSON.stringify({ name: "fixture" })}\n`,
      "utf8",
    );
    await writeFile(
      join(root, "src", "app.ts"),
      [
        'app.get("/debug/missing", handler);',
        'app.get("/debug/unavailable", handler);',
      ].join("\n"),
      "utf8",
    );
    const execution = await checkDebugEndpoints(
      await scanContext(root, (input) => {
        const target =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;

        return target.endsWith("/debug/missing")
          ? Promise.resolve(new Response(null, { status: 404 }))
          : Promise.reject(new Error("transport failure canary"));
      }),
      new AbortController().signal,
    );

    assert.equal(execution.results.length, 2);
    assert.ok(
      execution.results.every(
        (result) => result.status === "Warn" && result.severity === "Low",
      ),
    );
    assert.ok(
      execution.results.some((result) =>
        result.evidence?.includes("HTTP status: 404"),
      ),
    );
    assert.equal(
      JSON.stringify(execution).includes("transport failure canary"),
      false,
    );
  });
});

test("debug discovery passes only for a complete supported scan with no candidates", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "package.json"),
      `${JSON.stringify({ name: "fixture" })}\n`,
      "utf8",
    );
    await writeFile(
      join(root, "app.ts"),
      'app.get("/health", handler);\n',
      "utf8",
    );
    const supported = await checkDebugEndpoints(
      await scanContext(root, () =>
        Promise.reject(new Error("no request expected")),
      ),
      new AbortController().signal,
    );

    assert.equal(supported.results[0]?.status, "Pass");
  });

  await withTemporaryRepository(async (root) => {
    const generic = await checkDebugEndpoints(
      await scanContext(root, () =>
        Promise.reject(new Error("no request expected")),
      ),
      new AbortController().signal,
    );

    assert.equal(generic.results[0]?.status, "Skipped");
    assert.equal(
      generic.results[0]?.diagnosticCode,
      "DEBUG_DISCOVERY_UNSUPPORTED",
    );
  });
});
