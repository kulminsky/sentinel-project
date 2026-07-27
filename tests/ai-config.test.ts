import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "vitest";
import { z } from "zod";

import { createAiRuntime, resolveAiSetup } from "../src/ai/config.js";
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
    assert.equal(typeof openAi.createClient, "function");
    assert.equal(typeof claude.createClient, "function");
    assert.equal("provider" in openAi, false);
    assert.equal("provider" in claude, false);
  }
});

test("only the explicitly selected provider receives a request", async () => {
  const credentials = new Map([
    ["OPENAI_API_KEY", randomUUID()],
    ["ANTHROPIC_API_KEY", randomUUID()],
  ]);
  const calls: string[] = [];
  const fetchImplementation: FetchLike = (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    calls.push(url);
    return Promise.resolve(
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: '{"result":"ok"}',
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );
  };
  const setup = resolveAiSetup(
    {
      enabled: true,
      provider: "openai",
    },
    (name) => credentials.get(name),
    fetchImplementation,
  );
  const runtime = createAiRuntime(setup);
  assert.equal(runtime.kind, "ready");
  if (runtime.kind !== "ready") {
    return;
  }

  const outcome = await runtime.client.generate({
    systemPrompt: "Return a result.",
    userPrompt: "Synthetic evidence.",
    outputSchema: z.strictObject({
      result: z.literal("ok"),
    }),
  });

  assert.equal(outcome.state, "available");
  assert.deepEqual(calls, ["https://api.openai.com/v1/chat/completions"]);
});
