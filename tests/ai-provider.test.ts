import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createClaudeProvider } from "../src/ai/claude.js";
import { createOpenAiProvider } from "../src/ai/openai.js";
import type {
  AiStructuredRequest,
  FetchLike,
} from "../src/ai/provider.js";

const REQUEST: AiStructuredRequest = {
  systemPrompt: "Return a finding.",
  userPrompt: "Synthetic evidence only.",
  schema: {
    type: "object",
    additionalProperties: false,
  },
  maxOutputTokens: 512,
  timeoutMs: 100,
  maxResponseBytes: 64 * 1024,
};

function recordingFetch(
  responseBody: Readonly<Record<string, unknown>>,
): {
  fetchImplementation: FetchLike;
  calls: Array<{ input: string | URL | Request; init?: RequestInit }>;
} {
  const calls: Array<{
    input: string | URL | Request;
    init?: RequestInit;
  }> = [];

  return {
    calls,
    fetchImplementation: async (input, init) => {
      calls.push({
        input,
        ...(init === undefined ? {} : { init }),
      });
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    },
  };
}

test("OpenAI adapter sends one bounded structured-output request", async () => {
  const credential = randomUUID();
  const recording = recordingFetch({
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: "{\"severity\":\"High\"}",
        },
      },
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 20,
    },
  });
  const provider = createOpenAiProvider(
    credential,
    recording.fetchImplementation,
  );

  const outcome = await provider.analyze(REQUEST);

  assert.equal(outcome.ok, true);
  assert.equal(recording.calls.length, 1);
  const call = recording.calls[0];
  assert.ok(call);
  assert.equal(String(call.input), "https://api.openai.com/v1/chat/completions");
  const headers = new Headers(call.init?.headers);
  assert.equal(headers.get("authorization"), `Bearer ${credential}`);
  const bodyText = String(call.init?.body);
  const body = JSON.parse(bodyText) as Record<string, unknown>;
  assert.equal(body.model, "gpt-5.6-luna");
  assert.equal(body.max_completion_tokens, 512);
  assert.equal(bodyText.includes(credential), false);
  assert.deepEqual(
    (body.response_format as Record<string, unknown>).type,
    "json_schema",
  );
  if (outcome.ok) {
    assert.equal(outcome.response.inputTokens, 100);
    assert.equal(outcome.response.outputTokens, 20);
  }
});

test("Claude adapter sends one bounded structured-output request", async () => {
  const credential = randomUUID();
  const recording = recordingFetch({
    stop_reason: "end_turn",
    content: [
      {
        type: "text",
        text: "{\"severity\":\"High\"}",
      },
    ],
    usage: {
      input_tokens: 90,
      output_tokens: 18,
    },
  });
  const provider = createClaudeProvider(
    credential,
    recording.fetchImplementation,
  );

  const outcome = await provider.analyze(REQUEST);

  assert.equal(outcome.ok, true);
  assert.equal(recording.calls.length, 1);
  const call = recording.calls[0];
  assert.ok(call);
  assert.equal(String(call.input), "https://api.anthropic.com/v1/messages");
  const headers = new Headers(call.init?.headers);
  assert.equal(headers.get("x-api-key"), credential);
  assert.equal(headers.get("anthropic-version"), "2023-06-01");
  const bodyText = String(call.init?.body);
  const body = JSON.parse(bodyText) as Record<string, unknown>;
  assert.equal(body.model, "claude-haiku-4-5");
  assert.equal(body.max_tokens, 512);
  assert.equal(bodyText.includes(credential), false);
  assert.equal(
    (
      ((body.output_config as Record<string, unknown>)
        .format as Record<string, unknown>)
    ).type,
    "json_schema",
  );
  if (outcome.ok) {
    assert.equal(outcome.response.inputTokens, 90);
    assert.equal(outcome.response.outputTokens, 18);
  }
});

test("provider adapters classify refusal and output truncation", async () => {
  const openAiRecording = recordingFetch({
    choices: [
      {
        finish_reason: "content_filter",
        message: {
          refusal: "declined",
        },
      },
    ],
  });
  const claudeRecording = recordingFetch({
    stop_reason: "max_tokens",
    content: [],
  });

  const refusal = await createOpenAiProvider(
    randomUUID(),
    openAiRecording.fetchImplementation,
  ).analyze(REQUEST);
  const truncation = await createClaudeProvider(
    randomUUID(),
    claudeRecording.fetchImplementation,
  ).analyze(REQUEST);

  assert.deepEqual(refusal, {
    ok: false,
    diagnosticCode: "AI_PROVIDER_REFUSAL",
  });
  assert.deepEqual(truncation, {
    ok: false,
    diagnosticCode: "AI_PROVIDER_TRUNCATED",
  });
});

test("provider adapters isolate HTTP and malformed envelope failures", async () => {
  const failedFetch: FetchLike = async () =>
    new Response("", {
      status: 429,
    });
  const malformed = recordingFetch({
    unexpected: true,
  });

  const httpFailure = await createOpenAiProvider(
    randomUUID(),
    failedFetch,
  ).analyze(REQUEST);
  const envelopeFailure = await createClaudeProvider(
    randomUUID(),
    malformed.fetchImplementation,
  ).analyze(REQUEST);

  assert.deepEqual(httpFailure, {
    ok: false,
    diagnosticCode: "AI_PROVIDER_ERROR",
  });
  assert.deepEqual(envelopeFailure, {
    ok: false,
    diagnosticCode: "AI_PROVIDER_ERROR",
  });
});

test("provider timeout aborts the request without retrying", async () => {
  let calls = 0;
  const blockingFetch: FetchLike = async (_input, init) => {
    calls += 1;
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new Error("aborted")),
        { once: true },
      );
    });
  };
  const provider = createOpenAiProvider(randomUUID(), blockingFetch);

  const outcome = await provider.analyze({
    ...REQUEST,
    timeoutMs: 1,
  });

  assert.equal(calls, 1);
  assert.deepEqual(outcome, {
    ok: false,
    diagnosticCode: "AI_PROVIDER_TIMEOUT",
  });
});

test("provider adapters reject response bodies above the accepted limit", async () => {
  const recording = recordingFetch({
    padding: "x".repeat(256),
  });
  const provider = createOpenAiProvider(
    randomUUID(),
    recording.fetchImplementation,
  );

  const outcome = await provider.analyze({
    ...REQUEST,
    maxResponseBytes: 32,
  });

  assert.deepEqual(outcome, {
    ok: false,
    diagnosticCode: "AI_PROVIDER_ERROR",
  });
});
