import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "vitest";

import { createClaudeTransport } from "../src/ai/claude.js";
import { createOpenAiTransport } from "../src/ai/openai.js";
import type { AiTransportRequest, FetchLike } from "../src/ai/provider.js";

const REQUEST: AiTransportRequest = {
  systemPrompt: "Return a finding.",
  userPrompt: "Synthetic evidence only.",
  jsonSchema: {
    type: "object",
    properties: {
      severity: {
        type: "string",
        enum: ["High", "Low"],
      },
    },
    required: ["severity"],
    additionalProperties: false,
  },
  maxOutputTokens: 512,
  timeoutMs: 100,
  maxResponseBytes: 64 * 1024,
};

function recordingFetch(responseBody: unknown): {
  readonly fetchImplementation: FetchLike;
  readonly calls: Array<{
    readonly input: string | URL | Request;
    readonly init?: RequestInit;
  }>;
} {
  const calls: Array<{
    input: string | URL | Request;
    init?: RequestInit;
  }> = [];

  return {
    calls,
    fetchImplementation: (input, init) => {
      calls.push({
        input,
        ...(init === undefined ? {} : { init }),
      });
      return Promise.resolve(
        new Response(JSON.stringify(responseBody), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      );
    },
  };
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }

  return input instanceof URL ? input.href : input.url;
}

function requestBody(init: RequestInit | undefined): string {
  if (typeof init?.body !== "string") {
    throw new TypeError("Expected a string request body.");
  }

  return init.body;
}

test("OpenAI transport sends one native structured-output request", async () => {
  const credential = randomUUID();
  const recording = recordingFetch({
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: '{"severity":"High"}',
        },
      },
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 20,
    },
  });
  const transport = createOpenAiTransport(
    credential,
    recording.fetchImplementation,
  );

  const outcome = await transport.generate(REQUEST);

  assert.equal(outcome.state, "available");
  assert.equal(recording.calls.length, 1);
  const call = recording.calls[0];
  assert.ok(call);
  assert.equal(
    requestUrl(call.input),
    "https://api.openai.com/v1/chat/completions",
  );
  const headers = new Headers(call.init?.headers);
  assert.equal(headers.get("authorization"), `Bearer ${credential}`);
  const bodyText = requestBody(call.init);
  const body = JSON.parse(bodyText) as Record<string, unknown>;
  assert.equal(body.model, "gpt-5.6-luna");
  assert.equal(body.max_completion_tokens, 512);
  assert.equal(bodyText.includes(credential), false);
  assert.deepEqual(
    (body.response_format as Record<string, unknown>).type,
    "json_schema",
  );
  assert.equal(
    (
      (body.response_format as Record<string, unknown>).json_schema as Record<
        string,
        unknown
      >
    ).strict,
    true,
  );
  if (outcome.state === "available") {
    assert.deepEqual(outcome.value, { severity: "High" });
    assert.equal(outcome.provenance.inputTokens, 100);
    assert.equal(outcome.provenance.outputTokens, 20);
  }
});

test("Claude transport sends one native structured-output request", async () => {
  const credential = randomUUID();
  const recording = recordingFetch({
    stop_reason: "end_turn",
    content: [
      {
        type: "text",
        text: '{"severity":"High"}',
      },
    ],
    usage: {
      input_tokens: 90,
      output_tokens: 18,
    },
  });
  const transport = createClaudeTransport(
    credential,
    recording.fetchImplementation,
  );

  const outcome = await transport.generate(REQUEST);

  assert.equal(outcome.state, "available");
  assert.equal(recording.calls.length, 1);
  const call = recording.calls[0];
  assert.ok(call);
  assert.equal(requestUrl(call.input), "https://api.anthropic.com/v1/messages");
  const headers = new Headers(call.init?.headers);
  assert.equal(headers.get("x-api-key"), credential);
  assert.equal(headers.get("anthropic-version"), "2023-06-01");
  const bodyText = requestBody(call.init);
  const body = JSON.parse(bodyText) as Record<string, unknown>;
  assert.equal(body.model, "claude-haiku-4-5");
  assert.equal(body.max_tokens, 512);
  assert.equal(bodyText.includes(credential), false);
  assert.equal(
    (
      (body.output_config as Record<string, unknown>).format as Record<
        string,
        unknown
      >
    ).type,
    "json_schema",
  );
  if (outcome.state === "available") {
    assert.deepEqual(outcome.value, { severity: "High" });
    assert.equal(outcome.provenance.inputTokens, 90);
    assert.equal(outcome.provenance.outputTokens, 18);
  }
});

test("transports classify refusal and output truncation", async () => {
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

  const refusal = await createOpenAiTransport(
    randomUUID(),
    openAiRecording.fetchImplementation,
  ).generate(REQUEST);
  const truncation = await createClaudeTransport(
    randomUUID(),
    claudeRecording.fetchImplementation,
  ).generate(REQUEST);

  assert.deepEqual(refusal, {
    state: "unavailable",
    diagnosticCode: "AI_PROVIDER_REFUSAL",
  });
  assert.deepEqual(truncation, {
    state: "unavailable",
    diagnosticCode: "AI_PROVIDER_TRUNCATED",
  });
});

test("HTTP failures remain provider errors while malformed envelopes fail closed", async () => {
  const failedFetch: FetchLike = () =>
    Promise.resolve(
      new Response("", {
        status: 429,
      }),
    );
  const malformed = recordingFetch({
    unexpected: true,
  });

  const httpFailure = await createOpenAiTransport(
    randomUUID(),
    failedFetch,
  ).generate(REQUEST);
  const envelopeFailure = await createClaudeTransport(
    randomUUID(),
    malformed.fetchImplementation,
  ).generate(REQUEST);

  assert.deepEqual(httpFailure, {
    state: "unavailable",
    diagnosticCode: "AI_PROVIDER_ERROR",
  });
  assert.deepEqual(envelopeFailure, {
    state: "unavailable",
    diagnosticCode: "AI_RESPONSE_UNRECOGNIZED",
  });
});

test("unrecognized completion states, blocks, JSON, and usage fail closed", async () => {
  const responses: ReadonlyArray<{
    readonly provider: "openai" | "claude";
    readonly body: unknown;
  }> = [
    {
      provider: "openai",
      body: {
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: '{"severity":"High"}',
            },
          },
        ],
      },
    },
    {
      provider: "openai",
      body: {
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: '```json\n{"severity":"High"}\n```',
            },
          },
        ],
      },
    },
    {
      provider: "openai",
      body: {
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: '{"severity":"High"}',
            },
          },
        ],
        usage: {
          prompt_tokens: "100",
          completion_tokens: 20,
        },
      },
    },
    {
      provider: "claude",
      body: {
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text: '{"severity":"High"}',
          },
          {
            type: "text",
            text: '{"severity":"Low"}',
          },
        ],
      },
    },
    {
      provider: "claude",
      body: {
        stop_reason: "pause_turn",
        content: [
          {
            type: "text",
            text: '{"severity":"High"}',
          },
        ],
      },
    },
  ];

  for (const response of responses) {
    const recording = recordingFetch(response.body);
    const transport =
      response.provider === "openai"
        ? createOpenAiTransport(randomUUID(), recording.fetchImplementation)
        : createClaudeTransport(randomUUID(), recording.fetchImplementation);

    const outcome = await transport.generate(REQUEST);
    assert.deepEqual(outcome, {
      state: "unavailable",
      diagnosticCode: "AI_RESPONSE_UNRECOGNIZED",
    });
  }
});

test("provider timeout remains hard when fetch ignores abort without retrying", async () => {
  let calls = 0;
  const blockingFetch: FetchLike = async () => {
    calls += 1;
    return await new Promise<Response>(() => undefined);
  };
  const transport = createOpenAiTransport(randomUUID(), blockingFetch);

  const outcome = await transport.generate({
    ...REQUEST,
    timeoutMs: 1,
  });

  assert.equal(calls, 1);
  assert.deepEqual(outcome, {
    state: "unavailable",
    diagnosticCode: "AI_PROVIDER_TIMEOUT",
  });
});

test("transports reject non-JSON and oversized response bodies", async () => {
  const nonJsonFetch: FetchLike = () =>
    Promise.resolve(
      new Response('{"choices":[]}', {
        status: 200,
        headers: {
          "content-type": "text/plain",
        },
      }),
    );
  const oversized = recordingFetch({
    padding: "x".repeat(256),
  });

  const wrongContentType = await createOpenAiTransport(
    randomUUID(),
    nonJsonFetch,
  ).generate(REQUEST);
  const oversizedBody = await createOpenAiTransport(
    randomUUID(),
    oversized.fetchImplementation,
  ).generate({
    ...REQUEST,
    maxResponseBytes: 32,
  });

  for (const outcome of [wrongContentType, oversizedBody]) {
    assert.deepEqual(outcome, {
      state: "unavailable",
      diagnosticCode: "AI_RESPONSE_UNRECOGNIZED",
    });
  }
});
