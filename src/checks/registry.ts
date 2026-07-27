import { syntheticAiCheck } from "../ai/check.js";
import type { Check } from "../core/check.js";
import { apiCoverageCheck, uiCoverageCheck } from "./coverage.js";
import {
  repositoryDependencyFreshnessCheck,
  repositoryLockfileCheck,
  repositoryTsconfigCheck,
} from "./repository/node.js";
import {
  repositoryCiCheck,
  repositoryCodeStyleCheck,
  repositoryGitignoreCheck,
  repositoryReadmeCheck,
  repositoryTestsCheck,
} from "./repository/static.js";
import { securityDebugEndpointsCheck } from "./security/debug-endpoints.js";
import { securityDependencyAuditCheck } from "./security/dependency-audit.js";
import { securityEnvironmentHygieneCheck } from "./security/env-hygiene.js";
import { securityHeadersCheck } from "./security/headers.js";
import { securitySecretScanCheck } from "./security/secrets.js";
import {
  apiAvailabilityCheck,
  uiAvailabilityCheck,
} from "./service-availability.js";

export const CHECKS: readonly Check[] = [
  repositoryGitignoreCheck,
  repositoryCodeStyleCheck,
  repositoryTestsCheck,
  repositoryCiCheck,
  repositoryTsconfigCheck,
  repositoryDependencyFreshnessCheck,
  repositoryLockfileCheck,
  repositoryReadmeCheck,
  securityDependencyAuditCheck,
  securitySecretScanCheck,
  securityEnvironmentHygieneCheck,
  securityHeadersCheck,
  securityDebugEndpointsCheck,
  apiAvailabilityCheck,
  syntheticAiCheck,
  apiCoverageCheck,
  uiAvailabilityCheck,
  uiCoverageCheck,
];
