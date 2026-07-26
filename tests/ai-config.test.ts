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
      enabled: false,
      provider: "openai",
    },
    () => randomUUID(),
    unreachableFetch,
  );

  assert.equal(setup.kind, "skipped");
  if (setup.kind === "skipped") {
    assert.equal(setup.diagnosticCode, "AI_DISABLED");
  }
});

test("each provider requires only its own credential", () => {
  const credentials = new Map([
    ["OPENAI_API_KEY", undefined],
    ["ANTHROPIC_API_KEY", undefined],
  ]);
  const openAi = resolveAiSetup(
    {
      enabled: true,
      provider: "openai",
    },
    (name) => credentials.get(name),
    unreachableFetch,
  );
  const claude = resolveAiSetup(
    {
      enabled: true,
      provider: "claude",
    },
    (name) => credentials.get(name),
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
  const credentials = new Map([
    ["OPENAI_API_KEY", randomUUID()],
    ["ANTHROPIC_API_KEY", randomUUID()],
  ]);
  const openAi = resolveAiSetup(
    {
      enabled: true,
      provider: "openai",
    },
    (name) => credentials.get(name),
    unreachableFetch,
  );
  const claude = resolveAiSetup(
    {
      enabled: true,
      provider: "claude",
    },
    (name) => credentials.get(name),
    unreachableFetch,
  );

  assert.equal(openAi.kind, "ready");
  assert.equal(claude.kind, "ready");
  if (openAi.kind === "ready" && claude.kind === "ready") {
    assert.equal(openAi.provider.name, "openai");
    assert.equal(claude.provider.name, "claude");
  }
});
