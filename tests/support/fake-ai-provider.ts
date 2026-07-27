import type {
  StructuredAiClient,
  StructuredAiOutcome,
  StructuredAiRequest,
} from "../../src/ai/client.js";
import type {
  AiTransport,
  AiTransportOutcome,
  AiTransportRequest,
  AiProviderName,
} from "../../src/ai/provider.js";

export interface FakeStructuredAiClient {
  readonly client: StructuredAiClient;
  readonly requests: StructuredAiRequest<unknown>[];
}

export function createFakeStructuredAiClient(
  outcome:
    | StructuredAiOutcome<unknown>
    | ((request: StructuredAiRequest<unknown>) => StructuredAiOutcome<unknown>),
): FakeStructuredAiClient {
  const requests: StructuredAiRequest<unknown>[] = [];

  return {
    requests,
    client: {
      generate<T>(request: StructuredAiRequest<T>) {
        requests.push(request);
        const selected =
          typeof outcome === "function" ? outcome(request) : outcome;
        return Promise.resolve(selected as StructuredAiOutcome<T>);
      },
    },
  };
}

export interface FakeAiTransport {
  readonly transport: AiTransport;
  readonly requests: AiTransportRequest[];
}

export function createFakeAiTransport(
  outcome:
    AiTransportOutcome | ((request: AiTransportRequest) => AiTransportOutcome),
  name: AiProviderName = "openai",
): FakeAiTransport {
  const requests: AiTransportRequest[] = [];

  return {
    requests,
    transport: {
      name,
      generate(request) {
        requests.push(request);
        return Promise.resolve(
          typeof outcome === "function" ? outcome(request) : outcome,
        );
      },
    },
  };
}
