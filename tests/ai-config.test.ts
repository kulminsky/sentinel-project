import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "vitest";

import { resolveAiSetup } from "../src/ai/config.js";
import type { FetchLike } from "../src/ai/provider.js";

const unreachableFetch: FetchLike = () =>
  Promise.reject(new Error("Tests must not call an external API."));

test("AI remains disabled unless it is explicitly enabled", () => {
  const setup = resolveAiSetup(
    {
      SENTINEL_AI_PROVIDER: "openai",
      OPENAI_API_KEY: randomUUID(),
    },
    unreachableFetch,
  );

  assert.equal(setup.kind, "skipped");
  if (setup.kind === "skipped") {
    assert.equal(setup.diagnosticCode, "AI_DISABLED");
  }
});

test("AI enablement normalization preserves exact opt-in behavior", () => {
  const explicitFalse = resolveAiSetup(
    {
      SENTINEL_AI_ENABLED: "false",
      SENTINEL_AI_PROVIDER: "openai",
      OPENAI_API_KEY: randomUUID(),
    },
    unreachableFetch,
  );
  const unsupportedCasing = resolveAiSetup(
    {
      SENTINEL_AI_ENABLED: "TRUE",
      SENTINEL_AI_PROVIDER: "openai",
      OPENAI_API_KEY: randomUUID(),
    },
    unreachableFetch,
  );

  assert.equal(explicitFalse.kind, "skipped");
  assert.equal(unsupportedCasing.kind, "skipped");
  if (
    explicitFalse.kind === "skipped" &&
    unsupportedCasing.kind === "skipped"
  ) {
    assert.equal(explicitFalse.diagnosticCode, "AI_DISABLED");
    assert.equal(unsupportedCasing.diagnosticCode, "AI_DISABLED");
  }
});

test("enabled AI requires an explicit supported provider", () => {
  const missing = resolveAiSetup(
    {
      SENTINEL_AI_ENABLED: "true",
    },
    unreachableFetch,
  );
  const unsupported = resolveAiSetup(
    {
      SENTINEL_AI_ENABLED: "true",
      SENTINEL_AI_PROVIDER: "OPENAI",
    },
    unreachableFetch,
  );

  assert.equal(missing.kind, "skipped");
  assert.equal(unsupported.kind, "skipped");
  if (missing.kind === "skipped" && unsupported.kind === "skipped") {
    assert.equal(missing.diagnosticCode, "AI_PROVIDER_NOT_SELECTED");
    assert.equal(unsupported.diagnosticCode, "AI_PROVIDER_UNSUPPORTED");
  }
});

test("each provider requires only its own credential", () => {
  const openAi = resolveAiSetup(
    {
      SENTINEL_AI_ENABLED: "true",
      SENTINEL_AI_PROVIDER: "openai",
      ANTHROPIC_API_KEY: randomUUID(),
    },
    unreachableFetch,
  );
  const claude = resolveAiSetup(
    {
      SENTINEL_AI_ENABLED: "true",
      SENTINEL_AI_PROVIDER: "claude",
      OPENAI_API_KEY: randomUUID(),
    },
    unreachableFetch,
  );

  assert.equal(openAi.kind, "skipped");
  assert.equal(claude.kind, "skipped");
  if (openAi.kind === "skipped" && claude.kind === "skipped") {
    assert.equal(openAi.diagnosticCode, "AI_CREDENTIAL_MISSING");
    assert.equal(claude.diagnosticCode, "AI_CREDENTIAL_MISSING");
  }
});

test("OpenAI and Claude can each be selected explicitly", () => {
  const openAi = resolveAiSetup(
    {
      SENTINEL_AI_ENABLED: "true",
      SENTINEL_AI_PROVIDER: "openai",
      OPENAI_API_KEY: randomUUID(),
    },
    unreachableFetch,
  );
  const claude = resolveAiSetup(
    {
      SENTINEL_AI_ENABLED: "true",
      SENTINEL_AI_PROVIDER: "claude",
      ANTHROPIC_API_KEY: randomUUID(),
    },
    unreachableFetch,
  );

  assert.equal(openAi.kind, "ready");
  assert.equal(claude.kind, "ready");
  if (openAi.kind === "ready" && claude.kind === "ready") {
    assert.equal(openAi.provider.name, "openai");
    assert.equal(claude.provider.name, "claude");
  }
});
