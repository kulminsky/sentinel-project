import { execFile } from "node:child_process";

import * as ts from "typescript";
import { z } from "zod";

import type { CheckExecution } from "../../core/check.js";
import {
  hasRepositoryFile,
  readRepositoryText,
  type PackageManifestData,
  type RepositoryInspection,
} from "../../repository/inspection.js";
import {
  createRepositoryCheck,
  createRepositoryResult,
  execution,
  incompleteInventoryResult,
  unavailableFileResult,
  type RepositoryCheckMetadata,
} from "./common.js";
import { resolveRootTypescriptConfig } from "./typescript-config.js";

const TSCONFIG_CHECK: RepositoryCheckMetadata = {
  id: "repository.tsconfig-strict",
  title: "TypeScript strictness",
};
const DEPENDENCY_FRESHNESS_CHECK: RepositoryCheckMetadata = {
  id: "repository.dependency-freshness",
  title: "Dependency freshness",
  timeoutMs: 12_000,
};
const LOCKFILE_CHECK: RepositoryCheckMetadata = {
  id: "repository.lockfile",
  title: "Dependency lockfile",
};

const NPM_TIMEOUT_MS = 10_000;
const NPM_MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_DEPENDENCY_FINDINGS = 25;
const STRICT_FAMILY_OPTIONS = [
  "alwaysStrict",
  "noImplicitAny",
  "noImplicitThis",
  "strictBindCallApply",
  "strictBuiltinIteratorReturn",
  "strictFunctionTypes",
  "strictNullChecks",
  "strictPropertyInitialization",
  "useUnknownInCatchVariables",
] as const satisfies readonly (keyof ts.CompilerOptions)[];

const LOCKFILES = [
  {
    path: "npm-shrinkwrap.json",
    family: "npm",
  },
  {
    path: "package-lock.json",
    family: "npm",
  },
  {
    path: "yarn.lock",
    family: "yarn",
  },
  {
    path: "pnpm-lock.yaml",
    family: "pnpm",
  },
  {
    path: "bun.lock",
    family: "bun",
  },
  {
    path: "bun.lockb",
    family: "bun",
  },
] as const;

type LockfileFamily = (typeof LOCKFILES)[number]["family"];

interface NpmLockData {
  readonly lockfileVersion: number;
  readonly rootDependencies?: Readonly<Record<string, string>>;
  readonly rootDevDependencies?: Readonly<Record<string, string>>;
  readonly rootOptionalDependencies?: Readonly<Record<string, string>>;
  readonly installedVersions: Readonly<Record<string, string>>;
}

type NpmLockParseResult =
  | {
      readonly state: "valid";
      readonly data: NpmLockData;
    }
  | {
      readonly state: "invalid";
    }
  | {
      readonly state: "unavailable";
    }
  | {
      readonly state: "absent";
    };

export type NpmOutdatedRunResult =
  | {
      readonly state: "completed";
      readonly exitCode: 0 | 1;
      readonly stdout: string;
    }
  | {
      readonly state: "unavailable";
    };

export type NpmOutdatedRunner = (
  root: string,
  signal: AbortSignal,
) => Promise<NpmOutdatedRunResult>;

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);

    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

const safeVersionSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => !containsControlCharacter(value));
const packageNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(214)
  .refine((value) => !containsControlCharacter(value));
const npmOutdatedEntrySchema = z.looseObject({
  current: safeVersionSchema.optional(),
  wanted: safeVersionSchema,
  latest: safeVersionSchema,
});
const npmOutdatedSchema = z.record(packageNameSchema, npmOutdatedEntrySchema);

export async function checkTsconfigStrictness(
  inspection: RepositoryInspection,
): Promise<CheckExecution> {
  if (!inspection.typescriptProject) {
    if (!inspection.complete) {
      return incompleteInventoryResult(TSCONFIG_CHECK, "TypeScript project");
    }

    return execution([
      createRepositoryResult(TSCONFIG_CHECK, {
        status: "Skipped",
        severity: "Info",
        finding:
          "No root TypeScript configuration or TypeScript source files were detected.",
        recommendation:
          "Enable strict TypeScript configuration if TypeScript is introduced.",
        diagnosticCode: "TYPESCRIPT_PROJECT_NOT_DETECTED",
      }),
    ]);
  }

  const resolvedConfig = await resolveRootTypescriptConfig(inspection);

  if (resolvedConfig.state === "missing") {
    return execution([
      createRepositoryResult(TSCONFIG_CHECK, {
        subject: "tsconfig.json",
        status: "Warn",
        severity: "Medium",
        finding: "TypeScript source was detected without a root tsconfig.json.",
        recommendation:
          "Add a root tsconfig.json and enable the strict compiler option.",
      }),
    ]);
  }

  if (resolvedConfig.state === "unavailable") {
    return unavailableFileResult(TSCONFIG_CHECK, "tsconfig.json");
  }

  if (resolvedConfig.state === "invalid") {
    return execution([
      createRepositoryResult(TSCONFIG_CHECK, {
        subject: "tsconfig.json",
        status: "Warn",
        severity: "Medium",
        finding:
          "The root TypeScript configuration could not be resolved safely.",
        recommendation:
          "Correct the tsconfig.json syntax and any missing or unsupported extends references.",
        diagnosticCode: "TSCONFIG_INVALID",
      }),
    ]);
  }

  const { parsed } = resolvedConfig;
  const disabledOptions = STRICT_FAMILY_OPTIONS.filter(
    (option) => parsed.options[option] === false,
  );

  if (parsed.options.strict === true && disabledOptions.length === 0) {
    return execution([
      createRepositoryResult(TSCONFIG_CHECK, {
        subject: "tsconfig.json",
        status: "Pass",
        severity: "Info",
        finding:
          "The resolved root TypeScript configuration enables strict mode without disabling a strict-family option.",
        recommendation:
          "Keep strict TypeScript compiler checks enabled as the project evolves.",
      }),
    ]);
  }

  return execution([
    createRepositoryResult(TSCONFIG_CHECK, {
      subject: "tsconfig.json",
      status: "Warn",
      severity: "Medium",
      finding:
        parsed.options.strict !== true
          ? "The resolved root TypeScript configuration does not enable strict mode."
          : `Strict mode is enabled, but ${disabledOptions.join(", ")} is explicitly disabled.`,
      recommendation:
        "Enable strict mode and remove explicit false overrides for strict-family compiler options.",
      ...(disabledOptions.length === 0
        ? {}
        : {
            evidence: disabledOptions.map((option) => `Disabled: ${option}`),
          }),
    }),
  ]);
}

function declaredPackageManagerFamily(
  manifest: PackageManifestData,
): string | undefined {
  return manifest.packageManager?.trim().toLowerCase().split("@", 1)[0];
}

function presentLockfiles(
  inspection: RepositoryInspection,
): readonly (typeof LOCKFILES)[number][] {
  return LOCKFILES.filter((lockfile) =>
    hasRepositoryFile(inspection, lockfile.path),
  );
}

function packageManagerFamilyForFreshness(
  inspection: RepositoryInspection,
  manifest: PackageManifestData,
): string | undefined {
  const declaredFamily = declaredPackageManagerFamily(manifest);

  if (declaredFamily !== undefined) {
    return declaredFamily;
  }

  const lockfiles = presentLockfiles(inspection);

  if (lockfiles.length === 1) {
    return lockfiles[0]?.family;
  }

  return lockfiles.length === 0 ? "npm" : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalStringRecord(
  value: unknown,
): Readonly<Record<string, string>> | undefined | null {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    return null;
  }

  if (Object.values(value).some((entry) => typeof entry !== "string")) {
    return null;
  }

  return value as Readonly<Record<string, string>>;
}

async function parseNpmLock(
  inspection: RepositoryInspection,
  path: string,
): Promise<NpmLockParseResult> {
  if (!hasRepositoryFile(inspection, path)) {
    return {
      state: "absent",
    };
  }

  const content = await readRepositoryText(inspection, path);

  if (content.state !== "ok") {
    return {
      state: "unavailable",
    };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(content.content);
  } catch {
    return {
      state: "invalid",
    };
  }

  if (
    !isRecord(parsed) ||
    !Number.isInteger(parsed["lockfileVersion"]) ||
    (parsed["lockfileVersion"] as number) <= 0
  ) {
    return {
      state: "invalid",
    };
  }

  const packages = parsed["packages"];
  const lockfileVersion = parsed["lockfileVersion"] as number;
  const installedVersions: Record<string, string> = {};
  let rootDependencies: Readonly<Record<string, string>> | undefined;
  let rootDevDependencies: Readonly<Record<string, string>> | undefined;
  let rootOptionalDependencies: Readonly<Record<string, string>> | undefined;

  if (lockfileVersion >= 2 && packages === undefined) {
    return {
      state: "invalid",
    };
  }

  if (packages !== undefined) {
    if (!isRecord(packages)) {
      return {
        state: "invalid",
      };
    }

    const rootPackage = packages[""];

    if (lockfileVersion >= 2 && rootPackage === undefined) {
      return {
        state: "invalid",
      };
    }

    if (rootPackage !== undefined) {
      if (!isRecord(rootPackage)) {
        return {
          state: "invalid",
        };
      }

      const dependencies = optionalStringRecord(rootPackage["dependencies"]);
      const devDependencies = optionalStringRecord(
        rootPackage["devDependencies"],
      );
      const optionalDependencies = optionalStringRecord(
        rootPackage["optionalDependencies"],
      );

      if (
        dependencies === null ||
        devDependencies === null ||
        optionalDependencies === null
      ) {
        return {
          state: "invalid",
        };
      }

      rootDependencies = dependencies;
      rootDevDependencies = devDependencies;
      rootOptionalDependencies = optionalDependencies;
    }

    for (const [packagePath, packageValue] of Object.entries(packages)) {
      if (
        !packagePath.startsWith("node_modules/") ||
        !isRecord(packageValue) ||
        typeof packageValue["version"] !== "string"
      ) {
        continue;
      }

      installedVersions[packagePath.slice("node_modules/".length)] =
        packageValue["version"];
    }
  }

  return {
    state: "valid",
    data: {
      lockfileVersion,
      ...(rootDependencies === undefined ? {} : { rootDependencies }),
      ...(rootDevDependencies === undefined ? {} : { rootDevDependencies }),
      ...(rootOptionalDependencies === undefined
        ? {}
        : { rootOptionalDependencies }),
      installedVersions,
    },
  };
}

function runNpmOutdated(
  root: string,
  signal: AbortSignal,
): Promise<NpmOutdatedRunResult> {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";

  return new Promise((resolveRun) => {
    execFile(
      command,
      ["outdated", "--json", "--long", "--ignore-scripts"],
      {
        cwd: root,
        encoding: "utf8",
        maxBuffer: NPM_MAX_OUTPUT_BYTES,
        timeout: NPM_TIMEOUT_MS,
        signal,
      },
      (error, stdout) => {
        if (error === null) {
          resolveRun({
            state: "completed",
            exitCode: 0,
            stdout,
          });
          return;
        }

        if (error.code === 1) {
          resolveRun({
            state: "completed",
            exitCode: 1,
            stdout,
          });
          return;
        }

        resolveRun({
          state: "unavailable",
        });
      },
    );
  });
}

function dependencyMaps(
  manifest: PackageManifestData,
): Readonly<Record<string, string>> {
  return {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
  };
}

function dependencyUnavailableResult(
  finding: string,
  recommendation: string,
  diagnosticCode: string,
  incomplete = false,
): CheckExecution {
  return execution(
    [
      createRepositoryResult(DEPENDENCY_FRESHNESS_CHECK, {
        status: "Skipped",
        severity: "Info",
        finding,
        recommendation,
        diagnosticCode,
      }),
    ],
    incomplete,
  );
}

function containsNpmErrorEnvelope(parsed: unknown): boolean {
  return isRecord(parsed) && "error" in parsed;
}

export async function checkDependencyFreshness(
  inspection: RepositoryInspection,
  signal: AbortSignal,
  runner: NpmOutdatedRunner = runNpmOutdated,
): Promise<CheckExecution> {
  if (!inspection.nodeProject) {
    if (!inspection.rootComplete) {
      return incompleteInventoryResult(
        DEPENDENCY_FRESHNESS_CHECK,
        "package.json",
      );
    }

    return dependencyUnavailableResult(
      "No root package.json was detected, so npm dependency freshness is not applicable.",
      "Run this check after adding a root npm manifest.",
      "NODE_PROJECT_NOT_DETECTED",
    );
  }

  const manifest = inspection.packageManifest;

  if (manifest.state === "unavailable") {
    return unavailableFileResult(DEPENDENCY_FRESHNESS_CHECK, "package.json");
  }

  if (manifest.state !== "valid") {
    return execution([
      createRepositoryResult(DEPENDENCY_FRESHNESS_CHECK, {
        subject: "package.json",
        status: "Warn",
        severity: "Medium",
        finding:
          "The root package.json is invalid, so dependency freshness cannot be determined.",
        recommendation:
          "Correct the root package.json before checking dependency versions.",
      }),
    ]);
  }

  if (packageManagerFamilyForFreshness(inspection, manifest.data) !== "npm") {
    return dependencyUnavailableResult(
      "The root project uses a non-npm or ambiguous package-manager setup, which this freshness check does not execute.",
      "Review dependency freshness with the selected package manager and retain only its intended lockfile.",
      "NPM_PROJECT_NOT_DETECTED",
    );
  }

  const dependencies = dependencyMaps(manifest.data);

  if (Object.keys(dependencies).length === 0) {
    return dependencyUnavailableResult(
      "The root npm project declares no production, development, or optional dependencies.",
      "Rerun dependency freshness analysis if dependencies are introduced.",
      "NO_DEPENDENCIES_DECLARED",
    );
  }

  let run: NpmOutdatedRunResult;

  try {
    run = await runner(inspection.root, signal);
  } catch {
    run = {
      state: "unavailable",
    };
  }

  if (run.state === "unavailable") {
    return dependencyUnavailableResult(
      "The bounded npm registry query was unavailable or timed out.",
      "Restore npm and registry access, then rerun the freshness check.",
      "DEPENDENCY_FRESHNESS_UNAVAILABLE",
    );
  }

  let rawOutput: unknown;

  if (run.exitCode === 1 && run.stdout.trim().length === 0) {
    return dependencyUnavailableResult(
      "The npm registry query could not be completed.",
      "Restore npm registry access, then rerun the freshness check.",
      "DEPENDENCY_FRESHNESS_UNAVAILABLE",
    );
  }

  try {
    rawOutput = JSON.parse(run.stdout);
  } catch {
    return dependencyUnavailableResult(
      "npm returned output that Sentinel could not validate.",
      "Verify the npm installation and rerun the freshness check.",
      "DEPENDENCY_FRESHNESS_INVALID_RESPONSE",
      true,
    );
  }

  if (containsNpmErrorEnvelope(rawOutput)) {
    return dependencyUnavailableResult(
      "The npm registry query could not be completed.",
      "Restore npm registry access, then rerun the freshness check.",
      "DEPENDENCY_FRESHNESS_UNAVAILABLE",
    );
  }

  const parsed = npmOutdatedSchema.safeParse(rawOutput);

  if (
    !parsed.success ||
    (run.exitCode === 1 && Object.keys(parsed.data).length === 0)
  ) {
    return dependencyUnavailableResult(
      "npm returned structured output that Sentinel could not validate.",
      "Verify the npm installation and rerun the freshness check.",
      "DEPENDENCY_FRESHNESS_INVALID_RESPONSE",
      true,
    );
  }

  const rootDependencyNames = new Set(Object.keys(dependencies));
  const outdated = Object.entries(parsed.data)
    .filter(([packageName]) => rootDependencyNames.has(packageName))
    .sort(([left], [right]) => left.localeCompare(right));

  if (outdated.length === 0) {
    return execution([
      createRepositoryResult(DEPENDENCY_FRESHNESS_CHECK, {
        status: "Pass",
        severity: "Info",
        finding: "npm reported no outdated root dependencies.",
        recommendation:
          "Continue reviewing dependency freshness alongside compatibility and release constraints.",
      }),
    ]);
  }

  const npmLockPath = hasRepositoryFile(inspection, "npm-shrinkwrap.json")
    ? "npm-shrinkwrap.json"
    : "package-lock.json";
  const lock = await parseNpmLock(inspection, npmLockPath);
  const installedVersions =
    lock.state === "valid" ? lock.data.installedVersions : {};
  const results = outdated
    .slice(0, MAX_DEPENDENCY_FINDINGS)
    .map(([packageName, versions]) => {
      const current = versions.current ?? installedVersions[packageName];
      const behindDeclaredRange =
        current !== undefined && current !== versions.wanted;

      return createRepositoryResult(DEPENDENCY_FRESHNESS_CHECK, {
        subject: packageName,
        status: "Warn",
        severity: behindDeclaredRange ? "Medium" : "Low",
        finding: behindDeclaredRange
          ? `${packageName} is behind the newest version allowed by its declared range.`
          : `${packageName} has a newer release outside its declared range.`,
        recommendation: behindDeclaredRange
          ? `Review and update ${packageName} within the declared compatibility range.`
          : `Review the newer ${packageName} release and compatibility before changing the declared range.`,
        evidence: [
          ...(current === undefined ? [] : [`Current: ${current}`]),
          `Wanted: ${versions.wanted}`,
          `Latest: ${versions.latest}`,
        ],
      });
    });

  if (outdated.length > MAX_DEPENDENCY_FINDINGS) {
    results.push(
      createRepositoryResult(DEPENDENCY_FRESHNESS_CHECK, {
        subject: "Additional dependencies",
        status: "Warn",
        severity: "Low",
        finding: `${outdated.length - MAX_DEPENDENCY_FINDINGS} additional outdated dependencies were omitted by the report bound.`,
        recommendation:
          "Run npm outdated directly to review the remaining dependency updates.",
        evidence: [`Reported dependency limit: ${MAX_DEPENDENCY_FINDINGS}`],
      }),
    );
  }

  return execution(results);
}

function recordsEqual(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>> | undefined,
): boolean {
  const leftEntries = Object.entries(left).sort(([leftName], [rightName]) =>
    leftName.localeCompare(rightName),
  );
  const rightEntries = Object.entries(right ?? {}).sort(
    ([leftName], [rightName]) => leftName.localeCompare(rightName),
  );

  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

function lockfileFamilyForManifest(
  manifest: PackageManifestData,
): LockfileFamily | undefined {
  const family = declaredPackageManagerFamily(manifest);

  return family !== undefined && ["bun", "npm", "pnpm", "yarn"].includes(family)
    ? (family as LockfileFamily)
    : undefined;
}

export async function checkLockfile(
  inspection: RepositoryInspection,
): Promise<CheckExecution> {
  const present = presentLockfiles(inspection);

  if (present.length === 0) {
    if (!inspection.rootComplete) {
      return incompleteInventoryResult(LOCKFILE_CHECK, "dependency lockfile");
    }

    if (!inspection.nodeProject) {
      return execution([
        createRepositoryResult(LOCKFILE_CHECK, {
          status: "Skipped",
          severity: "Info",
          finding:
            "No root Node manifest or recognized dependency lockfile was detected.",
          recommendation:
            "Commit a lockfile when the project adopts a supported package manager.",
          diagnosticCode: "LOCKFILE_NOT_APPLICABLE",
        }),
      ]);
    }

    return execution([
      createRepositoryResult(LOCKFILE_CHECK, {
        status: "Warn",
        severity: "Medium",
        finding:
          "The root Node project does not contain a recognized dependency lockfile.",
        recommendation:
          "Generate and commit the lockfile for the selected package manager.",
      }),
    ]);
  }

  if (present.length > 1) {
    return execution([
      createRepositoryResult(LOCKFILE_CHECK, {
        status: "Warn",
        severity: "Medium",
        finding:
          "Multiple package-manager lockfiles were found at the repository root.",
        recommendation:
          "Retain only the lockfile for the package manager used by the project.",
        evidence: present.map((lockfile) => lockfile.path),
      }),
    ]);
  }

  const selected = present[0];

  if (selected === undefined) {
    return incompleteInventoryResult(LOCKFILE_CHECK, "dependency lockfile");
  }

  const manifest = inspection.packageManifest;

  if (manifest.state === "valid") {
    const expectedFamily = lockfileFamilyForManifest(manifest.data);

    if (expectedFamily !== undefined && expectedFamily !== selected.family) {
      return execution([
        createRepositoryResult(LOCKFILE_CHECK, {
          subject: selected.path,
          status: "Warn",
          severity: "Medium",
          finding: `The selected ${expectedFamily} package manager does not match the ${selected.family} lockfile.`,
          recommendation:
            "Generate and commit the lockfile matching the packageManager declaration.",
          evidence: [selected.path],
        }),
      ]);
    }
  }

  if (selected.family !== "npm") {
    return execution([
      createRepositoryResult(LOCKFILE_CHECK, {
        subject: selected.path,
        status: "Pass",
        severity: "Info",
        finding: `A recognized ${selected.family} lockfile is present.`,
        recommendation:
          "Keep the lockfile committed and synchronized with its manifest.",
      }),
    ]);
  }

  const lock = await parseNpmLock(inspection, selected.path);

  if (lock.state === "unavailable") {
    return unavailableFileResult(LOCKFILE_CHECK, selected.path);
  }

  if (lock.state !== "valid") {
    return execution([
      createRepositoryResult(LOCKFILE_CHECK, {
        subject: selected.path,
        status: "Warn",
        severity: "Medium",
        finding: "The npm lockfile is not valid JSON with a lockfileVersion.",
        recommendation:
          "Regenerate the npm lockfile from a valid package.json.",
      }),
    ]);
  }

  if (manifest.state === "unavailable") {
    return unavailableFileResult(LOCKFILE_CHECK, "package.json");
  }

  if (manifest.state !== "valid") {
    return execution([
      createRepositoryResult(LOCKFILE_CHECK, {
        subject: selected.path,
        status: "Warn",
        severity: "Medium",
        finding:
          "The npm lockfile is present, but its root manifest cannot be validated because package.json is invalid.",
        recommendation: "Correct package.json and regenerate the npm lockfile.",
      }),
    ]);
  }

  const lockContainsRootManifest =
    lock.data.lockfileVersion >= 2 ||
    lock.data.rootDependencies !== undefined ||
    lock.data.rootDevDependencies !== undefined ||
    lock.data.rootOptionalDependencies !== undefined;
  const synchronized =
    !lockContainsRootManifest ||
    (recordsEqual(manifest.data.dependencies, lock.data.rootDependencies) &&
      recordsEqual(
        manifest.data.devDependencies,
        lock.data.rootDevDependencies,
      ) &&
      recordsEqual(
        manifest.data.optionalDependencies,
        lock.data.rootOptionalDependencies,
      ));

  if (!synchronized) {
    return execution([
      createRepositoryResult(LOCKFILE_CHECK, {
        subject: selected.path,
        status: "Warn",
        severity: "Medium",
        finding:
          "The npm lockfile root dependency declarations do not match package.json.",
        recommendation:
          "Regenerate and commit the npm lockfile without changing dependency intent unexpectedly.",
      }),
    ]);
  }

  return execution([
    createRepositoryResult(LOCKFILE_CHECK, {
      subject: selected.path,
      status: "Pass",
      severity: "Info",
      finding:
        "The npm lockfile is valid and its available root dependency declarations match package.json.",
      recommendation:
        "Keep the npm lockfile committed and synchronized with package.json.",
      evidence: [`Lockfile version: ${lock.data.lockfileVersion}`],
    }),
  ]);
}

export const repositoryTsconfigCheck = createRepositoryCheck(
  TSCONFIG_CHECK,
  (context) => checkTsconfigStrictness(context.repository),
);

export const repositoryDependencyFreshnessCheck = createRepositoryCheck(
  DEPENDENCY_FRESHNESS_CHECK,
  (context, signal) => checkDependencyFreshness(context.repository, signal),
);

export const repositoryLockfileCheck = createRepositoryCheck(
  LOCKFILE_CHECK,
  (context) => checkLockfile(context.repository),
);
