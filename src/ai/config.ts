import { createClaudeProvider } from "./claude.js";
import { createOpenAiProvider } from "./openai.js";
import type { AiProvider, FetchLike } from "./provider.js";

export type AiPrerequisiteCode =
  | "AI_DISABLED"
  | "AI_PROVIDER_NOT_SELECTED"
  | "AI_PROVIDER_UNSUPPORTED"
  | "AI_CREDENTIAL_MISSING";

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
  environment: NodeJS.ProcessEnv,
  fetchImplementation: FetchLike = fetch,
): AiCheckSetup {
  if (environment.SENTINEL_AI_ENABLED !== "true") {
    return disabledAiSetup();
  }

  const providerName = environment.SENTINEL_AI_PROVIDER;
  if (!providerName) {
    return {
      kind: "skipped",
      diagnosticCode: "AI_PROVIDER_NOT_SELECTED",
      finding: "AI analysis is enabled, but no provider was selected.",
      recommendation:
        "Set SENTINEL_AI_PROVIDER to either openai or claude.",
    };
  }

  switch (providerName) {
    case "openai": {
      const credential = environment.OPENAI_API_KEY;
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
      const credential = environment.ANTHROPIC_API_KEY;
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
    default:
      return {
        kind: "skipped",
        diagnosticCode: "AI_PROVIDER_UNSUPPORTED",
        finding: "AI analysis is enabled, but the selected provider is unsupported.",
        recommendation:
          "Set SENTINEL_AI_PROVIDER to either openai or claude.",
      };
  }
}
