import type { FetchLike } from "../core/check.js";

export type { FetchLike } from "../core/check.js";

export type AiProviderName = "openai" | "claude";

export type AiProviderFailureCode =
  | "AI_PROVIDER_TIMEOUT"
  | "AI_PROVIDER_ERROR"
  | "AI_PROVIDER_REFUSAL"
  | "AI_PROVIDER_TRUNCATED";

export interface AiStructuredRequest {
  systemPrompt: string;
  userPrompt: string;
  schema: Readonly<Record<string, unknown>>;
  maxOutputTokens: number;
  timeoutMs: number;
  maxResponseBytes: number;
}

export interface AiProviderResponse {
  content: string;
  provider: AiProviderName;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}

export type AiProviderOutcome =
  | {
      ok: true;
      response: AiProviderResponse;
    }
  | {
      ok: false;
      diagnosticCode: AiProviderFailureCode;
    };

export interface AiProvider {
  name: AiProviderName;
  analyze(request: AiStructuredRequest): Promise<AiProviderOutcome>;
}

type JsonRequestOutcome =
  | {
      ok: true;
      body: unknown;
    }
  | {
      ok: false;
      diagnosticCode: "AI_PROVIDER_TIMEOUT" | "AI_PROVIDER_ERROR";
    };

export async function postJson(
  fetchImplementation: FetchLike,
  url: string,
  headers: Readonly<Record<string, string>>,
  body: Readonly<Record<string, unknown>>,
  timeoutMs: number,
  maxResponseBytes: number,
): Promise<JsonRequestOutcome> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImplementation(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      await response.body?.cancel();
      return {
        ok: false,
        diagnosticCode: "AI_PROVIDER_ERROR",
      };
    }

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
      await response.body?.cancel();
      return {
        ok: false,
        diagnosticCode: "AI_PROVIDER_ERROR",
      };
    }

    const responseText = await response.text();
    if (Buffer.byteLength(responseText, "utf8") > maxResponseBytes) {
      return {
        ok: false,
        diagnosticCode: "AI_PROVIDER_ERROR",
      };
    }

    try {
      return {
        ok: true,
        body: JSON.parse(responseText) as unknown,
      };
    } catch {
      return {
        ok: false,
        diagnosticCode: "AI_PROVIDER_ERROR",
      };
    }
  } catch {
    return {
      ok: false,
      diagnosticCode: controller.signal.aborted
        ? "AI_PROVIDER_TIMEOUT"
        : "AI_PROVIDER_ERROR",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function readTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}
