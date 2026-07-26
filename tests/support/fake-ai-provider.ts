import type {
  AiProvider,
  AiProviderName,
  AiProviderOutcome,
  AiStructuredRequest,
} from "../../src/ai/provider.js";

export interface FakeAiProvider {
  provider: AiProvider;
  requests: AiStructuredRequest[];
}

export function createFakeAiProvider(
  outcome:
    | AiProviderOutcome
    | ((request: AiStructuredRequest) => AiProviderOutcome),
  name: AiProviderName = "openai",
): FakeAiProvider {
  const requests: AiStructuredRequest[] = [];

  return {
    requests,
    provider: {
      name,
      async analyze(request) {
        requests.push(request);
        return typeof outcome === "function" ? outcome(request) : outcome;
      },
    },
  };
}
