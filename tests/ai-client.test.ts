import assert from "node:assert/strict";
import { test } from "vitest";
import { z } from "zod";

import { createStructuredAiClient } from "../src/ai/client.js";
import type { AiTransport } from "../src/ai/provider.js";
import { createFakeAiTransport } from "./support/fake-ai-provider.js";

const OUTPUT_SCHEMA = z.strictObject({
  severity: z.enum(["High", "Low"]),
  finding: z.string().trim().min(1),
  citations: z.array(z.enum(["contract.md", "test.md"])).length(2),
});

function availableTransport() {
  return createFakeAiTransport({
    state: "available",
    value: {
      severity: "High",
      finding: "A gap exists.",
      citations: ["contract.md", "test.md"],
    },
    provenance: {
      provider: "openai",
      model: "deterministic-fake",
      inputTokens: 25,
      outputTokens: 10,
    },
  });
}

function request() {
  return {
    systemPrompt: "Return a finding.",
    userPrompt: "Synthetic evidence only.",
    outputSchema: OUTPUT_SCHEMA,
  };
}

test("the structured client derives a strict wire schema and validates locally", async () => {
  const fake = availableTransport();
  const client = createStructuredAiClient(fake.transport);

  const outcome = await client.generate(request());

  assert.equal(outcome.state, "available");
  assert.equal(fake.requests.length, 1);
  const wireSchema = fake.requests[0]?.jsonSchema;
  assert.equal(wireSchema?.type, "object");
  assert.equal(wireSchema?.additionalProperties, false);
  assert.equal("$schema" in (wireSchema ?? {}), false);
  const properties = wireSchema?.properties as
    Record<string, Record<string, unknown>> | undefined;
  assert.equal(properties?.finding?.minLength, undefined);
  assert.equal(properties?.citations?.minItems, undefined);
  assert.equal(properties?.citations?.maxItems, undefined);
  assert.equal(fake.requests[0]?.maxOutputTokens, 512);
  assert.equal(fake.requests[0]?.timeoutMs, 20_000);
  assert.equal(fake.requests[0]?.maxResponseBytes, 64 * 1024);

  if (outcome.state === "available") {
    assert.deepEqual(outcome.value, {
      severity: "High",
      finding: "A gap exists.",
      citations: ["contract.md", "test.md"],
    });
    assert.deepEqual(outcome.provenanceEvidence, [
      "Provider: openai; model: deterministic-fake",
      "Token usage: input 25, output 10",
    ]);
  }
});

test("invalid transport values are unavailable rather than accepted", async () => {
  const fake = createFakeAiTransport({
    state: "available",
    value: {
      severity: "Info",
      finding: "Purportedly benign.",
      citations: ["contract.md", "test.md"],
    },
    provenance: {
      provider: "openai",
      model: "deterministic-fake",
    },
  });
  const outcome = await createStructuredAiClient(fake.transport).generate(
    request(),
  );

  assert.deepEqual(outcome, {
    state: "unavailable",
    diagnosticCode: "AI_RESPONSE_INVALID_SCHEMA",
  });
});

test("two sequential calls dispatch only the first paid request", async () => {
  const fake = availableTransport();
  const client = createStructuredAiClient(fake.transport);

  const first = await client.generate(request());
  const second = await client.generate(request());

  assert.equal(first.state, "available");
  assert.deepEqual(second, {
    state: "unavailable",
    diagnosticCode: "AI_CALL_LIMIT_REACHED",
  });
  assert.equal(fake.requests.length, 1);
});

test("two concurrent calls dispatch only one paid request", async () => {
  let release: (() => void) | undefined;
  const fake = createFakeAiTransport(() => ({
    state: "available",
    value: {
      severity: "High",
      finding: "A gap exists.",
      citations: ["contract.md", "test.md"],
    },
    provenance: {
      provider: "claude",
      model: "deterministic-fake",
    },
  }));
  fake.transport.generate = async (transportRequest) => {
    fake.requests.push(transportRequest);
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return {
      state: "available",
      value: {
        severity: "High",
        finding: "A gap exists.",
        citations: ["contract.md", "test.md"],
      },
      provenance: {
        provider: "claude",
        model: "deterministic-fake",
      },
    };
  };
  const client = createStructuredAiClient(fake.transport);

  const firstPromise = client.generate(request());
  const second = await client.generate(request());
  release?.();
  const first = await firstPromise;

  assert.equal(first.state, "available");
  assert.deepEqual(second, {
    state: "unavailable",
    diagnosticCode: "AI_CALL_LIMIT_REACHED",
  });
  assert.equal(fake.requests.length, 1);
});

test("a failed request consumes the per-scan paid-call allowance", async () => {
  const fake = createFakeAiTransport({
    state: "unavailable",
    diagnosticCode: "AI_PROVIDER_TIMEOUT",
  });
  const client = createStructuredAiClient(fake.transport);

  const first = await client.generate(request());
  const second = await client.generate(request());

  assert.deepEqual(first, {
    state: "unavailable",
    diagnosticCode: "AI_PROVIDER_TIMEOUT",
  });
  assert.deepEqual(second, {
    state: "unavailable",
    diagnosticCode: "AI_CALL_LIMIT_REACHED",
  });
  assert.equal(fake.requests.length, 1);
});

test("a throwing transport is sanitized and consumes the paid-call allowance", async () => {
  const canary = `transport-exception-${Date.now().toString()}`;
  let calls = 0;
  const transport: AiTransport = {
    name: "openai",
    generate() {
      calls += 1;
      throw new Error(canary);
    },
  };
  const client = createStructuredAiClient(transport);

  const first = await client.generate(request());
  const second = await client.generate(request());

  assert.deepEqual(first, {
    state: "unavailable",
    diagnosticCode: "AI_PROVIDER_ERROR",
  });
  assert.equal(JSON.stringify(first).includes(canary), false);
  assert.deepEqual(second, {
    state: "unavailable",
    diagnosticCode: "AI_CALL_LIMIT_REACHED",
  });
  assert.equal(calls, 1);
});
