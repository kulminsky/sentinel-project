import type {
  FetchLike,
  ServiceReachability,
  ServiceReachabilityCache,
} from "../core/check.js";
import type { SentinelConfig } from "../config/schema.js";

class ReachabilityTimeoutError extends Error {}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function isHttpStatus(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
  );
}

async function probeService(
  target: string | URL,
  timeoutMs: number,
  fetchImplementation: FetchLike,
): Promise<ServiceReachability> {
  const startedAt = performance.now();
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new ReachabilityTimeoutError());
    }, timeoutMs);
  });
  const requestPromise = Promise.resolve().then(() =>
    fetchImplementation(target, {
      method: "HEAD",
      signal: controller.signal,
    }),
  );

  try {
    const response = await Promise.race([requestPromise, timeoutPromise]);
    if (!isHttpStatus(response.status)) {
      throw new Error("Malformed reachability response.");
    }

    try {
      await response.body?.cancel();
    } catch {
      // A valid HTTP response remains reachable even if body cleanup fails.
    }

    return {
      state: "reachable",
      statusCode: response.status,
      durationMs: elapsedMilliseconds(startedAt),
    };
  } catch (error: unknown) {
    return {
      state: "unreachable",
      reason:
        error instanceof ReachabilityTimeoutError || controller.signal.aborted
          ? "timeout"
          : "network-error",
      durationMs: elapsedMilliseconds(startedAt),
    };
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

export async function probeConfiguredServices(
  config: SentinelConfig,
  fetchImplementation: FetchLike,
): Promise<ServiceReachabilityCache> {
  const apiProbe =
    config.api === undefined
      ? Promise.resolve<ServiceReachability>({
          state: "not-configured",
        })
      : probeService(
          new URL(config.api.healthPath, config.api.baseUrl),
          config.api.timeoutMs,
          fetchImplementation,
        );
  const uiProbe =
    config.ui === undefined
      ? Promise.resolve<ServiceReachability>({
          state: "not-configured",
        })
      : probeService(
          new URL(config.ui.baseUrl),
          config.ui.timeoutMs,
          fetchImplementation,
        );
  const [api, ui] = await Promise.all([apiProbe, uiProbe]);

  return {
    api,
    ui,
  };
}
