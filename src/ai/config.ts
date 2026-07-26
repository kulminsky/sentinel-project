import { z } from "zod";

import { createClaudeProvider } from "./claude.js";
import { createOpenAiProvider } from "./openai.js";
import type { AiProvider, FetchLike } from "./provider.js";

const aiEnvironmentSchema = z.object({
  SENTINEL_AI_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  SENTINEL_AI_PROVIDER: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
});

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
  const config = aiEnvironmentSchema.parse(environment);

  if (!config.SENTINEL_AI_ENABLED) {
    return disabledAiSetup();
  }

  const providerName = config.SENTINEL_AI_PROVIDER;
  if (!providerName) {
    return {
      kind: "skipped",
      diagnosticCode: "AI_PROVIDER_NOT_SELECTED",
      finding: "AI analysis is enabled, but no provider was selected.",
      recommendation: "Set SENTINEL_AI_PROVIDER to either openai or claude.",
    };
  }

  switch (providerName) {
    case "openai": {
      const credential = config.OPENAI_API_KEY;
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
      const credential = config.ANTHROPIC_API_KEY;
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
        finding:
          "AI analysis is enabled, but the selected provider is unsupported.",
        recommendation: "Set SENTINEL_AI_PROVIDER to either openai or claude.",
      };
  }
}
