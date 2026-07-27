import type {
  AiCheckRuntime,
  EnvironmentReferenceResolver,
} from "../ai/config.js";
import type { SentinelConfig } from "../config/schema.js";
import type { RepositoryInspection } from "../repository/inspection.js";
import type { AnalysisLevel, CheckPhase, CheckResult } from "./result.js";

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type UnreachableReason = "timeout" | "network-error";

export type ServiceReachability =
  | {
      state: "not-configured";
    }
  | {
      state: "reachable";
      statusCode: number;
      durationMs: number;
    }
  | {
      state: "unreachable";
      reason: UnreachableReason;
      durationMs: number;
    };

export interface ServiceReachabilityCache {
  readonly api: ServiceReachability;
  readonly ui: ServiceReachability;
}

export interface ScanContext {
  readonly config: SentinelConfig;
  readonly repository: RepositoryInspection;
  readonly ai: AiCheckRuntime;
  readonly resolveEnvironmentReference: EnvironmentReferenceResolver;
  readonly fetch: FetchLike;
  readonly reachability: ServiceReachabilityCache;
}

export interface CheckExecution {
  readonly results: readonly CheckResult[];
  readonly incomplete: boolean;
}

export interface Check {
  readonly id: string;
  readonly title: string;
  readonly level: AnalysisLevel;
  readonly phase: CheckPhase;
  readonly timeoutMs: number;
  run(context: ScanContext, signal: AbortSignal): Promise<CheckExecution>;
}
