import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test, vi } from "vitest";

import { createSentinelConfigSchema } from "../src/config/schema.js";
import type { FetchLike } from "../src/core/check.js";
import { probeConfiguredServices } from "../src/runtime/reachability.js";
import { scanProject } from "../src/scan.js";

afterEach(() => {
  vi.useRealTimers();
});

function runtimeConfig(directory: string, timeoutMs = 100) {
  return createSentinelConfigSchema(directory).parse({
    target: {
      root: directory,
    },
    api: {
      baseUrl: "https://api.example.test:8443",
      healthPath: "/health",
      openApiPath: "./openapi.json",
      timeoutMs,
      latencyThresholdMs: Math.min(timeoutMs, 50),
      endpoints: [],
    },
    ui: {
      baseUrl: "https://ui.example.test",
      timeoutMs,
      pages: [],
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
    },
  });
}

function requestTarget(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }

  return input instanceof URL ? input.href : input.url;
}

test("missing runtime configuration performs no reachability requests", async () => {
  const config = createSentinelConfigSchema(process.cwd()).parse({});
  let requestCount = 0;

  const reachability = await probeConfiguredServices(config, () => {
    requestCount += 1;
    return Promise.reject(new Error("Unexpected fetch."));
  });

  assert.equal(requestCount, 0);
  assert.deepEqual(reachability, {
    api: {
      state: "not-configured",
    },
    ui: {
      state: "not-configured",
    },
  });
});

test("configured API and UI are probed once each and any HTTP status is reachable", async () => {
  const calls: Array<{ target: string; method: string | undefined }> = [];
  let releaseResponses: (() => void) | undefined;
  const responsesReleased = new Promise<void>((resolve) => {
    releaseResponses = resolve;
  });
  const fetchImplementation: FetchLike = async (input, init) => {
    const target = requestTarget(input);
    calls.push({
      target,
      method: init?.method,
    });
    if (calls.length === 2) {
      releaseResponses?.();
    }
    await responsesReleased;
    return new Response(null, {
      status: target.includes("api.example.test") ? 500 : 401,
    });
  };

  const reachability = await probeConfiguredServices(
    runtimeConfig(process.cwd()),
    fetchImplementation,
  );

  assert.equal(calls.length, 2);
  assert.ok(
    calls.some(
      (call) =>
        call.target === "https://api.example.test:8443/health" &&
        call.method === "HEAD",
    ),
  );
  assert.ok(
    calls.some(
      (call) =>
        call.target === "https://ui.example.test/" && call.method === "HEAD",
    ),
  );
  assert.equal(reachability.api.state, "reachable");
  assert.equal(reachability.ui.state, "reachable");
  if (
    reachability.api.state === "reachable" &&
    reachability.ui.state === "reachable"
  ) {
    assert.equal(reachability.api.statusCode, 500);
    assert.equal(reachability.ui.statusCode, 401);
  }
});

test("connection refusal and other transport failures become unavailable observations", async () => {
  const fetchImplementation: FetchLike = (input) => {
    if (requestTarget(input).includes("api.example.test")) {
      return Promise.reject(new Error("Connection refused."));
    }

    return Promise.reject(new Error("DNS lookup failed."));
  };

  const reachability = await probeConfiguredServices(
    runtimeConfig(process.cwd()),
    fetchImplementation,
  );

  assert.equal(reachability.api.state, "unreachable");
  assert.equal(reachability.ui.state, "unreachable");
  if (
    reachability.api.state === "unreachable" &&
    reachability.ui.state === "unreachable"
  ) {
    assert.equal(reachability.api.reason, "network-error");
    assert.equal(reachability.ui.reason, "network-error");
    assert.ok(reachability.api.durationMs >= 0);
    assert.ok(reachability.ui.durationMs >= 0);
  }
});

test("malformed fetch responses become unavailable observations", async () => {
  const reachability = await probeConfiguredServices(
    runtimeConfig(process.cwd()),
    () =>
      Promise.resolve({
        status: "invalid",
      } as unknown as Response),
  );

  assert.equal(reachability.api.state, "unreachable");
  assert.equal(reachability.ui.state, "unreachable");
  if (
    reachability.api.state === "unreachable" &&
    reachability.ui.state === "unreachable"
  ) {
    assert.equal(reachability.api.reason, "network-error");
    assert.equal(reachability.ui.reason, "network-error");
  }
});

test("reachability timeouts abort requests and return unavailable observations", async () => {
  vi.useFakeTimers();
  let abortedRequests = 0;
  const fetchImplementation: FetchLike = (_input, init) =>
    new Promise<Response>(() => {
      init?.signal?.addEventListener("abort", () => {
        abortedRequests += 1;
      });
    });

  const reachabilityPromise = probeConfiguredServices(
    runtimeConfig(process.cwd(), 10),
    fetchImplementation,
  );
  await vi.advanceTimersByTimeAsync(11);
  const reachability = await reachabilityPromise;

  assert.equal(abortedRequests, 2);
  assert.equal(reachability.api.state, "unreachable");
  assert.equal(reachability.ui.state, "unreachable");
  if (
    reachability.api.state === "unreachable" &&
    reachability.ui.state === "unreachable"
  ) {
    assert.equal(reachability.api.reason, "timeout");
    assert.equal(reachability.ui.reason, "timeout");
  }
});

test("unreachable services produce report notes without making the scan incomplete", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sentinel-runtime-test-"));
  try {
    await writeFile(
      join(directory, "README.md"),
      "# Runtime fixture\n",
      "utf8",
    );
    let requestCount = 0;
    const report = await scanProject(runtimeConfig(directory), {
      fetch: () => {
        requestCount += 1;
        return Promise.reject(new Error("Service unavailable."));
      },
    });

    assert.equal(requestCount, 2);
    assert.equal(report.overallSummary.scanStatus, "Complete");
    const apiResult = report.results.find(
      (result) => result.checkId === "api.service-availability",
    );
    const uiResult = report.results.find(
      (result) => result.checkId === "ui.service-availability",
    );
    assert.equal(apiResult?.status, "Skipped");
    assert.equal(apiResult?.severity, "Info");
    assert.equal(apiResult?.diagnosticCode, "SERVICE_UNREACHABLE");
    assert.equal(uiResult?.status, "Skipped");
    assert.equal(uiResult?.severity, "Info");
    assert.equal(uiResult?.diagnosticCode, "SERVICE_UNREACHABLE");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
