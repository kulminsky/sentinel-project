import { z } from "zod";

import type {
  AiTransport,
  AiTransportProvenance,
  AiUnavailableCode,
} from "./provider.js";

const MAX_PAID_CALLS = 1;
const MAX_CONCURRENT_CALLS = 1;
const MAX_OUTPUT_TOKENS = 512;
const PROVIDER_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

const UNSUPPORTED_WIRE_CONSTRAINTS = new Set([
  "$schema",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "format",
  "maxItems",
  "maxLength",
  "maximum",
  "minItems",
  "minLength",
  "minimum",
  "multipleOf",
  "pattern",
  "uniqueItems",
]);

export interface StructuredAiRequest<T> {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly outputSchema: z.ZodType<T>;
}

export type StructuredAiOutcome<T> =
  | {
      readonly state: "available";
      readonly value: T;
      readonly provenanceEvidence: readonly string[];
    }
  | {
      readonly state: "unavailable";
      readonly diagnosticCode: AiUnavailableCode;
    };

export interface StructuredAiClient {
  generate<T>(request: StructuredAiRequest<T>): Promise<StructuredAiOutcome<T>>;
}

function validationDiagnosticCode(error: z.ZodError): AiUnavailableCode {
  const specificCodes = error.issues
    .map((issue) => issue.message)
    .filter(
      (
        message,
      ): message is
        "AI_RESPONSE_MISSING_CITATION" | "AI_RESPONSE_UNSUPPORTED_CITATION" =>
        message === "AI_RESPONSE_MISSING_CITATION" ||
        message === "AI_RESPONSE_UNSUPPORTED_CITATION",
    );

  if (specificCodes.length !== error.issues.length) {
    return "AI_RESPONSE_INVALID_SCHEMA";
  }

  return specificCodes.includes("AI_RESPONSE_UNSUPPORTED_CITATION")
    ? "AI_RESPONSE_UNSUPPORTED_CITATION"
    : "AI_RESPONSE_MISSING_CITATION";
}

function toSupportedWireSchema(
  schema: z.ZodType,
): Readonly<Record<string, unknown>> | undefined {
  let generated: unknown;

  try {
    generated = z.toJSONSchema(schema);
  } catch {
    return undefined;
  }

  function visit(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map(visit);
    }

    if (typeof value !== "object" || value === null) {
      return value;
    }

    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !UNSUPPORTED_WIRE_CONSTRAINTS.has(key))
        .map(([key, entryValue]) => [key, visit(entryValue)]),
    );
  }

  const transformed = visit(generated);
  return typeof transformed === "object" &&
    transformed !== null &&
    !Array.isArray(transformed)
    ? (transformed as Readonly<Record<string, unknown>>)
    : undefined;
}

function provenanceEvidence(
  provenance: AiTransportProvenance,
): readonly string[] {
  const evidence = [
    `Provider: ${provenance.provider}; model: ${provenance.model}`,
  ];

  if (
    provenance.inputTokens !== undefined &&
    provenance.outputTokens !== undefined
  ) {
    evidence.push(
      `Token usage: input ${provenance.inputTokens}, output ${provenance.outputTokens}`,
    );
  }

  return evidence;
}

export function createStructuredAiClient(
  transport: AiTransport,
): StructuredAiClient {
  let paidCalls = 0;
  let activeCalls = 0;

  return {
    async generate<T>(
      request: StructuredAiRequest<T>,
    ): Promise<StructuredAiOutcome<T>> {
      const jsonSchema = toSupportedWireSchema(request.outputSchema);
      if (jsonSchema === undefined) {
        return {
          state: "unavailable",
          diagnosticCode: "AI_RESPONSE_INVALID_SCHEMA",
        };
      }

      if (paidCalls >= MAX_PAID_CALLS || activeCalls >= MAX_CONCURRENT_CALLS) {
        return {
          state: "unavailable",
          diagnosticCode: "AI_CALL_LIMIT_REACHED",
        };
      }

      paidCalls += 1;
      activeCalls += 1;

      try {
        const outcome = await transport.generate({
          systemPrompt: request.systemPrompt,
          userPrompt: request.userPrompt,
          jsonSchema,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          timeoutMs: PROVIDER_TIMEOUT_MS,
          maxResponseBytes: MAX_RESPONSE_BYTES,
        });

        if (outcome.state === "unavailable") {
          return outcome;
        }

        const validated = request.outputSchema.safeParse(outcome.value);
        if (!validated.success) {
          return {
            state: "unavailable",
            diagnosticCode: validationDiagnosticCode(validated.error),
          };
        }

        return {
          state: "available",
          value: validated.data,
          provenanceEvidence: provenanceEvidence(outcome.provenance),
        };
      } catch {
        return {
          state: "unavailable",
          diagnosticCode: "AI_PROVIDER_ERROR",
        };
      } finally {
        activeCalls -= 1;
      }
    },
  };
}
