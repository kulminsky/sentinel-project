import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import {
  checkDependencyAudit,
  type NpmAuditRunner,
} from "../src/checks/security/dependency-audit.js";
import { inspectRepository } from "../src/repository/inspection.js";

async function withNpmRepository(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "sentinel-audit-test-"));

  try {
    await writeFile(
      join(root, "package.json"),
      `${JSON.stringify({ name: "fixture", version: "1.0.0" })}\n`,
      "utf8",
    );
    await writeFile(
      join(root, "package-lock.json"),
      `${JSON.stringify({
        name: "fixture",
        version: "1.0.0",
        lockfileVersion: 3,
        packages: {
          "": {
            name: "fixture",
            version: "1.0.0",
          },
        },
      })}\n`,
      "utf8",
    );
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function auditReport(
  vulnerabilities: Record<
    string,
    {
      name: string;
      severity: "info" | "low" | "moderate" | "high" | "critical";
      isDirect: boolean;
      range: string;
      fixAvailable: boolean | Record<string, unknown>;
    }
  > = {},
): string {
  const counts = {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
    total: 0,
  };

  for (const vulnerability of Object.values(vulnerabilities)) {
    counts[vulnerability.severity] += 1;
    counts.total += 1;
  }

  return JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities,
    metadata: {
      vulnerabilities: counts,
    },
  });
}

function completedRunner(stdout: string, exitCode: number): NpmAuditRunner {
  return () =>
    Promise.resolve({
      state: "completed",
      exitCode,
      stdout,
    });
}

test("npm audit passes only for a valid empty report with exit code zero", async () => {
  await withNpmRepository(async (root) => {
    const inspection = await inspectRepository(root);
    const clean = await checkDependencyAudit(
      inspection,
      new AbortController().signal,
      completedRunner(auditReport(), 0),
    );
    const failedExit = await checkDependencyAudit(
      inspection,
      new AbortController().signal,
      completedRunner(auditReport(), 1),
    );

    assert.equal(clean.results[0]?.status, "Pass");
    assert.equal(failedExit.results[0]?.status, "Skipped");
    assert.equal(failedExit.results[0]?.diagnosticCode, "NPM_AUDIT_FAILED");
  });
});

test("npm audit maps valid vulnerability reports without exposing raw output", async () => {
  await withNpmRepository(async (root) => {
    const canary = "audit-output-canary";
    const stdout = auditReport({
      criticalPackage: {
        name: "criticalPackage",
        severity: "critical",
        isDirect: true,
        range: "<2.0.0",
        fixAvailable: { name: canary },
      },
      highPackage: {
        name: "highPackage",
        severity: "high",
        isDirect: false,
        range: ">=1.0.0 <1.5.0",
        fixAvailable: false,
      },
      infoPackage: {
        name: "infoPackage",
        severity: "info",
        isDirect: false,
        range: "*",
        fixAvailable: false,
      },
      moderatePackage: {
        name: "moderatePackage",
        severity: "moderate",
        isDirect: true,
        range: "*",
        fixAvailable: true,
      },
      lowPackage: {
        name: "lowPackage",
        severity: "low",
        isDirect: false,
        range: "<3.0.0",
        fixAvailable: true,
      },
    });

    const execution = await checkDependencyAudit(
      await inspectRepository(root),
      new AbortController().signal,
      completedRunner(stdout, 1),
    );

    assert.deepEqual(
      execution.results.map((result) => [
        result.subject,
        result.status,
        result.severity,
      ]),
      [
        ["criticalPackage", "Fail", "Critical"],
        ["highPackage", "Fail", "High"],
        ["infoPackage", "Warn", "Low"],
        ["lowPackage", "Warn", "Low"],
        ["moderatePackage", "Warn", "Medium"],
      ],
    );
    assert.equal(JSON.stringify(execution).includes(canary), false);
    assert.match(
      execution.results[0]?.evidence?.join(" ") ?? "",
      /Dependency: direct/,
    );
    assert.match(
      execution.results[1]?.evidence?.join(" ") ?? "",
      /Dependency: transitive/,
    );
  });
});

test("npm JSON error envelopes and unexpected exits never become clean passes", async () => {
  await withNpmRepository(async (root) => {
    const inspection = await inspectRepository(root);
    const errorEnvelope = await checkDependencyAudit(
      inspection,
      new AbortController().signal,
      completedRunner(
        JSON.stringify({
          error: {
            code: "EAUDITNOLOCK",
            summary: "canary failure detail",
          },
        }),
        1,
      ),
    );
    const vulnerableWrongExit = await checkDependencyAudit(
      inspection,
      new AbortController().signal,
      completedRunner(
        auditReport({
          packageName: {
            name: "packageName",
            severity: "high",
            isDirect: true,
            range: "*",
            fixAvailable: false,
          },
        }),
        2,
      ),
    );

    assert.equal(errorEnvelope.results[0]?.status, "Skipped");
    assert.equal(
      errorEnvelope.results[0]?.diagnosticCode,
      "NPM_AUDIT_UNAVAILABLE",
    );
    assert.equal(
      JSON.stringify(errorEnvelope).includes("canary failure detail"),
      false,
    );
    assert.equal(vulnerableWrongExit.results[0]?.status, "Skipped");
    assert.equal(
      vulnerableWrongExit.results[0]?.diagnosticCode,
      "NPM_AUDIT_FAILED",
    );
  });
});

test("malformed and inconsistent audit payloads are isolated as incomplete", async () => {
  await withNpmRepository(async (root) => {
    const inspection = await inspectRepository(root);
    const malformed = await checkDependencyAudit(
      inspection,
      new AbortController().signal,
      completedRunner("{not-json", 1),
    );
    const inconsistentPayload = JSON.parse(
      auditReport({
        packageName: {
          name: "packageName",
          severity: "high",
          isDirect: true,
          range: "*",
          fixAvailable: false,
        },
      }),
    ) as {
      metadata: {
        vulnerabilities: {
          total: number;
        };
      };
    };
    inconsistentPayload.metadata.vulnerabilities.total = 0;
    const inconsistent = await checkDependencyAudit(
      inspection,
      new AbortController().signal,
      completedRunner(JSON.stringify(inconsistentPayload), 1),
    );
    const missingFields = await checkDependencyAudit(
      inspection,
      new AbortController().signal,
      completedRunner(
        JSON.stringify({
          auditReportVersion: 2,
          vulnerabilities: {},
        }),
        0,
      ),
    );

    for (const execution of [malformed, inconsistent, missingFields]) {
      assert.equal(execution.results[0]?.status, "Skipped");
      assert.equal(
        execution.results[0]?.diagnosticCode,
        "NPM_AUDIT_INVALID_RESPONSE",
      );
      assert.equal(execution.incomplete, true);
    }
  });
});

test("npm audit command failures and output limits remain unknown", async () => {
  await withNpmRepository(async (root) => {
    const inspection = await inspectRepository(root);

    for (const reason of ["command", "timeout", "output-limit"] as const) {
      const execution = await checkDependencyAudit(
        inspection,
        new AbortController().signal,
        () =>
          Promise.resolve({
            state: "unavailable",
            reason,
          }),
      );

      assert.equal(execution.results[0]?.status, "Skipped");
      assert.notEqual(execution.results[0]?.status, "Pass");
    }
  });
});

test("npm audit is skipped without invoking npm for unsupported roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "sentinel-audit-generic-"));

  try {
    let invoked = false;
    const execution = await checkDependencyAudit(
      await inspectRepository(root),
      new AbortController().signal,
      () => {
        invoked = true;
        return Promise.resolve({
          state: "completed",
          exitCode: 0,
          stdout: auditReport(),
        });
      },
    );

    assert.equal(invoked, false);
    assert.equal(execution.results[0]?.status, "Skipped");
    assert.equal(
      execution.results[0]?.diagnosticCode,
      "NPM_AUDIT_NOT_APPLICABLE",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("npm audit caps detailed vulnerable package findings", async () => {
  await withNpmRepository(async (root) => {
    const vulnerabilities = Object.fromEntries(
      Array.from({ length: 26 }, (_, index) => {
        const name = `package-${String(index).padStart(2, "0")}`;
        return [
          name,
          {
            name,
            severity: "low" as const,
            isDirect: false,
            range: "*",
            fixAvailable: false,
          },
        ];
      }),
    );
    const execution = await checkDependencyAudit(
      await inspectRepository(root),
      new AbortController().signal,
      completedRunner(auditReport(vulnerabilities), 1),
    );

    assert.equal(execution.results.length, 26);
    assert.equal(
      execution.results.at(-1)?.subject,
      "Additional vulnerable packages",
    );
  });
});
