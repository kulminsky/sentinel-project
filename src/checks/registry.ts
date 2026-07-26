import { syntheticAiCheck } from "../ai/check.js";
import type { Check } from "../core/check.js";
import {
  apiCoverageCheck,
  securityCoverageCheck,
  uiCoverageCheck,
} from "./coverage.js";
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
  securityCoverageCheck,
  apiAvailabilityCheck,
  syntheticAiCheck,
  apiCoverageCheck,
  uiAvailabilityCheck,
  uiCoverageCheck,
];
