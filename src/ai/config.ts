import type { SentinelConfig } from "../config/schema.js";
import { createClaudeProvider } from "./claude.js";
import { createOpenAiProvider } from "./openai.js";
import type { AiProvider, FetchLike } from "./provider.js";

export type AiPrerequisiteCode = "AI_DISABLED" | "AI_CREDENTIAL_MISSING";

export type EnvironmentReferenceResolver = (name: string) => string | undefined;

export type AiCheckSetup =
  | {
      kind: "ready";
      provider: AiProvider;
    }
  | {
      kind: "skipped";
      diagnosticCode: AiPrerequisiteCode;
      finding: string;
      recommendation: string;
    };

export function disabledAiSetup(): AiCheckSetup {
  return {
    kind: "skipped",
    diagnosticCode: "AI_DISABLED",
    finding: "AI semantic test-gap analysis is disabled.",
    recommendation:
      "Set SENTINEL_AI_ENABLED=true and select an AI provider to enable this check.",
  };
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
        provider: createOpenAiProvider(credential, fetchImplementation),
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
        provider: createClaudeProvider(credential, fetchImplementation),
      };
    }
  }
}
