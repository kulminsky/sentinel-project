import type {
  Check,
  CheckExecution,
  ScanContext,
  ServiceReachability,
} from "../core/check.js";
import { createCheckResult } from "../core/result.js";

type ServiceKind = "api" | "ui";

interface AvailabilityCheckMetadata {
  readonly id: string;
  readonly title: string;
  readonly level: "API / Backend" | "UI / Browser";
  readonly label: "API" | "UI";
  readonly configurationKey: "api" | "ui";
}

function executeAvailabilityCheck(
  metadata: AvailabilityCheckMetadata,
  reachability: ServiceReachability,
): CheckExecution {
  if (reachability.state === "not-configured") {
    return {
      results: [
        createCheckResult({
          checkId: metadata.id,
          title: metadata.title,
          level: metadata.level,
          phase: "runtime",
          status: "Skipped",
          severity: "Info",
          finding: `No ${metadata.label} service is configured for runtime checks.`,
          recommendation: `Add the optional ${metadata.configurationKey} configuration when ${metadata.label} runtime checks are required.`,
          diagnosticCode: "SERVICE_NOT_CONFIGURED",
        }),
      ],
      incomplete: false,
    };
  }

  if (reachability.state === "unreachable") {
    const reason =
      reachability.reason === "timeout"
        ? "timed out"
        : "failed because of a network or transport error";

    return {
      results: [
        createCheckResult({
          checkId: metadata.id,
          title: metadata.title,
          level: metadata.level,
          phase: "runtime",
          status: "Skipped",
          severity: "Info",
          finding: `The configured ${metadata.label} service reachability probe ${reason}.`,
          recommendation: `Start the ${metadata.label} service externally or correct its configuration, then retry the scan.`,
          durationMs: reachability.durationMs,
          diagnosticCode: "SERVICE_UNREACHABLE",
        }),
      ],
      incomplete: false,
    };
  }

  return {
    results: [
      createCheckResult({
        checkId: metadata.id,
        title: metadata.title,
        level: metadata.level,
        phase: "runtime",
        status: "Pass",
        severity: "Info",
        finding: `The configured ${metadata.label} service responded to the central reachability probe.`,
        recommendation: `Keep the configured ${metadata.label} service available for runtime verification.`,
        evidence: [
          `HTTP status: ${reachability.statusCode}`,
          `Probe duration: ${reachability.durationMs} ms`,
        ],
        durationMs: reachability.durationMs,
      }),
    ],
    incomplete: false,
  };
}

function createAvailabilityCheck(
  service: ServiceKind,
  metadata: AvailabilityCheckMetadata,
): Check {
  return {
    id: metadata.id,
    title: metadata.title,
    level: metadata.level,
    phase: "runtime",
    timeoutMs: 1_000,
    run: (context: ScanContext) =>
      Promise.resolve(
        executeAvailabilityCheck(metadata, context.reachability[service]),
      ),
  };
}

export const apiAvailabilityCheck = createAvailabilityCheck("api", {
  id: "api.service-availability",
  title: "API service availability",
  level: "API / Backend",
  label: "API",
  configurationKey: "api",
});

export const uiAvailabilityCheck = createAvailabilityCheck("ui", {
  id: "ui.service-availability",
  title: "UI service availability",
  level: "UI / Browser",
  label: "UI",
  configurationKey: "ui",
});
