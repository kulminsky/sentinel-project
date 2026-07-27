import {
  isRecord,
  parseStructuredValue,
  postJson,
  readUsage,
  type AiTransport,
  type AiTransportOutcome,
  type FetchLike,
} from "./provider.js";

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-5.6-luna";

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

function readOpenAiOutcome(body: unknown): AiTransportOutcome {
  if (!isRecord(body) || !Array.isArray(body.choices)) {
    return unavailable("AI_RESPONSE_UNRECOGNIZED");
  }

  if (body.choices.length !== 1) {
    return unavailable("AI_RESPONSE_UNRECOGNIZED");
  }

  const choice: unknown = body.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) {
    return unavailable("AI_RESPONSE_UNRECOGNIZED");
  }

  const finishReason = choice.finish_reason;
  const refusal = choice.message.refusal;

  if (finishReason === "content_filter" || typeof refusal === "string") {
    return unavailable("AI_PROVIDER_REFUSAL");
  }

  if (finishReason === "length") {
    return unavailable("AI_PROVIDER_TRUNCATED");
  }

  if (finishReason !== "stop" || (refusal !== undefined && refusal !== null)) {
    return unavailable("AI_RESPONSE_UNRECOGNIZED");
  }

  const structured = parseStructuredValue(choice.message.content);
  const usage = readUsage(body.usage, "prompt_tokens", "completion_tokens");
  if (structured.state === "unavailable" || usage.state === "unavailable") {
    return unavailable("AI_RESPONSE_UNRECOGNIZED");
  }

  return {
    state: "available",
    value: structured.value,
    provenance: {
      provider: "openai",
      model: OPENAI_MODEL,
      ...(usage.inputTokens === undefined
        ? {}
        : { inputTokens: usage.inputTokens }),
      ...(usage.outputTokens === undefined
        ? {}
        : { outputTokens: usage.outputTokens }),
    },
  };
}

export function createOpenAiTransport(
  apiKey: string,
  fetchImplementation: FetchLike = fetch,
): AiTransport {
  return {
    name: "openai",
    async generate(request) {
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
              schema: request.jsonSchema,
            },
          },
        },
        request.timeoutMs,
        request.maxResponseBytes,
      );

      return outcome.state === "available"
        ? readOpenAiOutcome(outcome.body)
        : outcome;
    },
  };
}
