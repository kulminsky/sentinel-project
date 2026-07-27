import type { SentinelConfig } from "../config/schema.js";
import { createStructuredAiClient } from "./client.js";
import { createClaudeTransport } from "./claude.js";
import { createOpenAiTransport } from "./openai.js";
import type { StructuredAiClient } from "./client.js";
import type { FetchLike } from "./provider.js";

export type AiPrerequisiteCode = "AI_DISABLED" | "AI_CREDENTIAL_MISSING";

export type EnvironmentReferenceResolver = (name: string) => string | undefined;

export interface SkippedAiSetup {
  readonly kind: "skipped";
  readonly diagnosticCode: AiPrerequisiteCode;
  readonly finding: string;
  readonly recommendation: string;
}

export type AiCheckSetup =
  | {
      readonly kind: "ready";
      createClient(): StructuredAiClient;
    }
  | SkippedAiSetup;

export type AiCheckRuntime =
  | {
      readonly kind: "ready";
      readonly client: StructuredAiClient;
    }
  | SkippedAiSetup;

export function disabledAiSetup(): SkippedAiSetup {
  return {
    kind: "skipped",
    diagnosticCode: "AI_DISABLED",
    finding: "AI semantic test-gap analysis is disabled.",
    recommendation:
      "Set SENTINEL_AI_ENABLED=true and select an AI provider to enable this check.",
  };
}

export function createAiRuntime(setup: AiCheckSetup): AiCheckRuntime {
  return setup.kind === "ready"
    ? {
        kind: "ready",
        client: setup.createClient(),
      }
    : setup;
}

export function resolveAiSetup(
  config: SentinelConfig["ai"],
  resolveEnvironmentReference: EnvironmentReferenceResolver,
  fetchImplementation: FetchLike = fetch,
): AiCheckSetup {
  if (!config.enabled) {
    return disabledAiSetup();
  }

  switch (config.provider) {
    case "openai": {
      const credential = resolveEnvironmentReference("OPENAI_API_KEY");
      if (!credential) {
        return {
          kind: "skipped",
          diagnosticCode: "AI_CREDENTIAL_MISSING",
          finding:
            "AI analysis is enabled for OpenAI, but its credential is unavailable.",
          recommendation:
            "Set OPENAI_API_KEY in the process environment and retry.",
        };
      }

      return {
        kind: "ready",
        createClient: () =>
          createStructuredAiClient(
            createOpenAiTransport(credential, fetchImplementation),
          ),
      };
    }
    case "claude": {
      const credential = resolveEnvironmentReference("ANTHROPIC_API_KEY");
      if (!credential) {
        return {
          kind: "skipped",
          diagnosticCode: "AI_CREDENTIAL_MISSING",
          finding:
            "AI analysis is enabled for Claude, but its credential is unavailable.",
          recommendation:
            "Set ANTHROPIC_API_KEY in the process environment and retry.",
        };
      }

      return {
        kind: "ready",
        createClient: () =>
          createStructuredAiClient(
            createClaudeTransport(credential, fetchImplementation),
          ),
      };
    }
  }
}
