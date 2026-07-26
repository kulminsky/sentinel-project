import {
  postJson,
  readTokenCount,
  type AiProvider,
  type AiProviderOutcome,
  type FetchLike,
} from "./provider.js";

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-5.6-luna";

function readOpenAiOutcome(body: unknown): AiProviderOutcome {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      ok: false,
      diagnosticCode: "AI_PROVIDER_ERROR",
    };
  }

  const response = body as Record<string, unknown>;
  const choices = response.choices;
  const usage =
    typeof response.usage === "object" &&
    response.usage !== null &&
    !Array.isArray(response.usage)
      ? (response.usage as Record<string, unknown>)
      : undefined;

  if (!Array.isArray(choices) || choices.length !== 1) {
    return {
      ok: false,
      diagnosticCode: "AI_PROVIDER_ERROR",
    };
  }

  const choice = choices[0];
  if (typeof choice !== "object" || choice === null || Array.isArray(choice)) {
    return {
      ok: false,
      diagnosticCode: "AI_PROVIDER_ERROR",
    };
  }

  const finishReason = (choice as Record<string, unknown>).finish_reason;
  const message = (choice as Record<string, unknown>).message;

  if (
    typeof message !== "object" ||
    message === null ||
    Array.isArray(message)
  ) {
    return {
      ok: false,
      diagnosticCode: "AI_PROVIDER_ERROR",
    };
  }

  const messageRecord = message as Record<string, unknown>;
  if (
    typeof messageRecord.refusal === "string" ||
    finishReason === "content_filter"
  ) {
    return {
      ok: false,
      diagnosticCode: "AI_PROVIDER_REFUSAL",
    };
  }

  if (finishReason === "length") {
    return {
      ok: false,
      diagnosticCode: "AI_PROVIDER_TRUNCATED",
    };
  }

  if (finishReason !== "stop" || typeof messageRecord.content !== "string") {
    return {
      ok: false,
      diagnosticCode: "AI_PROVIDER_ERROR",
    };
  }

  const inputTokens = readTokenCount(usage?.prompt_tokens);
  const outputTokens = readTokenCount(usage?.completion_tokens);

  return {
    ok: true,
    response: {
      content: messageRecord.content,
      provider: "openai",
      model: OPENAI_MODEL,
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
    },
  };
}

export function createOpenAiProvider(
  apiKey: string,
  fetchImplementation: FetchLike = fetch,
): AiProvider {
  return {
    name: "openai",
    async analyze(request) {
      const outcome = await postJson(
        fetchImplementation,
        OPENAI_ENDPOINT,
        {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        {
          model: OPENAI_MODEL,
          messages: [
            {
              role: "system",
              content: request.systemPrompt,
            },
            {
              role: "user",
              content: request.userPrompt,
            },
          ],
          max_completion_tokens: request.maxOutputTokens,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "sentinel_ai_finding",
              strict: true,
              schema: request.schema,
            },
          },
        },
        request.timeoutMs,
        request.maxResponseBytes,
      );

      return outcome.ok ? readOpenAiOutcome(outcome.body) : outcome;
    },
  };
}
