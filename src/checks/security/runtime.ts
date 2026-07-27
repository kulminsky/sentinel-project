import type { FetchLike } from "../../core/check.js";

export type ReadOnlyMethod = "GET" | "HEAD" | "OPTIONS";

export type RuntimeObservation =
  | {
      readonly state: "response";
      readonly status: number;
      readonly headers: Headers;
    }
  | {
      readonly state: "unavailable";
      readonly reason: "timeout" | "transport";
    };

function isHttpStatus(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
  );
}

export async function observeReadOnlyTarget(options: {
  readonly fetch: FetchLike;
  readonly method: ReadOnlyMethod;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly url: URL;
}): Promise<RuntimeObservation> {
  if (options.signal.aborted) {
    return {
      state: "unavailable",
      reason: "timeout",
    };
  }

  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  options.signal.addEventListener("abort", abortFromParent, { once: true });
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await options.fetch(options.url, {
      method: options.method,
      redirect: "manual",
      signal: controller.signal,
    });

    if (!isHttpStatus(response.status)) {
      return {
        state: "unavailable",
        reason: "transport",
      };
    }

    try {
      await response.body?.cancel();
    } catch {
      // Header and status observations remain valid when body cleanup fails.
    }

    return {
      state: "response",
      status: response.status,
      headers: response.headers,
    };
  } catch {
    return {
      state: "unavailable",
      reason: controller.signal.aborted ? "timeout" : "transport",
    };
  } finally {
    clearTimeout(timeout);
    options.signal.removeEventListener("abort", abortFromParent);
  }
}
