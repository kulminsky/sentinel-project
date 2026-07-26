import { isAbsolute, relative, sep } from "node:path";

import createIgnore from "ignore";

import type { CheckExecution } from "../../core/check.js";
import {
  findRepositoryEntry,
  hasRepositoryFile,
  readRepositoryText,
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

const GITIGNORE_CHECK: RepositoryCheckMetadata = {
  id: "repository.gitignore",
  title: "Gitignore coverage",
};
const CODE_STYLE_CHECK: RepositoryCheckMetadata = {
  id: "repository.code-style",
  title: "Linter and formatter configuration",
};
const TESTS_CHECK: RepositoryCheckMetadata = {
  id: "repository.tests",
  title: "Repository tests",
};
const CI_CHECK: RepositoryCheckMetadata = {
  id: "repository.ci",
  title: "Continuous integration configuration",
};
const README_CHECK: RepositoryCheckMetadata = {
  id: "repository.readme",
  title: "Repository README quality",
};

const GENERATED_DIRECTORY_NAMES = new Set(["build", "coverage", "dist", "out"]);
const README_NAMES = [
  "README.md",
  "README.rst",
  "README.txt",
  "README",
] as const;
const RUFF_CONFIG_NAMES = [".ruff.toml", "ruff.toml"] as const;
const LINTER_CONFIG_NAMES = new Set([
  ".eslintrc",
  ".eslintrc.cjs",
  ".eslintrc.js",
  ".eslintrc.json",
  ".eslintrc.yaml",
  ".eslintrc.yml",
  ".golangci.toml",
  ".golangci.yaml",
  ".golangci.yml",
  ".pylintrc",
  ".stylelintrc",
  ".stylelintrc.cjs",
  ".stylelintrc.js",
  ".stylelintrc.json",
  ".stylelintrc.yaml",
  ".stylelintrc.yml",
  "biome.json",
  "biome.jsonc",
  "deno.json",
  "deno.jsonc",
  "eslint.config.cjs",
  "eslint.config.cts",
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.mts",
  "eslint.config.ts",
  "pylintrc",
  "stylelint.config.cjs",
  "stylelint.config.cts",
  "stylelint.config.js",
  "stylelint.config.mjs",
  "stylelint.config.mts",
  "stylelint.config.ts",
  ...RUFF_CONFIG_NAMES,
]);
const FORMATTER_CONFIG_NAMES = new Set([
  ".clang-format",
  ".prettierrc",
  ".prettierrc.cjs",
  ".prettierrc.js",
  ".prettierrc.json",
  ".prettierrc.json5",
  ".prettierrc.mjs",
  ".prettierrc.toml",
  ".prettierrc.yaml",
  ".prettierrc.yml",
  ".rustfmt.toml",
  "biome.json",
  "biome.jsonc",
  "deno.json",
  "deno.jsonc",
  ".dprint.json",
  ".dprint.jsonc",
  "dprint.json",
  "dprint.jsonc",
  "prettier.config.cjs",
  "prettier.config.js",
  "prettier.config.mjs",
  "prettier.config.ts",
  "rustfmt.toml",
  ...RUFF_CONFIG_NAMES,
]);
const CI_ROOT_PATHS = new Set([
  ".circleci/config.yml",
  ".gitlab-ci.yml",
  ".travis.yml",
  "Jenkinsfile",
  "azure-pipelines.yml",
  "bitbucket-pipelines.yml",
  ".buildkite/pipeline.yml",
]);

interface IgnoreCandidate {
  readonly label: string;
  readonly path: string;
}

function rootFileNames(inspection: RepositoryInspection): Set<string> {
  return new Set(
    inspection.entries
      .filter((entry) => entry.kind === "file" && !entry.path.includes("/"))
      .map((entry) => entry.path),
  );
}

async function configuredTypescriptOutDirectory(
  inspection: RepositoryInspection,
): Promise<string | undefined> {
  const resolvedConfig = await resolveRootTypescriptConfig(inspection);

  if (
    resolvedConfig.state !== "valid" ||
    resolvedConfig.parsed.options.outDir === undefined
  ) {
    return undefined;
  }

  const relativePath = relative(
    inspection.root,
    resolvedConfig.parsed.options.outDir,
  );

  if (
    relativePath.length === 0 ||
    isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`)
  ) {
    return undefined;
  }

  return relativePath.split(sep).join("/");
}

export async function checkGitignore(
  inspection: RepositoryInspection,
): Promise<CheckExecution> {
  if (!hasRepositoryFile(inspection, ".gitignore")) {
    if (!inspection.rootComplete) {
      return incompleteInventoryResult(GITIGNORE_CHECK, ".gitignore");
    }

    return execution([
      createRepositoryResult(GITIGNORE_CHECK, {
        subject: ".gitignore",
        status: "Warn",
        severity: "Medium",
        finding: "No root .gitignore file was found.",
        recommendation:
          "Add a root .gitignore covering environment files, generated files, and stack-specific dependencies.",
      }),
    ]);
  }

  const content = await readRepositoryText(inspection, ".gitignore");

  if (content.state !== "ok") {
    return unavailableFileResult(GITIGNORE_CHECK, ".gitignore");
  }

  const candidates: IgnoreCandidate[] = [
    {
      label: "environment files",
      path: ".env",
    },
    {
      label: "macOS metadata",
      path: ".DS_Store",
    },
  ];

  if (inspection.nodeProject) {
    candidates.push({
      label: "Node dependencies",
      path: "node_modules/sentinel-probe",
    });
  }

  for (const entry of inspection.entries) {
    if (
      entry.kind === "directory" &&
      !entry.path.includes("/") &&
      GENERATED_DIRECTORY_NAMES.has(entry.path)
    ) {
      candidates.push({
        label: `${entry.path} output`,
        path: `${entry.path}/sentinel-probe`,
      });
    }
  }

  const outDirectory = await configuredTypescriptOutDirectory(inspection);

  if (outDirectory !== undefined) {
    candidates.push({
      label: "TypeScript output",
      path: `${outDirectory}/sentinel-probe`,
    });
  }

  let matcher: ReturnType<typeof createIgnore>;

  try {
    matcher = createIgnore().add(content.content);
  } catch {
    return execution([
      createRepositoryResult(GITIGNORE_CHECK, {
        subject: ".gitignore",
        status: "Warn",
        severity: "Medium",
        finding: "The root .gitignore could not be interpreted safely.",
        recommendation:
          "Correct invalid ignore patterns and retain coverage for environment and generated files.",
      }),
    ]);
  }

  const uniqueCandidates = [
    ...new Map(
      candidates.map((candidate) => [candidate.path, candidate]),
    ).values(),
  ];
  const missing = uniqueCandidates.filter(
    (candidate) => !matcher.ignores(candidate.path),
  );

  if (missing.length === 0) {
    return execution([
      createRepositoryResult(GITIGNORE_CHECK, {
        subject: ".gitignore",
        status: "Pass",
        severity: "Info",
        finding:
          "The root .gitignore covers the applicable environment, platform, dependency, and generated-output paths.",
        recommendation:
          "Keep ignore rules synchronized with generated files and build outputs.",
        evidence: uniqueCandidates.map(
          (candidate) => `Covered: ${candidate.label}`,
        ),
      }),
    ]);
  }

  const generatedPathMissing = missing.some(
    (candidate) =>
      candidate.path.startsWith("node_modules/") ||
      candidate.path.endsWith("/sentinel-probe"),
  );

  return execution([
    createRepositoryResult(GITIGNORE_CHECK, {
      subject: ".gitignore",
      status: "Warn",
      severity: generatedPathMissing ? "Medium" : "Low",
      finding: `The root .gitignore does not cover ${missing
        .map((candidate) => candidate.label)
        .join(", ")}.`,
      recommendation:
        "Add ignore rules for each reported environment, platform, dependency, or generated-output path.",
      evidence: missing.map((candidate) => `Missing: ${candidate.label}`),
    }),
  ]);
}

function configuredRootFiles(
  inspection: RepositoryInspection,
  names: ReadonlySet<string>,
): string[] {
  const files = rootFileNames(inspection);
  return [...names].filter((name) => files.has(name)).sort();
}

export async function checkCodeStyle(
  inspection: RepositoryInspection,
): Promise<CheckExecution> {
  const linterConfigs = configuredRootFiles(inspection, LINTER_CONFIG_NAMES);
  const formatterConfigs = configuredRootFiles(
    inspection,
    FORMATTER_CONFIG_NAMES,
  );
  let pyprojectUnavailable = false;

  if (hasRepositoryFile(inspection, "pyproject.toml")) {
    const pyproject = await readRepositoryText(inspection, "pyproject.toml");

    if (pyproject.state === "ok") {
      if (
        /^\s*\[\s*tool\.ruff(?:\.[^\]]+)?\s*\]\s*(?:#.*)?$/m.test(
          pyproject.content,
        )
      ) {
        linterConfigs.push("pyproject.toml#tool.ruff");
        formatterConfigs.push("pyproject.toml#tool.ruff");
      }
    } else {
      pyprojectUnavailable = true;
    }
  }

  const manifest = inspection.packageManifest;

  if (manifest.state === "valid") {
    if (manifest.data.hasEslintConfig) {
      linterConfigs.push("package.json#eslintConfig");
    }

    if (manifest.data.hasPrettierConfig) {
      formatterConfigs.push("package.json#prettier");
    }
  } else if (
    manifest.state === "unavailable" &&
    (linterConfigs.length === 0 || formatterConfigs.length === 0)
  ) {
    return unavailableFileResult(CODE_STYLE_CHECK, "package.json");
  }

  if (
    pyprojectUnavailable &&
    (linterConfigs.length === 0 || formatterConfigs.length === 0)
  ) {
    return unavailableFileResult(CODE_STYLE_CHECK, "pyproject.toml");
  }

  if (
    !inspection.rootComplete &&
    (linterConfigs.length === 0 || formatterConfigs.length === 0)
  ) {
    return incompleteInventoryResult(
      CODE_STYLE_CHECK,
      "code-style configuration",
    );
  }

  const configured = [
    ...(linterConfigs.length > 0
      ? [`Linter: ${linterConfigs.join(", ")}`]
      : []),
    ...(formatterConfigs.length > 0
      ? [`Formatter: ${formatterConfigs.join(", ")}`]
      : []),
  ];

  if (linterConfigs.length > 0 && formatterConfigs.length > 0) {
    return execution([
      createRepositoryResult(CODE_STYLE_CHECK, {
        status: "Pass",
        severity: "Info",
        finding:
          "Recognized linter and formatter configuration is present at the repository root.",
        recommendation:
          "Keep linting and formatting configuration enforced by the development workflow.",
        evidence: configured,
      }),
    ]);
  }

  const missing = [
    ...(linterConfigs.length === 0 ? ["linter"] : []),
    ...(formatterConfigs.length === 0 ? ["formatter"] : []),
  ];

  return execution([
    createRepositoryResult(CODE_STYLE_CHECK, {
      status: "Warn",
      severity: "Low",
      finding: `No recognized ${missing.join(" or ")} configuration was found at the repository root.`,
      recommendation: `Add explicit ${missing.join(" and ")} configuration appropriate for the project stack.`,
      ...(configured.length === 0 ? {} : { evidence: configured }),
    }),
  ]);
}

function isTestFile(path: string): boolean {
  const segments = path.split("/");
  const fileName = segments.at(-1) ?? "";
  const directorySegments = segments.slice(0, -1);
  const inConventionalDirectory = directorySegments.some((segment) =>
    ["__tests__", "spec", "test", "tests"].includes(segment.toLowerCase()),
  );
  const sourceFileInConventionalDirectory =
    inConventionalDirectory &&
    !fileName.startsWith(".") &&
    /\.(?:[cm]?[jt]sx?|py|go|rb|rs|java|kt|kts|scala|swift|php|cs|c|cc|cpp|cxx|h|hpp|sh|bash)$/i.test(
      fileName,
    );

  return (
    sourceFileInConventionalDirectory ||
    /\.(spec|test)\.[^/]+$/i.test(fileName) ||
    /^test_.+\.py$/i.test(fileName) ||
    /_test\.(go|py)$/i.test(fileName)
  );
}

function isRunnableTestScript(script: string | undefined): boolean {
  if (script === undefined || script.trim().length === 0) {
    return false;
  }

  const normalized = script.toLowerCase();

  return !(
    normalized.includes("no test specified") ||
    normalized.includes("no tests configured") ||
    /^echo\b.*\bexit\s+1\b/.test(normalized)
  );
}

export function checkTests(inspection: RepositoryInspection): CheckExecution {
  const testFiles = inspection.entries
    .filter((entry) => entry.kind === "file" && isTestFile(entry.path))
    .map((entry) => entry.path);
  const manifest = inspection.packageManifest;
  const testScript =
    manifest.state === "valid" ? manifest.data.scripts["test"] : undefined;
  const runnableTestScript = isRunnableTestScript(testScript);

  if (testFiles.length === 0 && !inspection.complete) {
    return incompleteInventoryResult(TESTS_CHECK, "repository tests");
  }

  if (
    inspection.nodeProject &&
    manifest.state === "unavailable" &&
    testFiles.length > 0
  ) {
    return unavailableFileResult(TESTS_CHECK, "package.json");
  }

  if (testFiles.length > 0 && (!inspection.nodeProject || runnableTestScript)) {
    return execution([
      createRepositoryResult(TESTS_CHECK, {
        status: "Pass",
        severity: "Info",
        finding: inspection.nodeProject
          ? "Test files and a runnable npm test script are present."
          : "Recognized test files are present.",
        recommendation:
          "Keep the test suite runnable and aligned with implemented behavior.",
        evidence: testFiles.slice(0, 5),
      }),
    ]);
  }

  if (testFiles.length > 0) {
    return execution([
      createRepositoryResult(TESTS_CHECK, {
        status: "Warn",
        severity: "Low",
        finding:
          "Test files are present, but no runnable npm test script was found.",
        recommendation:
          "Add a non-placeholder npm test script that runs the repository test suite.",
        evidence: testFiles.slice(0, 5),
      }),
    ]);
  }

  return execution([
    createRepositoryResult(TESTS_CHECK, {
      status: "Warn",
      severity: "Medium",
      finding: runnableTestScript
        ? "A test script exists, but no recognized test files were found."
        : "No recognized test files were found.",
      recommendation:
        "Add automated tests in a conventional test location and ensure they are runnable from the project workflow.",
    }),
  ]);
}

function isCiPath(path: string): boolean {
  return (
    CI_ROOT_PATHS.has(path) ||
    /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(path) ||
    /^\.buildkite\/pipeline\.ya?ml$/i.test(path) ||
    /^\.circleci\/config\.ya?ml$/i.test(path) ||
    /^azure-pipelines\.ya?ml$/i.test(path) ||
    /^bitbucket-pipelines\.ya?ml$/i.test(path)
  );
}

export async function checkCi(
  inspection: RepositoryInspection,
): Promise<CheckExecution> {
  const candidates = inspection.entries
    .filter((entry) => entry.kind === "file" && isCiPath(entry.path))
    .map((entry) => entry.path);
  const nonempty: string[] = [];
  let unavailable = false;

  for (const candidate of candidates) {
    const content = await readRepositoryText(inspection, candidate);

    if (content.state === "ok" && content.content.trim().length > 0) {
      nonempty.push(candidate);
    } else if (
      content.state === "too-large" ||
      content.state === "unreadable"
    ) {
      unavailable = true;
    }
  }

  if (nonempty.length > 0) {
    return execution([
      createRepositoryResult(CI_CHECK, {
        status: "Pass",
        severity: "Info",
        finding: "Recognized nonempty CI configuration is present.",
        recommendation:
          "Keep CI configuration aligned with the verified local quality command.",
        evidence: nonempty,
      }),
    ]);
  }

  if (unavailable) {
    return unavailableFileResult(CI_CHECK, "CI configuration");
  }

  if (candidates.length === 0 && !inspection.complete) {
    return incompleteInventoryResult(CI_CHECK, "CI configuration");
  }

  return execution([
    createRepositoryResult(CI_CHECK, {
      status: "Warn",
      severity: "Low",
      finding:
        candidates.length === 0
          ? "No recognized CI configuration was found."
          : "Recognized CI configuration files are empty.",
      recommendation:
        "Add a CI pipeline that installs dependencies and runs the repository quality checks.",
      ...(candidates.length === 0 ? {} : { evidence: candidates }),
    }),
  ]);
}

function findReadme(inspection: RepositoryInspection): string | undefined {
  for (const preferredName of README_NAMES) {
    const exact = findRepositoryEntry(inspection, preferredName);

    if (exact?.kind === "file") {
      return exact.path;
    }

    const caseInsensitive = inspection.entries.find(
      (entry) =>
        entry.kind === "file" &&
        !entry.path.includes("/") &&
        entry.path.toLowerCase() === preferredName.toLowerCase(),
    );

    if (caseInsensitive !== undefined) {
      return caseInsensitive.path;
    }
  }

  return undefined;
}

function markdownHeadings(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const headings: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    const markdownHeading = /^#{1,6}\s+(.+)$/.exec(line);

    if (markdownHeading?.[1] !== undefined) {
      headings.push(markdownHeading[1].trim().toLowerCase());
      continue;
    }

    const nextLine = lines[index + 1]?.trim() ?? "";

    if (line.length > 0 && (/^=+$/.test(nextLine) || /^-+$/.test(nextLine))) {
      headings.push(line.toLowerCase());
      continue;
    }

    if (/^[A-Za-z][A-Za-z /-]+:$/.test(line)) {
      headings.push(line.slice(0, -1).toLowerCase());
    }
  }

  return headings;
}

function hasMeaningfulPurpose(content: string): boolean {
  const lines = content.replace(/```[\s\S]*?```/g, "").split(/\r?\n/);
  const purposeSectionPattern =
    /\b(about|description|introduction|overview|purpose|what is)\b/i;
  let currentSection: string | undefined;
  let paragraph: string[] = [];

  function paragraphIsPurpose(): boolean {
    const normalized = paragraph.join(" ").replace(/\s+/g, " ").trim();
    paragraph = [];

    return (
      normalized.length >= 40 &&
      /[A-Za-z]{3}/.test(normalized) &&
      (currentSection === undefined ||
        purposeSectionPattern.test(currentSection))
    );
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    const markdownHeading = /^(#{1,6})\s+(.+)$/.exec(line);

    if (
      markdownHeading?.[1] !== undefined &&
      markdownHeading[2] !== undefined
    ) {
      if (paragraphIsPurpose()) {
        return true;
      }

      currentSection =
        markdownHeading[1].length === 1 ? undefined : markdownHeading[2].trim();
      continue;
    }

    const nextLine = lines[index + 1]?.trim() ?? "";

    if (line.length > 0 && (/^=+$/.test(nextLine) || /^-+$/.test(nextLine))) {
      if (paragraphIsPurpose()) {
        return true;
      }

      currentSection = /^=+$/.test(nextLine) ? undefined : line;
      index += 1;
      continue;
    }

    if (/^[A-Za-z][A-Za-z /-]+:$/.test(line)) {
      if (paragraphIsPurpose()) {
        return true;
      }

      currentSection = line.slice(0, -1);
      continue;
    }

    if (line.length === 0) {
      if (paragraphIsPurpose()) {
        return true;
      }
      continue;
    }

    paragraph.push(line);
  }

  return paragraphIsPurpose();
}

export async function checkReadme(
  inspection: RepositoryInspection,
): Promise<CheckExecution> {
  const readme = findReadme(inspection);

  if (readme === undefined) {
    if (!inspection.rootComplete) {
      return incompleteInventoryResult(README_CHECK, "README");
    }

    return execution([
      createRepositoryResult(README_CHECK, {
        status: "Warn",
        severity: "Medium",
        finding: "No recognized README file was found at the repository root.",
        recommendation:
          "Add a README describing the project purpose, setup or development workflow, and usage.",
      }),
    ]);
  }

  const content = await readRepositoryText(inspection, readme);

  if (content.state !== "ok") {
    return unavailableFileResult(README_CHECK, readme);
  }

  const normalizedLength = content.content.replace(/\s+/g, "").length;

  if (normalizedLength === 0) {
    return execution([
      createRepositoryResult(README_CHECK, {
        subject: readme,
        status: "Warn",
        severity: "Medium",
        finding: `${readme} is empty.`,
        recommendation:
          "Document the project purpose, setup or development workflow, and usage.",
      }),
    ]);
  }

  const headings = markdownHeadings(content.content);
  const criteria = [
    {
      label: "meaningful content",
      satisfied: normalizedLength >= 120,
    },
    {
      label: "project purpose",
      satisfied: hasMeaningfulPurpose(content.content),
    },
    {
      label: "setup or development guidance",
      satisfied: headings.some((heading) =>
        /\b(development|getting started|install|prerequisites|setup)\b/.test(
          heading,
        ),
      ),
    },
    {
      label: "usage guidance",
      satisfied: headings.some((heading) =>
        /\b(commands?|examples?|quick start|run|usage)\b/.test(heading),
      ),
    },
  ];
  const missing = criteria.filter((criterion) => !criterion.satisfied);

  if (missing.length === 0) {
    return execution([
      createRepositoryResult(README_CHECK, {
        subject: readme,
        status: "Pass",
        severity: "Info",
        finding: `${readme} contains meaningful purpose, setup, and usage guidance.`,
        recommendation:
          "Keep README guidance synchronized with the verified implementation and workflow.",
        evidence: criteria.map((criterion) => `Present: ${criterion.label}`),
      }),
    ]);
  }

  return execution([
    createRepositoryResult(README_CHECK, {
      subject: readme,
      status: "Warn",
      severity: "Low",
      finding: `${readme} is missing ${missing
        .map((criterion) => criterion.label)
        .join(", ")}.`,
      recommendation:
        "Add the missing purpose, setup or development, and usage guidance without describing unimplemented behavior.",
      evidence: missing.map((criterion) => `Missing: ${criterion.label}`),
    }),
  ]);
}

export const repositoryGitignoreCheck = createRepositoryCheck(
  GITIGNORE_CHECK,
  (context) => checkGitignore(context.repository),
);

export const repositoryCodeStyleCheck = createRepositoryCheck(
  CODE_STYLE_CHECK,
  (context) => checkCodeStyle(context.repository),
);

export const repositoryTestsCheck = createRepositoryCheck(
  TESTS_CHECK,
  (context) => Promise.resolve(checkTests(context.repository)),
);

export const repositoryCiCheck = createRepositoryCheck(CI_CHECK, (context) =>
  checkCi(context.repository),
);

export const repositoryReadmeCheck = createRepositoryCheck(
  README_CHECK,
  (context) => checkReadme(context.repository),
);
