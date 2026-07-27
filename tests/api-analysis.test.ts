import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, vi } from "vitest";

import { disabledAiSetup } from "../src/ai/config.js";
import {
  apiRuntimeContractCheck,
  apiStaticOpenApiCheck,
} from "../src/checks/api/checks.js";
import { createSentinelConfigSchema } from "../src/config/schema.js";
import type {
  FetchLike,
  ScanContext,
  ServiceReachability,
} from "../src/core/check.js";
import { inspectRepository } from "../src/repository/inspection.js";

interface EndpointOptions {
  readonly expectedContentType?: string;
  readonly expectedStatus?: number;
  readonly method?: "GET" | "HEAD" | "OPTIONS";
  readonly requiredJsonFields?: string[];
  readonly useAuthentication?: boolean;
}

async function withTemporaryRepository(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "sentinel-api-analysis-"));

  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function endpoint(name: string, path: string, options: EndpointOptions = {}) {
  return {
    name,
    method: options.method ?? ("GET" as const),
    path,
    expectedStatus: options.expectedStatus ?? 200,
    ...(options.expectedContentType === undefined
      ? {}
      : { expectedContentType: options.expectedContentType }),
    ...(options.requiredJsonFields === undefined
      ? {}
      : { requiredJsonFields: options.requiredJsonFields }),
    useAuthentication: options.useAuthentication ?? false,
  };
}

function jsonOperation(options: {
  readonly required?: string[];
  readonly properties?: Record<string, unknown>;
  readonly schema?: Record<string, unknown>;
  readonly status?: number;
}) {
  return {
    responses: {
      [String(options.status ?? 200)]: {
        description: "Fixture response",
        content: {
          "application/json": {
            schema:
              options.schema ??
              ({
                type: "object",
                required: options.required ?? [],
                properties: options.properties ?? {},
              } satisfies Record<string, unknown>),
          },
        },
      },
    },
  };
}

function openApiDocument(
  paths: Record<string, unknown>,
  version = "3.0.3",
): string {
  return JSON.stringify({
    openapi: version,
    info: {
      title: "Fixture",
      version: "1.0.0",
    },
    paths,
  });
}

async function createContext(options: {
  readonly root: string;
  readonly endpoints: ReturnType<typeof endpoint>[];
  readonly fetch: FetchLike;
  readonly openApiPath?: string;
  readonly reachability: ServiceReachability;
  readonly resolveEnvironmentReference?: (name: string) => string | undefined;
  readonly authentication?: {
    kind: "headers";
    headers: Record<string, { env: string }>;
  };
  readonly latencyThresholdMs?: number;
  readonly timeoutMs?: number;
}): Promise<ScanContext> {
  const config = createSentinelConfigSchema(options.root).parse({
    target: {
      root: options.root,
    },
    api: {
      baseUrl: "https://api.example.test",
      healthPath: "/health",
      openApiPath: options.openApiPath ?? "./openapi.json",
      timeoutMs: options.timeoutMs ?? 100,
      latencyThresholdMs: options.latencyThresholdMs ?? 50,
      ...(options.authentication === undefined
        ? {}
        : { authentication: options.authentication }),
      endpoints: options.endpoints,
    },
  });

  return {
    config,
    repository: await inspectRepository(options.root),
    ai: disabledAiSetup(),
    resolveEnvironmentReference:
      options.resolveEnvironmentReference ?? (() => undefined),
    fetch: options.fetch,
    reachability: {
      api: options.reachability,
      ui: {
        state: "not-configured",
      },
    },
  };
}

function reachable(): ServiceReachability {
  return {
    state: "reachable",
    statusCode: 200,
    durationMs: 1,
  };
}

function unreachable(): ServiceReachability {
  return {
    state: "unreachable",
    reason: "network-error",
    durationMs: 1,
  };
}

function requestTarget(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }

  return input instanceof URL ? input.href : input.url;
}

test("reachable mode makes one request and exclusively emits live findings", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/api/items/{id}": {
          get: jsonOperation({
            required: ["id"],
            properties: {
              id: {
                type: "string",
              },
            },
          }),
        },
      }),
    );
    let requests = 0;
    const context = await createContext({
      root,
      endpoints: [
        endpoint("item", "/api/items/[review](bad)?trace=private", {
          expectedContentType: "application/json",
          requiredJsonFields: ["id"],
        }),
      ],
      reachability: reachable(),
      fetch: (input, init) => {
        requests += 1;
        assert.equal(init?.method, "GET");
        assert.equal(init?.redirect, "manual");
        assert.equal(
          new URL(requestTarget(input)).pathname,
          "/api/items/[review](bad)",
        );
        return Promise.resolve(
          Response.json(
            {
              id: "123",
            },
            {
              status: 200,
            },
          ),
        );
      },
    });

    const live = await apiRuntimeContractCheck.run(
      context,
      new AbortController().signal,
    );
    const fallback = await apiStaticOpenApiCheck.run(
      context,
      new AbortController().signal,
    );

    assert.equal(requests, 1);
    assert.equal(live.results.length, 1);
    assert.equal(live.results[0]?.status, "Pass");
    assert.equal(
      live.results[0]?.subject,
      "GET /api/items/%5Breview%5D%28bad%29",
    );
    assert.equal(JSON.stringify(live).includes("trace=private"), false);
    assert.equal(JSON.stringify(live).includes("[review](bad)"), false);
    assert.equal(fallback.results[0]?.status, "Skipped");
    assert.equal(
      fallback.results[0]?.diagnosticCode,
      "API_FALLBACK_NOT_SELECTED",
    );
  });
});

test("unreachable mode exclusively performs static OpenAPI fallback", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/api/items": {
          get: jsonOperation({
            required: ["items"],
            properties: {
              items: {
                type: "string",
              },
            },
          }),
        },
      }),
    );
    let requests = 0;
    const context = await createContext({
      root,
      endpoints: [
        endpoint("items", "/api/items", {
          expectedContentType: "application/json",
          requiredJsonFields: ["items"],
        }),
      ],
      reachability: unreachable(),
      fetch: () => {
        requests += 1;
        return Promise.reject(new Error("Unexpected request."));
      },
    });

    const live = await apiRuntimeContractCheck.run(
      context,
      new AbortController().signal,
    );
    const fallback = await apiStaticOpenApiCheck.run(
      context,
      new AbortController().signal,
    );

    assert.equal(requests, 0);
    assert.equal(live.results[0]?.status, "Skipped");
    assert.equal(live.results[0]?.diagnosticCode, "API_RUNTIME_UNAVAILABLE");
    assert.deepEqual(
      fallback.results.map((result) => result.status),
      ["Pass", "Pass"],
    );
    assert.ok(
      fallback.results.every((result) =>
        result.finding.includes("No live response or latency was observed"),
      ),
    );
  });
});

test("live mode reports OpenAPI-required field and primitive type failures", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/api/profile": {
          get: jsonOperation({
            required: ["id", "plan"],
            properties: {
              id: {
                type: "string",
              },
              plan: {
                type: "string",
              },
            },
          }),
        },
      }),
    );
    const context = await createContext({
      root,
      endpoints: [
        endpoint("profile", "/api/profile", {
          expectedContentType: "application/json",
          requiredJsonFields: ["id"],
        }),
      ],
      reachability: reachable(),
      fetch: () =>
        Promise.resolve(
          Response.json({
            id: 42,
          }),
        ),
    });

    const live = await apiRuntimeContractCheck.run(
      context,
      new AbortController().signal,
    );

    assert.equal(live.results[0]?.status, "Fail");
    assert.equal(live.results[0]?.severity, "High");
    assert.match(live.results[0]?.finding ?? "", /shallow OpenAPI shape/);
    assert.equal(JSON.stringify(live).includes('"id":42'), false);
  });
});

test("live mode validates documented optional primitive properties when present", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/api/count": {
          get: jsonOperation({
            properties: {
              count: {
                type: "integer",
              },
            },
          }),
        },
      }),
    );
    const context = await createContext({
      root,
      endpoints: [
        endpoint("count", "/api/count", {
          expectedContentType: "application/json",
        }),
      ],
      reachability: reachable(),
      fetch: () =>
        Promise.resolve(
          Response.json({
            count: "invalid",
          }),
        ),
    });

    const live = await apiRuntimeContractCheck.run(
      context,
      new AbortController().signal,
    );

    assert.equal(live.results[0]?.status, "Fail");
    assert.equal(live.results[0]?.severity, "High");
    assert.match(live.results[0]?.finding ?? "", /shallow OpenAPI shape/);
  });
});

test("live mode requires configured fields to be represented by OpenAPI", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/api/item": {
          get: jsonOperation({
            properties: {},
          }),
        },
      }),
    );
    const context = await createContext({
      root,
      endpoints: [
        endpoint("item", "/api/item", {
          expectedContentType: "application/json",
          requiredJsonFields: ["id"],
        }),
      ],
      reachability: reachable(),
      fetch: () =>
        Promise.resolve(
          Response.json({
            id: "present",
          }),
        ),
    });

    const live = await apiRuntimeContractCheck.run(
      context,
      new AbortController().signal,
    );

    assert.equal(live.results[0]?.status, "Fail");
    assert.equal(live.results[0]?.severity, "High");
    assert.match(
      live.results[0]?.finding ?? "",
      /not represented by the OpenAPI schema/,
    );
  });
});

test("live mode cannot pass unsupported optional or nested property schemas", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/reference": {
          get: jsonOperation({
            properties: {
              details: {
                $ref: "#/components/schemas/Details",
              },
            },
          }),
        },
        "/nested-object": {
          get: jsonOperation({
            properties: {
              details: {
                type: "object",
                properties: {
                  name: {
                    type: "string",
                  },
                },
              },
            },
          }),
        },
        "/nested-array": {
          get: jsonOperation({
            properties: {
              items: {
                type: "array",
                items: {
                  type: "string",
                },
              },
            },
          }),
        },
      }),
    );
    const context = await createContext({
      root,
      endpoints: [
        endpoint("reference", "/reference", {
          expectedContentType: "application/json",
        }),
        endpoint("nested-object", "/nested-object", {
          expectedContentType: "application/json",
        }),
        endpoint("nested-array", "/nested-array", {
          expectedContentType: "application/json",
        }),
      ],
      reachability: reachable(),
      fetch: () => Promise.resolve(Response.json({})),
    });

    const live = await apiRuntimeContractCheck.run(
      context,
      new AbortController().signal,
    );

    assert.deepEqual(
      live.results.map((result) => result.status),
      ["Warn", "Warn", "Warn"],
    );
    assert.ok(
      live.results.every((result) =>
        result.finding.includes("unsupported constructs"),
      ),
    );
  });
});

test("top-level nested schema constraints cannot earn live or static passes", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/items": {
          get: jsonOperation({
            schema: {
              type: "array",
              items: {
                type: "string",
              },
            },
          }),
        },
        "/contains": {
          get: jsonOperation({
            schema: {
              type: "array",
              contains: {
                type: "string",
              },
            },
          }),
        },
        "/prefix-items": {
          get: jsonOperation({
            schema: {
              type: "array",
              prefixItems: [
                {
                  type: "string",
                },
              ],
            },
          }),
        },
        "/additional-properties": {
          get: jsonOperation({
            schema: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          }),
        },
      }),
    );
    const endpoints = [
      endpoint("items", "/items", {
        expectedContentType: "application/json",
      }),
      endpoint("contains", "/contains", {
        expectedContentType: "application/json",
      }),
      endpoint("prefix-items", "/prefix-items", {
        expectedContentType: "application/json",
      }),
      endpoint("additional-properties", "/additional-properties", {
        expectedContentType: "application/json",
      }),
    ];
    const liveContext = await createContext({
      root,
      endpoints,
      reachability: reachable(),
      fetch: (input) =>
        Promise.resolve(
          Response.json(
            new URL(requestTarget(input)).pathname === "/additional-properties"
              ? {}
              : [42],
          ),
        ),
    });
    const staticContext = await createContext({
      root,
      endpoints,
      reachability: unreachable(),
      fetch: () => Promise.reject(new Error("Unexpected request.")),
    });

    const live = await apiRuntimeContractCheck.run(
      liveContext,
      new AbortController().signal,
    );
    const fallback = await apiStaticOpenApiCheck.run(
      staticContext,
      new AbortController().signal,
    );

    assert.ok(live.results.every((result) => result.status === "Warn"));
    assert.ok(
      live.results.every((result) =>
        result.finding.includes("unsupported constructs"),
      ),
    );
    assert.ok(
      fallback.results.slice(1).every((result) => result.status === "Warn"),
    );
  });
});

test("live mode cannot pass when a documented response media type has no schema", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/api/items": {
          get: {
            responses: {
              "200": {
                description: "Schema intentionally absent",
                content: {
                  "application/json": {},
                },
              },
            },
          },
        },
      }),
    );
    const context = await createContext({
      root,
      endpoints: [
        endpoint("items", "/api/items", {
          expectedContentType: "application/json",
        }),
      ],
      reachability: reachable(),
      fetch: () => Promise.resolve(Response.json({ items: [] })),
    });

    const live = await apiRuntimeContractCheck.run(
      context,
      new AbortController().signal,
    );

    assert.equal(live.results[0]?.status, "Warn");
    assert.equal(live.results[0]?.severity, "Medium");
    assert.match(live.results[0]?.finding ?? "", /had no schema/);
  });
});

test("valid bodyless responses pass while undocumented response content fails", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/head": {
          head: {
            responses: {
              "200": {
                description: "Headers only",
              },
            },
          },
        },
        "/empty": {
          get: {
            responses: {
              "204": {
                description: "No content",
              },
            },
          },
        },
        "/unexpected": {
          get: {
            responses: {
              "200": {
                description: "No content documented",
              },
            },
          },
        },
      }),
    );
    const context = await createContext({
      root,
      endpoints: [
        endpoint("head", "/head", {
          method: "HEAD",
        }),
        endpoint("empty", "/empty", {
          expectedStatus: 204,
        }),
        endpoint("unexpected", "/unexpected"),
      ],
      reachability: reachable(),
      fetch: (input) => {
        const pathname = new URL(requestTarget(input)).pathname;
        if (pathname === "/unexpected") {
          return Promise.resolve(Response.json({ unexpected: true }));
        }

        return Promise.resolve(
          new Response(null, {
            status: pathname === "/empty" ? 204 : 200,
          }),
        );
      },
    });

    const live = await apiRuntimeContractCheck.run(
      context,
      new AbortController().signal,
    );

    assert.deepEqual(
      live.results.map((result) => result.status),
      ["Pass", "Pass", "Fail"],
    );
    assert.match(live.results[2]?.finding ?? "", /not documented by OpenAPI/);
  });
});

test("an empty required JSON field list behaves like an omitted list", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/omitted": {
          get: {
            responses: {
              "204": {
                description: "No content",
              },
            },
          },
        },
        "/empty": {
          get: {
            responses: {
              "204": {
                description: "No content",
              },
            },
          },
        },
      }),
    );
    const context = await createContext({
      root,
      endpoints: [
        endpoint("omitted", "/omitted", {
          expectedStatus: 204,
        }),
        endpoint("empty", "/empty", {
          expectedStatus: 204,
          requiredJsonFields: [],
        }),
      ],
      reachability: reachable(),
      fetch: () => Promise.resolve(new Response(null, { status: 204 })),
    });

    const live = await apiRuntimeContractCheck.run(
      context,
      new AbortController().signal,
    );

    assert.deepEqual(
      live.results.map((result) => ({
        status: result.status,
        severity: result.severity,
      })),
      [
        { status: "Pass", severity: "Info" },
        { status: "Pass", severity: "Info" },
      ],
    );
  });
});

test("invalid UTF-8 in an expected JSON response fails contract validation", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/api/value": {
          get: jsonOperation({
            properties: {
              value: {
                type: "string",
              },
            },
          }),
        },
      }),
    );
    const context = await createContext({
      root,
      endpoints: [
        endpoint("value", "/api/value", {
          expectedContentType: "application/json",
        }),
      ],
      reachability: reachable(),
      fetch: () =>
        Promise.resolve(
          new Response(
            new Uint8Array([
              0x7b, 0x22, 0x76, 0x61, 0x6c, 0x75, 0x65, 0x22, 0x3a, 0x22, 0xff,
              0x22, 0x7d,
            ]),
            {
              headers: {
                "content-type": "application/json",
              },
            },
          ),
        ),
    });

    const live = await apiRuntimeContractCheck.run(
      context,
      new AbortController().signal,
    );

    assert.equal(live.results[0]?.status, "Fail");
    assert.equal(live.results[0]?.severity, "High");
    assert.match(live.results[0]?.finding ?? "", /not valid UTF-8/);
  });
});

test("OpenAPI 3.0 nullable schemas degrade to unsupported instead of false failures", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/property": {
          get: jsonOperation({
            required: ["nickname"],
            properties: {
              nickname: {
                type: "string",
                nullable: true,
              },
            },
          }),
        },
        "/top-level": {
          get: jsonOperation({
            schema: {
              type: "string",
              nullable: true,
            },
          }),
        },
      }),
    );
    const endpoints = [
      endpoint("property", "/property", {
        expectedContentType: "application/json",
      }),
      endpoint("top-level", "/top-level", {
        expectedContentType: "application/json",
      }),
    ];
    const liveContext = await createContext({
      root,
      endpoints,
      reachability: reachable(),
      fetch: (input) =>
        Promise.resolve(
          Response.json(
            new URL(requestTarget(input)).pathname === "/property"
              ? {
                  nickname: null,
                }
              : null,
          ),
        ),
    });
    const staticContext = await createContext({
      root,
      endpoints,
      reachability: unreachable(),
      fetch: () => Promise.reject(new Error("Unexpected request.")),
    });

    const live = await apiRuntimeContractCheck.run(
      liveContext,
      new AbortController().signal,
    );
    const fallback = await apiStaticOpenApiCheck.run(
      staticContext,
      new AbortController().signal,
    );

    assert.ok(
      live.results.every(
        (result) => result.status === "Warn" && result.severity === "Medium",
      ),
    );
    assert.ok(
      fallback.results.slice(1).every((result) => result.status === "Warn"),
    );
  });
});

test("schema type support follows the OpenAPI 3.0 and 3.1 dialects", async () => {
  await withTemporaryRepository(async (root) => {
    const paths = {
      "/null": {
        get: jsonOperation({
          schema: {
            type: "null",
          },
        }),
      },
      "/array": {
        get: jsonOperation({
          schema: {
            type: "array",
          },
        }),
      },
      "/property-null": {
        get: jsonOperation({
          properties: {
            value: {
              type: "null",
            },
          },
        }),
      },
      "/property-array": {
        get: jsonOperation({
          properties: {
            values: {
              type: "array",
            },
          },
        }),
      },
    };
    await writeFile(
      join(root, "openapi-30.json"),
      openApiDocument(paths, "3.0.3"),
    );
    await writeFile(
      join(root, "openapi-31.json"),
      openApiDocument(paths, "3.1.0"),
    );
    const endpoints = [
      endpoint("null", "/null", {
        expectedContentType: "application/json",
      }),
      endpoint("array", "/array", {
        expectedContentType: "application/json",
      }),
      endpoint("property-null", "/property-null", {
        expectedContentType: "application/json",
      }),
      endpoint("property-array", "/property-array", {
        expectedContentType: "application/json",
      }),
    ];
    const fetch = (input: string | URL | Request) => {
      const pathname = new URL(requestTarget(input)).pathname;
      if (pathname === "/null") {
        return Promise.resolve(Response.json(null));
      }
      if (pathname === "/array") {
        return Promise.resolve(Response.json([]));
      }
      if (pathname === "/property-null") {
        return Promise.resolve(Response.json({ value: null }));
      }

      return Promise.resolve(Response.json({ values: [] }));
    };
    const live30Context = await createContext({
      root,
      endpoints,
      openApiPath: "./openapi-30.json",
      reachability: reachable(),
      fetch,
    });
    const static30Context = await createContext({
      root,
      endpoints,
      openApiPath: "./openapi-30.json",
      reachability: unreachable(),
      fetch: () => Promise.reject(new Error("Unexpected request.")),
    });
    const live31Context = await createContext({
      root,
      endpoints,
      openApiPath: "./openapi-31.json",
      reachability: reachable(),
      fetch,
    });
    const static31Context = await createContext({
      root,
      endpoints,
      openApiPath: "./openapi-31.json",
      reachability: unreachable(),
      fetch: () => Promise.reject(new Error("Unexpected request.")),
    });

    const [live30, fallback30, live31, fallback31] = await Promise.all([
      apiRuntimeContractCheck.run(live30Context, new AbortController().signal),
      apiStaticOpenApiCheck.run(static30Context, new AbortController().signal),
      apiRuntimeContractCheck.run(live31Context, new AbortController().signal),
      apiStaticOpenApiCheck.run(static31Context, new AbortController().signal),
    ]);

    assert.ok(live30.results.every((result) => result.status === "Warn"));
    assert.ok(fallback30.results.every((result) => result.status === "Warn"));
    assert.ok(
      [...live30.results, ...fallback30.results].every((result) =>
        result.finding.includes("unsupported"),
      ),
    );
    assert.ok(live31.results.every((result) => result.status === "Pass"));
    assert.ok(fallback31.results.every((result) => result.status === "Pass"));
  });
});

test("the committed sample contract preserves positive and drift outcomes", async () => {
  const root = join(process.cwd(), "sample-app");
  const context = await createContext({
    root,
    endpoints: [
      endpoint("catalog", "/api/catalog", {
        expectedContentType: "application/json",
        requiredJsonFields: ["count", "items"],
      }),
      endpoint("profile", "/api/profile", {
        expectedContentType: "application/json",
        requiredJsonFields: ["id", "displayName"],
      }),
      endpoint("public-feed", "/api/public-feed", {
        expectedContentType: "application/json",
        requiredJsonFields: ["items", "visibility"],
      }),
    ],
    reachability: reachable(),
    fetch: (input) => {
      const pathname = new URL(requestTarget(input)).pathname;
      if (pathname === "/api/catalog") {
        return Promise.resolve(
          Response.json({
            count: 1,
            items: [{ id: "service-1" }],
          }),
        );
      }
      if (pathname === "/api/profile") {
        return Promise.resolve(
          Response.json({
            id: "account-1",
            displayName: "Sample User",
          }),
        );
      }

      return Promise.resolve(
        Response.json({
          items: ["Maintenance window"],
          visibility: "public",
        }),
      );
    },
  });

  const live = await apiRuntimeContractCheck.run(
    context,
    new AbortController().signal,
  );

  assert.deepEqual(
    live.results.map((result) => result.status),
    ["Pass", "Fail", "Pass"],
  );
  assert.equal(live.results[1]?.severity, "High");
  assert.match(live.results[1]?.finding ?? "", /shallow OpenAPI shape/);
});

test("status, content type, invalid JSON, and latency cannot earn passes", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/status": {
          get: jsonOperation({}),
        },
        "/content": {
          get: jsonOperation({}),
        },
        "/json": {
          get: jsonOperation({}),
        },
        "/slow": {
          get: jsonOperation({}),
        },
      }),
    );
    const context = await createContext({
      root,
      endpoints: [
        endpoint("status", "/status", {
          expectedContentType: "application/json",
        }),
        endpoint("content", "/content", {
          expectedContentType: "application/json",
        }),
        endpoint("json", "/json", {
          expectedContentType: "application/json",
        }),
        endpoint("slow", "/slow", {
          expectedContentType: "application/json",
        }),
      ],
      latencyThresholdMs: 2,
      timeoutMs: 100,
      reachability: reachable(),
      fetch: async (input) => {
        const path = new URL(requestTarget(input)).pathname;
        if (path === "/status") {
          return new Response("{}", {
            status: 500,
            headers: {
              "content-type": "application/json",
            },
          });
        }
        if (path === "/content") {
          return new Response("{}", {
            headers: {
              "content-type": "text/plain",
            },
          });
        }
        if (path === "/json") {
          return new Response("{", {
            headers: {
              "content-type": "application/json",
            },
          });
        }

        await new Promise((resolveDelay) => {
          setTimeout(resolveDelay, 10);
        });
        return Response.json({});
      },
    });

    const live = await apiRuntimeContractCheck.run(
      context,
      new AbortController().signal,
    );

    assert.deepEqual(
      live.results.map((result) => result.status),
      ["Fail", "Fail", "Fail", "Warn"],
    );
    assert.equal(live.results[0]?.severity, "High");
    assert.equal(live.results[1]?.severity, "Medium");
    assert.equal(live.results[2]?.severity, "High");
    assert.equal(live.results[3]?.severity, "Medium");
  });
});

test("missing authentication, timeout, and transport failures stay isolated", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/auth": {
          get: jsonOperation({}),
        },
        "/timeout": {
          get: jsonOperation({}),
        },
        "/transport": {
          get: jsonOperation({}),
        },
      }),
    );
    let requests = 0;
    const context = await createContext({
      root,
      endpoints: [
        endpoint("auth", "/auth", {
          useAuthentication: true,
        }),
        endpoint("timeout", "/timeout"),
        endpoint("transport", "/transport"),
      ],
      authentication: {
        kind: "headers",
        headers: {
          Authorization: {
            env: "TARGET_AUTHORIZATION",
          },
        },
      },
      timeoutMs: 5,
      latencyThresholdMs: 1,
      reachability: reachable(),
      fetch: (input) => {
        requests += 1;
        const path = new URL(requestTarget(input)).pathname;
        return path === "/timeout"
          ? new Promise<Response>(() => undefined)
          : Promise.reject(new Error("transport canary"));
      },
    });

    const live = await apiRuntimeContractCheck.run(
      context,
      new AbortController().signal,
    );

    assert.equal(requests, 2);
    assert.deepEqual(
      live.results.map((result) => result.diagnosticCode),
      [
        "API_AUTHENTICATION_UNAVAILABLE",
        "API_ENDPOINT_TIMEOUT",
        "API_ENDPOINT_UNAVAILABLE",
      ],
    );
    assert.ok(live.results.every((result) => result.status === "Skipped"));
    assert.equal(live.incomplete, false);
    assert.equal(JSON.stringify(live).includes("transport canary"), false);
  });
});

test("authentication values are sent only as headers and never rendered", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/auth": {
          get: jsonOperation({}),
        },
      }),
    );
    const canary = "Bearer runtime-secret-canary";
    const context = await createContext({
      root,
      endpoints: [
        endpoint("auth", "/auth", {
          useAuthentication: true,
        }),
      ],
      authentication: {
        kind: "headers",
        headers: {
          Authorization: {
            env: "TARGET_AUTHORIZATION",
          },
        },
      },
      resolveEnvironmentReference: (name) =>
        name === "TARGET_AUTHORIZATION" ? canary : undefined,
      reachability: reachable(),
      fetch: (_input, init) => {
        assert.equal(new Headers(init?.headers).get("authorization"), canary);
        return Promise.resolve(Response.json({}));
      },
    });

    const live = await apiRuntimeContractCheck.run(
      context,
      new AbortController().signal,
    );

    assert.equal(live.results[0]?.status, "Pass");
    assert.equal(JSON.stringify(live).includes(canary), false);
  });
});

test("oversized responses and endpoint caps preserve bounded results", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/items/{id}": {
          get: jsonOperation({}),
        },
      }),
    );
    const endpoints = Array.from({ length: 13 }, (_, index) =>
      endpoint(`item-${index}`, `/items/${index}`, {
        expectedContentType: "application/json",
      }),
    );
    let requests = 0;
    const context = await createContext({
      root,
      endpoints,
      reachability: reachable(),
      fetch: () => {
        requests += 1;
        return Promise.resolve(
          new Response("{}", {
            headers: {
              "content-length": String(256 * 1024 + 1),
              "content-type": "application/json",
            },
          }),
        );
      },
    });

    const live = await apiRuntimeContractCheck.run(
      context,
      new AbortController().signal,
    );

    assert.equal(requests, 12);
    assert.equal(live.incomplete, true);
    assert.equal(
      live.results.at(-1)?.diagnosticCode,
      "API_ENDPOINT_LIMIT_REACHED",
    );
    assert.equal(
      live.results.filter(
        (result) => result.diagnosticCode === "API_RESPONSE_LIMIT_REACHED",
      ).length,
      12,
    );
    assert.ok(
      live.results
        .filter((result) => result.status === "Warn")
        .every(
          (result) =>
            result.status === "Warn" &&
            result.finding.includes("response body exceeded"),
        ),
    );
  });
});

test("the internal runtime deadline produces an incomplete coverage note", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/items": {
          get: jsonOperation({}),
        },
      }),
    );
    let requests = 0;
    const context = await createContext({
      root,
      endpoints: [endpoint("items", "/items")],
      reachability: reachable(),
      fetch: () => {
        requests += 1;
        return Promise.resolve(Response.json({}));
      },
    });
    const performanceSpy = vi
      .spyOn(performance, "now")
      .mockReturnValueOnce(0)
      .mockReturnValue(55_001);

    try {
      const live = await apiRuntimeContractCheck.run(
        context,
        new AbortController().signal,
      );

      assert.equal(requests, 0);
      assert.equal(live.incomplete, true);
      assert.equal(
        live.results[0]?.diagnosticCode,
        "API_RUNTIME_DEADLINE_REACHED",
      );
    } finally {
      performanceSpy.mockRestore();
    }
  });
});

test("invalid, unsupported, oversized, and symlinked contracts fail closed", async () => {
  await withTemporaryRepository(async (root) => {
    const outside = await mkdtemp(join(tmpdir(), "sentinel-api-outside-"));
    try {
      await writeFile(join(outside, "openapi.json"), openApiDocument({}));
      await symlink(outside, join(root, "linked"));

      const cases = [
        {
          file: "invalid.yaml",
          content: "openapi: [",
          diagnostic: "OPENAPI_INVALID",
          incomplete: false,
        },
        {
          file: "unsupported.json",
          content: openApiDocument({}, "2.0"),
          diagnostic: "OPENAPI_VERSION_UNSUPPORTED",
          incomplete: false,
        },
        {
          file: "large.json",
          content: `${openApiDocument({})}${" ".repeat(128 * 1024)}`,
          diagnostic: "OPENAPI_TOO_LARGE",
          incomplete: true,
        },
      ] as const;

      for (const fixture of cases) {
        await writeFile(join(root, fixture.file), fixture.content);
        const context = await createContext({
          root,
          endpoints: [],
          openApiPath: `./${fixture.file}`,
          reachability: unreachable(),
          fetch: () => Promise.reject(new Error("Unexpected request.")),
        });
        const fallback = await apiStaticOpenApiCheck.run(
          context,
          new AbortController().signal,
        );

        assert.equal(fallback.results[0]?.diagnosticCode, fixture.diagnostic);
        assert.equal(fallback.results[0]?.status === "Pass", false);
        assert.equal(fallback.incomplete, fixture.incomplete);
      }

      const symlinkContext = await createContext({
        root,
        endpoints: [],
        openApiPath: "./linked/openapi.json",
        reachability: unreachable(),
        fetch: () => Promise.reject(new Error("Unexpected request.")),
      });
      const symlinkFallback = await apiStaticOpenApiCheck.run(
        symlinkContext,
        new AbortController().signal,
      );
      assert.equal(
        symlinkFallback.results[0]?.diagnosticCode,
        "OPENAPI_MISSING",
      );
      assert.equal(JSON.stringify(symlinkFallback).includes(outside), false);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test("incomplete inventory cannot turn an existing contract into a missing-file claim", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(join(root, "a-first.txt"), "inventory fixture");
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/items": {
          get: jsonOperation({}),
        },
      }),
    );
    const incompleteRepository = await inspectRepository(root, {
      maxEntries: 1,
    });
    const endpoints = [endpoint("items", "/items")];
    const liveContext = await createContext({
      root,
      endpoints,
      reachability: reachable(),
      fetch: () => Promise.resolve(Response.json({})),
    });
    const staticContext = await createContext({
      root,
      endpoints,
      reachability: unreachable(),
      fetch: () => Promise.reject(new Error("Unexpected request.")),
    });

    const live = await apiRuntimeContractCheck.run(
      {
        ...liveContext,
        repository: incompleteRepository,
      },
      new AbortController().signal,
    );
    const fallback = await apiStaticOpenApiCheck.run(
      {
        ...staticContext,
        repository: incompleteRepository,
      },
      new AbortController().signal,
    );

    assert.equal(incompleteRepository.complete, false);
    assert.equal(live.incomplete, true);
    assert.equal(fallback.incomplete, true);
    assert.equal(
      live.results[0]?.diagnosticCode,
      "OPENAPI_INVENTORY_INCOMPLETE",
    );
    assert.equal(
      fallback.results[0]?.diagnosticCode,
      "OPENAPI_INVENTORY_INCOMPLETE",
    );
    assert.equal(live.results[0]?.status, "Skipped");
    assert.equal(fallback.results[0]?.status, "Skipped");
    assert.equal(
      JSON.stringify([live, fallback]).includes("OPENAPI_MISSING"),
      false,
    );
  });
});

test("a complete inventory preserves confirmed missing-contract behavior", async () => {
  await withTemporaryRepository(async (root) => {
    const context = await createContext({
      root,
      endpoints: [],
      openApiPath: "./missing.json",
      reachability: unreachable(),
      fetch: () => Promise.reject(new Error("Unexpected request.")),
    });

    const fallback = await apiStaticOpenApiCheck.run(
      context,
      new AbortController().signal,
    );

    assert.equal(context.repository.complete, true);
    assert.equal(fallback.incomplete, false);
    assert.equal(fallback.results[0]?.diagnosticCode, "OPENAPI_MISSING");
    assert.equal(fallback.results[0]?.status, "Warn");
  });
});

test("YAML 3.1 contracts parse and unsupported schema constructs never pass", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "openapi.yaml"),
      [
        "openapi: 3.1.0",
        "info:",
        "  title: Fixture",
        "  version: 1.0.0",
        "paths:",
        "  /items:",
        "    get:",
        "      responses:",
        "        '200':",
        "          description: Fixture",
        "          content:",
        "            application/json:",
        "              schema:",
        "                $ref: '#/components/schemas/Items'",
      ].join("\n"),
    );
    const context = await createContext({
      root,
      endpoints: [
        endpoint("items", "/items", {
          expectedContentType: "application/json",
          requiredJsonFields: ["items"],
        }),
      ],
      openApiPath: "./openapi.yaml",
      reachability: unreachable(),
      fetch: () => Promise.reject(new Error("Unexpected request.")),
    });

    const fallback = await apiStaticOpenApiCheck.run(
      context,
      new AbortController().signal,
    );

    assert.equal(fallback.results[0]?.status, "Warn");
    assert.equal(fallback.results[1]?.status, "Warn");
    assert.match(fallback.results[1]?.finding ?? "", /unsupported constructs/);

    const liveContext = await createContext({
      root,
      endpoints: [
        endpoint("items", "/items", {
          expectedContentType: "application/json",
          requiredJsonFields: ["items"],
        }),
      ],
      openApiPath: "./openapi.yaml",
      reachability: reachable(),
      fetch: () =>
        Promise.resolve(
          Response.json({
            items: [],
          }),
        ),
    });
    const live = await apiRuntimeContractCheck.run(
      liveContext,
      new AbortController().signal,
    );
    assert.equal(live.results[0]?.status, "Warn");
    assert.match(live.results[0]?.finding ?? "", /unsupported constructs/);
  });
});

test("static fallback rejects unsupported top-level and property schemas without false passes", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/top-level": {
          get: jsonOperation({
            schema: {
              $ref: "#/components/schemas/TopLevel",
            },
          }),
        },
        "/property": {
          get: jsonOperation({
            required: ["item"],
            properties: {
              item: {
                $ref: "#/components/schemas/Item",
              },
            },
          }),
        },
      }),
    );
    const context = await createContext({
      root,
      endpoints: [
        endpoint("top-level", "/top-level", {
          expectedContentType: "application/json",
        }),
        endpoint("property", "/property", {
          expectedContentType: "application/json",
          requiredJsonFields: ["item"],
        }),
      ],
      reachability: unreachable(),
      fetch: () => Promise.reject(new Error("Unexpected request.")),
    });

    const fallback = await apiStaticOpenApiCheck.run(
      context,
      new AbortController().signal,
    );

    assert.deepEqual(
      fallback.results.slice(1).map((result) => result.status),
      ["Warn", "Warn"],
    );
    assert.ok(
      fallback.results
        .slice(1)
        .every((result) => result.finding.includes("unsupported")),
    );
  });
});

test("malformed non-string schema references cannot earn live or static passes", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/top-level": {
          get: jsonOperation({
            schema: {
              $ref: 42,
              type: "object",
            },
          }),
        },
        "/property": {
          get: jsonOperation({
            required: ["item"],
            properties: {
              item: {
                $ref: 42,
                type: "string",
              },
            },
          }),
        },
      }),
    );
    const endpoints = [
      endpoint("top-level", "/top-level", {
        expectedContentType: "application/json",
      }),
      endpoint("property", "/property", {
        expectedContentType: "application/json",
        requiredJsonFields: ["item"],
      }),
    ];
    const liveContext = await createContext({
      root,
      endpoints,
      reachability: reachable(),
      fetch: (input) =>
        Promise.resolve(
          new URL(requestTarget(input)).pathname === "/property"
            ? Response.json({ item: "present" })
            : Response.json({}),
        ),
    });
    const staticContext = await createContext({
      root,
      endpoints,
      reachability: unreachable(),
      fetch: () => Promise.reject(new Error("Unexpected request.")),
    });

    const live = await apiRuntimeContractCheck.run(
      liveContext,
      new AbortController().signal,
    );
    const fallback = await apiStaticOpenApiCheck.run(
      staticContext,
      new AbortController().signal,
    );

    assert.ok(live.results.every((result) => result.status === "Warn"));
    assert.ok(fallback.results.every((result) => result.status === "Warn"));
    assert.ok(
      [...live.results, ...fallback.results].every((result) =>
        result.finding.includes("unsupported"),
      ),
    );
  });
});

test("response-level references cannot earn live or static passes", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/response-reference": {
          get: {
            responses: {
              "200": {
                $ref: "#/components/responses/Success",
              },
            },
          },
        },
      }),
    );
    const endpointConfig = endpoint(
      "response-reference",
      "/response-reference",
    );
    const liveContext = await createContext({
      root,
      endpoints: [endpointConfig],
      reachability: reachable(),
      fetch: () => Promise.resolve(Response.json({})),
    });
    const staticContext = await createContext({
      root,
      endpoints: [endpointConfig],
      reachability: unreachable(),
      fetch: () => Promise.reject(new Error("Unexpected request.")),
    });

    const live = await apiRuntimeContractCheck.run(
      liveContext,
      new AbortController().signal,
    );
    const fallback = await apiStaticOpenApiCheck.run(
      staticContext,
      new AbortController().signal,
    );

    assert.equal(live.results[0]?.status, "Warn");
    assert.match(live.results[0]?.finding ?? "", /unsupported constructs/);
    assert.deepEqual(
      fallback.results.map((result) => result.status),
      ["Warn", "Warn"],
    );
    assert.ok(
      fallback.results.every((result) =>
        result.finding.includes("unsupported"),
      ),
    );
  });
});

test("malformed response declarations cannot count as supported coverage", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/invalid-key": {
          get: {
            responses: {
              banana: {
                description: "Invalid status key",
              },
            },
          },
        },
        "/missing-description": {
          get: {
            responses: {
              "200": {
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                    },
                  },
                },
              },
            },
          },
        },
        "/non-object": {
          get: {
            responses: {
              "200": "invalid",
            },
          },
        },
      }),
    );
    const endpoints = [
      endpoint("invalid-key", "/invalid-key"),
      endpoint("missing-description", "/missing-description", {
        expectedContentType: "application/json",
      }),
      endpoint("non-object", "/non-object"),
    ];
    const liveContext = await createContext({
      root,
      endpoints,
      reachability: reachable(),
      fetch: () => Promise.resolve(Response.json({})),
    });
    const staticContext = await createContext({
      root,
      endpoints,
      reachability: unreachable(),
      fetch: () => Promise.reject(new Error("Unexpected request.")),
    });

    const live = await apiRuntimeContractCheck.run(
      liveContext,
      new AbortController().signal,
    );
    const fallback = await apiStaticOpenApiCheck.run(
      staticContext,
      new AbortController().signal,
    );

    assert.ok(live.results.every((result) => result.status !== "Pass"));
    assert.ok(fallback.results.every((result) => result.status !== "Pass"));
    assert.match(
      fallback.results[0]?.finding ?? "",
      /malformed or unsupported response declarations/,
    );
  });
});

test("malformed and unsupported media declarations cannot earn static passes", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/invalid-object": {
          get: {
            responses: {
              "200": {
                description: "Invalid media object",
                content: {
                  "text/plain": "invalid",
                },
              },
            },
          },
        },
        "/schema-reference": {
          get: {
            responses: {
              "200": {
                description: "Unsupported text schema",
                content: {
                  "text/plain": {
                    schema: {
                      $ref: "#/components/schemas/Text",
                    },
                  },
                },
              },
            },
          },
        },
        "/invalid-key": {
          get: {
            responses: {
              "200": {
                description: "Invalid media key",
                content: {
                  banana: {
                    schema: {
                      type: "string",
                    },
                  },
                },
              },
            },
          },
        },
        "/media-reference": {
          get: {
            responses: {
              "200": {
                description: "Unsupported media reference",
                content: {
                  "text/plain": {
                    $ref: "#/components/schemas/TextMedia",
                  },
                },
              },
            },
          },
        },
      }),
    );
    const endpoints = [
      endpoint("invalid-object", "/invalid-object"),
      endpoint("schema-reference", "/schema-reference"),
      endpoint("invalid-key", "/invalid-key"),
      endpoint("media-reference", "/media-reference"),
    ];
    const context = await createContext({
      root,
      endpoints,
      reachability: unreachable(),
      fetch: () => Promise.reject(new Error("Unexpected request.")),
    });

    const fallback = await apiStaticOpenApiCheck.run(
      context,
      new AbortController().signal,
    );

    assert.ok(fallback.results.every((result) => result.status !== "Pass"));
    assert.ok(
      fallback.results
        .slice(1)
        .every((result) => result.finding.includes("unsupported")),
    );
  });
});

test("live non-JSON and malformed media contracts cannot claim shape passes", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/plain-object": {
          get: {
            responses: {
              "200": {
                description: "Object payload",
                content: {
                  "text/plain": {
                    schema: {
                      type: "object",
                    },
                  },
                },
              },
            },
          },
        },
        "/invalid-key": {
          get: {
            responses: {
              "200": {
                description: "Invalid media key",
                content: {
                  banana: {
                    schema: {
                      type: "string",
                    },
                  },
                },
              },
            },
          },
        },
      }),
    );
    const context = await createContext({
      root,
      endpoints: [
        endpoint("plain-object", "/plain-object"),
        endpoint("invalid-key", "/invalid-key"),
      ],
      reachability: reachable(),
      fetch: (input) => {
        const pathname = new URL(requestTarget(input)).pathname;
        return Promise.resolve(
          new Response("not-an-object", {
            headers: {
              "content-type":
                pathname === "/invalid-key" ? "banana" : "text/plain",
            },
          }),
        );
      },
    });

    const live = await apiRuntimeContractCheck.run(
      context,
      new AbortController().signal,
    );

    assert.ok(
      live.results.every(
        (result) => result.status === "Warn" && result.severity === "Medium",
      ),
    );
    assert.match(live.results[0]?.finding ?? "", /non-JSON response schema/);
    assert.match(live.results[1]?.finding ?? "", /unsupported constructs/);
  });
});

test("media matching prefers exact, then type wildcard, then global wildcard", async () => {
  await withTemporaryRepository(async (root) => {
    const looseSchema = {
      type: "object",
      properties: {},
    };
    const requiredIdSchema = {
      type: "object",
      required: ["id"],
      properties: {
        id: {
          type: "string",
        },
      },
    };
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/exact": {
          get: {
            responses: {
              "200": {
                description: "Exact response",
                content: {
                  "*/*": {
                    schema: looseSchema,
                  },
                  "application/*": {
                    schema: looseSchema,
                  },
                  "application/json": {
                    schema: requiredIdSchema,
                  },
                },
              },
            },
          },
        },
        "/type-wildcard": {
          get: {
            responses: {
              "200": {
                description: "Type wildcard response",
                content: {
                  "*/*": {
                    schema: looseSchema,
                  },
                  "application/*": {
                    schema: requiredIdSchema,
                  },
                },
              },
            },
          },
        },
        "/static-exact": {
          get: {
            responses: {
              "200": {
                description: "Static exact response",
                content: {
                  "*/*": {
                    schema: looseSchema,
                  },
                  "application/json": {
                    schema: {
                      $ref: "#/components/schemas/Exact",
                    },
                  },
                },
              },
            },
          },
        },
      }),
    );
    const liveContext = await createContext({
      root,
      endpoints: [
        endpoint("exact", "/exact", {
          expectedContentType: "application/json",
        }),
        endpoint("type-wildcard", "/type-wildcard", {
          expectedContentType: "application/json",
        }),
      ],
      reachability: reachable(),
      fetch: () => Promise.resolve(Response.json({})),
    });
    const staticContext = await createContext({
      root,
      endpoints: [
        endpoint("static-exact", "/static-exact", {
          expectedContentType: "application/json",
        }),
      ],
      reachability: unreachable(),
      fetch: () => Promise.reject(new Error("Unexpected request.")),
    });

    const live = await apiRuntimeContractCheck.run(
      liveContext,
      new AbortController().signal,
    );
    const fallback = await apiStaticOpenApiCheck.run(
      staticContext,
      new AbortController().signal,
    );

    assert.ok(
      live.results.every(
        (result) => result.status === "Fail" && result.severity === "High",
      ),
    );
    assert.equal(fallback.results[1]?.status, "Warn");
    assert.match(fallback.results[1]?.finding ?? "", /unsupported constructs/);
  });
});

test("static required-field analysis is independent of media declaration order", async () => {
  await withTemporaryRepository(async (root) => {
    const representedShape = {
      type: "object",
      properties: {
        id: {
          type: "string",
        },
      },
    };
    const missingShape = {
      type: "object",
      properties: {},
    };
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/represented-first": {
          get: {
            responses: {
              "200": {
                description: "Multiple JSON representations",
                content: {
                  "application/json": {
                    schema: representedShape,
                  },
                  "application/problem+json": {
                    schema: missingShape,
                  },
                },
              },
            },
          },
        },
        "/missing-first": {
          get: {
            responses: {
              "200": {
                description: "Multiple JSON representations",
                content: {
                  "application/problem+json": {
                    schema: missingShape,
                  },
                  "application/json": {
                    schema: representedShape,
                  },
                },
              },
            },
          },
        },
      }),
    );
    const context = await createContext({
      root,
      endpoints: [
        endpoint("represented-first", "/represented-first", {
          requiredJsonFields: ["id"],
        }),
        endpoint("missing-first", "/missing-first", {
          requiredJsonFields: ["id"],
        }),
      ],
      reachability: unreachable(),
      fetch: () => Promise.reject(new Error("Unexpected request.")),
    });

    const fallback = await apiStaticOpenApiCheck.run(
      context,
      new AbortController().signal,
    );

    assert.deepEqual(
      fallback.results.slice(1).map((result) => result.status),
      ["Warn", "Warn"],
    );
    assert.ok(
      fallback.results
        .slice(1)
        .every((result) => result.finding.includes("not represented")),
    );
  });
});

test("valid response ranges and default declarations remain supported", async () => {
  await withTemporaryRepository(async (root) => {
    const response = {
      description: "Supported response",
      content: {
        "application/json": {
          schema: {
            type: "object",
          },
        },
      },
    };
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/range": {
          get: {
            responses: {
              "2XX": response,
            },
          },
        },
        "/default": {
          get: {
            responses: {
              default: response,
            },
          },
        },
      }),
    );
    const endpoints = [
      endpoint("range", "/range", {
        expectedContentType: "application/json",
      }),
      endpoint("default", "/default", {
        expectedContentType: "application/json",
        expectedStatus: 418,
      }),
    ];
    const liveContext = await createContext({
      root,
      endpoints,
      reachability: reachable(),
      fetch: (input) =>
        Promise.resolve(
          Response.json(
            {},
            {
              status:
                new URL(requestTarget(input)).pathname === "/default"
                  ? 418
                  : 200,
            },
          ),
        ),
    });
    const staticContext = await createContext({
      root,
      endpoints,
      reachability: unreachable(),
      fetch: () => Promise.reject(new Error("Unexpected request.")),
    });

    const live = await apiRuntimeContractCheck.run(
      liveContext,
      new AbortController().signal,
    );
    const fallback = await apiStaticOpenApiCheck.run(
      staticContext,
      new AbortController().signal,
    );

    assert.ok(live.results.every((result) => result.status === "Pass"));
    assert.ok(fallback.results.every((result) => result.status === "Pass"));
  });
});

test("static fallback reports configured status and content alignment gaps", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/items": {
          get: {
            responses: {
              "201": {
                description: "Fixture",
                content: {
                  "text/plain": {
                    schema: {
                      type: "string",
                    },
                  },
                },
              },
            },
          },
        },
      }),
    );
    const context = await createContext({
      root,
      endpoints: [
        endpoint("items", "/items", {
          expectedStatus: 200,
          expectedContentType: "application/json",
          requiredJsonFields: ["items"],
        }),
      ],
      reachability: unreachable(),
      fetch: () => Promise.reject(new Error("Unexpected request.")),
    });

    const fallback = await apiStaticOpenApiCheck.run(
      context,
      new AbortController().signal,
    );

    assert.equal(fallback.results[1]?.status, "Warn");
    assert.match(fallback.results[1]?.finding ?? "", /status/);
  });
});

test("an empty OpenAPI document cannot earn a static pass", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(join(root, "openapi.json"), openApiDocument({}));
    const context = await createContext({
      root,
      endpoints: [],
      reachability: unreachable(),
      fetch: () => Promise.reject(new Error("Unexpected request.")),
    });

    const fallback = await apiStaticOpenApiCheck.run(
      context,
      new AbortController().signal,
    );

    assert.equal(fallback.results[0]?.status, "Warn");
    assert.equal(fallback.results[0]?.severity, "Medium");
  });
});

test("a malformed supported operation prevents a document-level pass", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/valid": {
          get: jsonOperation({}),
        },
        "/malformed": {
          get: "not-an-operation",
        },
      }),
    );
    const context = await createContext({
      root,
      endpoints: [],
      reachability: unreachable(),
      fetch: () => Promise.reject(new Error("Unexpected request.")),
    });

    const fallback = await apiStaticOpenApiCheck.run(
      context,
      new AbortController().signal,
    );

    assert.equal(fallback.results.length, 1);
    assert.equal(fallback.results[0]?.status, "Warn");
    assert.equal(fallback.results[0]?.severity, "Medium");
    assert.match(fallback.results[0]?.finding ?? "", /without response/);
  });
});

test("a pre-aborted live API check never starts an endpoint request", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/items": {
          get: jsonOperation({}),
        },
      }),
    );
    let requests = 0;
    const context = await createContext({
      root,
      endpoints: [endpoint("items", "/items")],
      reachability: reachable(),
      fetch: () => {
        requests += 1;
        return Promise.resolve(Response.json({}));
      },
    });
    const controller = new AbortController();
    controller.abort();

    const live = await apiRuntimeContractCheck.run(context, controller.signal);

    assert.equal(requests, 0);
    assert.equal(live.results[0]?.status, "Skipped");
    assert.equal(live.results[0]?.diagnosticCode, "API_ENDPOINT_TIMEOUT");
  });
});

test("unsupported response schemas prevent a document coverage pass without configured endpoints", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/items": {
          get: jsonOperation({
            schema: {
              $ref: "#/components/schemas/Items",
            },
          }),
        },
      }),
    );
    const context = await createContext({
      root,
      endpoints: [],
      reachability: unreachable(),
      fetch: () => Promise.reject(new Error("Unexpected request.")),
    });

    const fallback = await apiStaticOpenApiCheck.run(
      context,
      new AbortController().signal,
    );

    assert.equal(fallback.results.length, 1);
    assert.equal(fallback.results[0]?.status, "Warn");
    assert.equal(fallback.results[0]?.severity, "Medium");
    assert.match(fallback.results[0]?.finding ?? "", /unsupported/);
  });
});

test("a post-probe endpoint failure never activates fallback", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "openapi.json"),
      openApiDocument({
        "/items": {
          get: jsonOperation({}),
        },
      }),
    );
    const context = await createContext({
      root,
      endpoints: [endpoint("items", "/items")],
      reachability: reachable(),
      fetch: () => Promise.reject(new Error("Service disappeared.")),
    });

    const live = await apiRuntimeContractCheck.run(
      context,
      new AbortController().signal,
    );
    const fallback = await apiStaticOpenApiCheck.run(
      context,
      new AbortController().signal,
    );

    assert.equal(live.results[0]?.diagnosticCode, "API_ENDPOINT_UNAVAILABLE");
    assert.equal(
      fallback.results[0]?.diagnosticCode,
      "API_FALLBACK_NOT_SELECTED",
    );
    assert.equal(
      [...live.results, ...fallback.results].some(
        (result) =>
          result.checkId === "api.openapi-fallback" &&
          result.status !== "Skipped",
      ),
      false,
    );
  });
});
