import {
  isRecord,
  parseStructuredValue,
  postJson,
  readUsage,
  type AiTransport,
  type AiTransportOutcome,
  type FetchLike,
} from "./provider.js";

const CLAUDE_ENDPOINT = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-haiku-4-5";

function unavailable(
  diagnosticCode: Extract<
    AiTransportOutcome,
    { state: "unavailable" }
  >["diagnosticCode"],
): AiTransportOutcome {
  return {
    state: "unavailable",
    diagnosticCode,
  };
}

function readClaudeOutcome(body: unknown): AiTransportOutcome {
  if (!isRecord(body)) {
    return unavailable("AI_RESPONSE_UNRECOGNIZED");
  }

  if (body.stop_reason === "refusal") {
    return unavailable("AI_PROVIDER_REFUSAL");
  }

  if (body.stop_reason === "max_tokens") {
    return unavailable("AI_PROVIDER_TRUNCATED");
  }

  if (
    body.stop_reason !== "end_turn" ||
    !Array.isArray(body.content) ||
    body.content.length !== 1
  ) {
    return unavailable("AI_RESPONSE_UNRECOGNIZED");
  }

  const block: unknown = body.content[0];
  if (!isRecord(block) || block.type !== "text") {
    return unavailable("AI_RESPONSE_UNRECOGNIZED");
  }

  const structured = parseStructuredValue(block.text);
  const usage = readUsage(body.usage, "input_tokens", "output_tokens");
  if (structured.state === "unavailable" || usage.state === "unavailable") {
    return unavailable("AI_RESPONSE_UNRECOGNIZED");
  }

  return {
    state: "available",
    value: structured.value,
    provenance: {
      provider: "claude",
      model: CLAUDE_MODEL,
      ...(usage.inputTokens === undefined
        ? {}
        : { inputTokens: usage.inputTokens }),
      ...(usage.outputTokens === undefined
        ? {}
        : { outputTokens: usage.outputTokens }),
    },
  };
}

export function createClaudeTransport(
  apiKey: string,
  fetchImplementation: FetchLike = fetch,
): AiTransport {
  return {
    name: "claude",
    async generate(request) {
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
              schema: request.jsonSchema,
            },
          },
        },
        request.timeoutMs,
        request.maxResponseBytes,
      );

      return outcome.state === "available"
        ? readClaudeOutcome(outcome.body)
        : outcome;
    },
  };
}
