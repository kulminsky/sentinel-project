import {
  postJson,
  readTokenCount,
  type AiProvider,
  type AiProviderOutcome,
  type FetchLike,
} from "./provider.js";

const CLAUDE_ENDPOINT = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-haiku-4-5";

function readClaudeOutcome(body: unknown): AiProviderOutcome {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      ok: false,
      diagnosticCode: "AI_PROVIDER_ERROR",
    };
  }

  const response = body as Record<string, unknown>;
  const stopReason = response.stop_reason;

  if (stopReason === "refusal") {
    return {
      ok: false,
      diagnosticCode: "AI_PROVIDER_REFUSAL",
    };
  }

  if (stopReason === "max_tokens") {
    return {
      ok: false,
      diagnosticCode: "AI_PROVIDER_TRUNCATED",
    };
  }

  if (stopReason !== "end_turn" || !Array.isArray(response.content)) {
    return {
      ok: false,
      diagnosticCode: "AI_PROVIDER_ERROR",
    };
  }

  const textBlocks = response.content.filter(
    (block): block is { type: "text"; text: string } =>
      typeof block === "object" &&
      block !== null &&
      !Array.isArray(block) &&
      (block as Record<string, unknown>).type === "text" &&
      typeof (block as Record<string, unknown>).text === "string",
  );

  if (textBlocks.length !== 1) {
    return {
      ok: false,
      diagnosticCode: "AI_PROVIDER_ERROR",
    };
  }
  const textBlock = textBlocks[0];
  if (!textBlock) {
    return {
      ok: false,
      diagnosticCode: "AI_PROVIDER_ERROR",
    };
  }

  const usage =
    typeof response.usage === "object" &&
    response.usage !== null &&
    !Array.isArray(response.usage)
      ? (response.usage as Record<string, unknown>)
      : undefined;
  const inputTokens = readTokenCount(usage?.input_tokens);
  const outputTokens = readTokenCount(usage?.output_tokens);

  return {
    ok: true,
    response: {
      content: textBlock.text,
      provider: "claude",
      model: CLAUDE_MODEL,
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
    },
  };
}

export function createClaudeProvider(
  apiKey: string,
  fetchImplementation: FetchLike = fetch,
): AiProvider {
  return {
    name: "claude",
    async analyze(request) {
      const outcome = await postJson(
        fetchImplementation,
        CLAUDE_ENDPOINT,
        {
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          "x-api-key": apiKey,
        },
        {
          model: CLAUDE_MODEL,
          max_tokens: request.maxOutputTokens,
          system: request.systemPrompt,
          messages: [
            {
              role: "user",
              content: request.userPrompt,
            },
          ],
          output_config: {
            format: {
              type: "json_schema",
              schema: request.schema,
            },
          },
        },
        request.timeoutMs,
        request.maxResponseBytes,
      );

      return outcome.ok ? readClaudeOutcome(outcome.body) : outcome;
    },
  };
}
