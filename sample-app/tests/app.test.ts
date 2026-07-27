import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

import { createApp } from "../src/app.js";

let server: Server | undefined;
let baseUrl = "";

function requireServer(): Server {
  assert(server !== undefined);
  return server;
}

function requireRecord(
  value: unknown,
): asserts value is Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
}

async function readJson(path: string): Promise<{
  body: Record<string, unknown>;
  response: Response;
}> {
  const response = await fetch(`${baseUrl}${path}`);
  const body: unknown = await response.json();
  requireRecord(body);
  return { body, response };
}

before(async () => {
  server = await new Promise<Server>((resolve, reject) => {
    const candidate = createApp().listen(0, "127.0.0.1", () => {
      resolve(candidate);
    });

    candidate.once("error", reject);
  });

  const address = server.address();
  assert(address !== null);
  assert.notEqual(typeof address, "string");

  baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
});

after(async () => {
  const activeServer = requireServer();

  await new Promise<void>((resolve, reject) => {
    activeServer.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }

      reject(error);
    });
  });
});

void test("serves correct health and catalog responses", async () => {
  const health = await readJson("/health");
  assert.equal(health.response.status, 200);
  assert.deepEqual(health.body, { status: "ok" });

  const catalog = await readJson("/api/catalog");
  assert.equal(catalog.response.status, 200);
  assert.equal(catalog.body.count, 2);
  assert.ok(Array.isArray(catalog.body.items));

  const healthHead = await fetch(`${baseUrl}/health`, { method: "HEAD" });
  const uiHead = await fetch(baseUrl, { method: "HEAD" });
  assert.equal(healthHead.status, 200);
  assert.equal(uiHead.status, 200);
});

void test("preserves the deliberate profile contract drift", async () => {
  const contractResponse = await fetch(`${baseUrl}/openapi.json`);
  assert.equal(contractResponse.status, 200);

  const contract = await contractResponse.text();
  assert.match(
    contract,
    /"required":\s*\[\s*"id",\s*"displayName",\s*"plan"\s*\]/,
  );

  const profile = await readJson("/api/profile");
  assert.equal(profile.response.status, 200);
  assert.equal(profile.body.id, "account-demo");
  assert.equal(profile.body.displayName, "Demo Operator");
  assert.equal(Object.hasOwn(profile.body, "plan"), false);
});

void test("preserves the deliberate slow endpoint", async () => {
  const startedAt = performance.now();
  const result = await readJson("/api/slow");
  const durationMs = performance.now() - startedAt;

  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, { status: "complete" });
  assert.ok(
    durationMs >= 650,
    `Expected at least 650 ms but observed ${String(durationMs)} ms.`,
  );
});

void test("keeps debug output deterministic and secret-free", async () => {
  const secretMarker = `sample-secret-${Date.now().toString()}`;
  process.env.SENTINEL_SAMPLE_TEST_SECRET = secretMarker;

  try {
    const debug = await readJson("/debug/config");
    const serialized = JSON.stringify(debug.body);

    assert.equal(debug.response.status, 200);
    assert.equal(debug.body.mode, "debug");
    assert.equal(serialized.includes(secretMarker), false);
    assert.equal(serialized.includes("SENTINEL_SAMPLE_TEST_SECRET"), false);
  } finally {
    delete process.env.SENTINEL_SAMPLE_TEST_SECRET;
  }
});

void test("omits security headers and scopes wildcard CORS to one route", async () => {
  const catalogResponse = await fetch(`${baseUrl}/api/catalog`);

  assert.equal(catalogResponse.headers.get("content-security-policy"), null);
  assert.equal(catalogResponse.headers.get("x-content-type-options"), null);
  assert.equal(catalogResponse.headers.get("referrer-policy"), null);
  assert.equal(
    catalogResponse.headers.get("access-control-allow-origin"),
    null,
  );

  const publicFeedResponse = await fetch(`${baseUrl}/api/public-feed`);
  assert.equal(publicFeedResponse.status, 200);
  assert.equal(
    publicFeedResponse.headers.get("access-control-allow-origin"),
    "*",
  );

  const healthResponse = await fetch(`${baseUrl}/health`);
  assert.equal(healthResponse.headers.get("access-control-allow-origin"), null);
});

void test("serves the functional frontend with its deliberate UI findings", async () => {
  const homeResponse = await fetch(baseUrl);
  const html = await homeResponse.text();

  assert.equal(homeResponse.status, 200);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /src="\/assets\/sentinel-mark\.svg"/);
  assert.match(html, /src="\/assets\/missing-product\.png"/);
  assert.match(html, /alt="A preview of the Northstar monitoring dashboard"/);
  assert.doesNotMatch(html, /<label[^>]*for="email"/);

  const input = html.match(/<input[\s\S]*?id="email"[\s\S]*?\/>/)?.[0];
  assert.notEqual(input, undefined);
  assert.doesNotMatch(input ?? "", /aria-label(?:ledby)?=/);
  assert.doesNotMatch(input ?? "", /placeholder=/);

  const validAsset = await fetch(`${baseUrl}/assets/sentinel-mark.svg`);
  const missingAsset = await fetch(`${baseUrl}/assets/missing-product.png`);
  assert.equal(validAsset.status, 200);
  assert.equal(missingAsset.status, 404);

  const scriptResponse = await fetch(`${baseUrl}/app.js`);
  const script = await scriptResponse.text();
  assert.equal(scriptResponse.status, 200);
  assert.match(script, /console\.error/);
  assert.match(script, /Thanks for subscribing\./);
});
