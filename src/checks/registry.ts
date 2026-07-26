import { syntheticAiCheck } from "../ai/check.js";
import type { Check } from "../core/check.js";
import { repositoryReadmeCheck } from "./repository-readme.js";
import {
  apiAvailabilityCheck,
  uiAvailabilityCheck,
} from "./service-availability.js";

export const CHECKS: readonly Check[] = [
  repositoryReadmeCheck,
  apiAvailabilityCheck,
  syntheticAiCheck,
  uiAvailabilityCheck,
];
