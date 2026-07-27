import type { FetchLike } from "../core/check.js";

export type { FetchLike } from "../core/check.js";

export type AiProviderName = "openai" | "claude";

export type AiUnavailableCode =
  | "AI_PROVIDER_TIMEOUT"
  | "AI_PROVIDER_ERROR"
  | "AI_PROVIDER_REFUSAL"
  | "AI_PROVIDER_TRUNCATED"
  | "AI_CALL_LIMIT_REACHED"
  | "AI_RESPONSE_UNRECOGNIZED"
  | "AI_RESPONSE_INVALID_SCHEMA"
  | "AI_RESPONSE_MISSING_CITATION"
  | "AI_RESPONSE_UNSUPPORTED_CITATION";

export interface AiTransportRequest {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly jsonSchema: Readonly<Record<string, unknown>>;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
}

export interface AiTransportProvenance {
  readonly provider: AiProviderName;
  readonly model: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export type AiTransportOutcome =
  | {
      readonly state: "available";
      readonly value: unknown;
      readonly provenance: AiTransportProvenance;
    }
  | {
      readonly state: "unavailable";
      readonly diagnosticCode: AiUnavailableCode;
    };

export interface AiTransport {
  readonly name: AiProviderName;
  generate(request: AiTransportRequest): Promise<AiTransportOutcome>;
}

type JsonRequestOutcome =
  | {
      readonly state: "available";
      readonly body: unknown;
    }
  | {
      readonly state: "unavailable";
      readonly diagnosticCode:
        | "AI_PROVIDER_TIMEOUT"
        | "AI_PROVIDER_ERROR"
        | "AI_RESPONSE_UNRECOGNIZED";
    };

function isJsonContentType(value: string | null): boolean {
  return value?.toLowerCase().split(";", 1)[0]?.trim() === "application/json";
}

export async function postJson(
  fetchImplementation: FetchLike,
  url: string,
  headers: Readonly<Record<string, string>>,
  body: Readonly<Record<string, unknown>>,
  timeoutMs: number,
  maxResponseBytes: number,
): Promise<JsonRequestOutcome> {
  const controller = new AbortController();
  let didTimeout = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const request = (async (): Promise<JsonRequestOutcome> => {
      const response = await fetchImplementation(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        await response.body?.cancel();
        return {
          state: "unavailable",
          diagnosticCode: "AI_PROVIDER_ERROR",
        };
      }

      if (!isJsonContentType(response.headers.get("content-type"))) {
        await response.body?.cancel();
        return {
          state: "unavailable",
          diagnosticCode: "AI_RESPONSE_UNRECOGNIZED",
        };
      }

      const declaredLengthValue = response.headers.get("content-length");
      if (declaredLengthValue !== null) {
        const declaredLength = Number(declaredLengthValue);
        if (
          !Number.isSafeInteger(declaredLength) ||
          declaredLength < 0 ||
          declaredLength > maxResponseBytes
        ) {
          await response.body?.cancel();
          return {
            state: "unavailable",
            diagnosticCode: "AI_RESPONSE_UNRECOGNIZED",
          };
        }
      }

      const responseText = await response.text();
      if (Buffer.byteLength(responseText, "utf8") > maxResponseBytes) {
        return {
          state: "unavailable",
          diagnosticCode: "AI_RESPONSE_UNRECOGNIZED",
        };
      }

      try {
        return {
          state: "available",
          body: JSON.parse(responseText) as unknown,
        };
      } catch {
        return {
          state: "unavailable",
          diagnosticCode: "AI_RESPONSE_UNRECOGNIZED",
        };
      }
    })();
    const timeoutOutcome = new Promise<JsonRequestOutcome>((resolve) => {
      timeout = setTimeout(() => {
        didTimeout = true;
        controller.abort();
        resolve({
          state: "unavailable",
          diagnosticCode: "AI_PROVIDER_TIMEOUT",
        });
      }, timeoutMs);
    });

    return await Promise.race([request, timeoutOutcome]);
  } catch {
    return {
      state: "unavailable",
      diagnosticCode: didTimeout ? "AI_PROVIDER_TIMEOUT" : "AI_PROVIDER_ERROR",
    };
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readUsage(
  value: unknown,
  inputKey: string,
  outputKey: string,
):
  | {
      readonly state: "available";
      readonly inputTokens?: number;
      readonly outputTokens?: number;
    }
  | {
      readonly state: "unavailable";
    } {
  if (value === undefined) {
    return {
      state: "available",
    };
  }

  if (!isRecord(value)) {
    return {
      state: "unavailable",
    };
  }

  const inputTokens = value[inputKey];
  const outputTokens = value[outputKey];

  if (
    typeof inputTokens !== "number" ||
    !Number.isSafeInteger(inputTokens) ||
    inputTokens < 0 ||
    typeof outputTokens !== "number" ||
    !Number.isSafeInteger(outputTokens) ||
    outputTokens < 0
  ) {
    return {
      state: "unavailable",
    };
  }

  return {
    state: "available",
    inputTokens,
    outputTokens,
  };
}

export function parseStructuredValue(value: unknown):
  | {
      readonly state: "available";
      readonly value: unknown;
    }
  | {
      readonly state: "unavailable";
    } {
  if (typeof value !== "string") {
    return {
      state: "unavailable",
    };
  }

  try {
    return {
      state: "available",
      value: JSON.parse(value) as unknown,
    };
  } catch {
    return {
      state: "unavailable",
    };
  }
}
