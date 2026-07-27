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

type CodeStyleCategory = "formatter" | "linter";
type CodeStyleTool =
  | "biome"
  | "clang-format"
  | "deno"
  | "dprint"
  | "eslint"
  | "golangci-lint"
  | "prettier"
  | "pylint"
  | "ruff"
  | "rustfmt"
  | "stylelint";

interface DetectedStyleConfig {
  readonly label: string;
  readonly tool: CodeStyleTool;
}

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

function styleToolForConfig(
  path: string,
  category: CodeStyleCategory,
): CodeStyleTool | undefined {
  if (path === "biome.json" || path === "biome.jsonc") {
    return "biome";
  }

  if (path === "deno.json" || path === "deno.jsonc") {
    return "deno";
  }

  if (RUFF_CONFIG_NAMES.includes(path as (typeof RUFF_CONFIG_NAMES)[number])) {
    return "ruff";
  }

  if (category === "linter") {
    if (path.startsWith(".eslintrc") || path.startsWith("eslint.config.")) {
      return "eslint";
    }

    if (
      path.startsWith(".stylelintrc") ||
      path.startsWith("stylelint.config.")
    ) {
      return "stylelint";
    }

    if (path.startsWith(".golangci.")) {
      return "golangci-lint";
    }

    if (path === ".pylintrc" || path === "pylintrc") {
      return "pylint";
    }

    return undefined;
  }

  if (path.startsWith(".prettierrc") || path.startsWith("prettier.config.")) {
    return "prettier";
  }

  if (path === ".clang-format") {
    return "clang-format";
  }

  if (path === ".rustfmt.toml" || path === "rustfmt.toml") {
    return "rustfmt";
  }

  if (
    path === ".dprint.json" ||
    path === ".dprint.jsonc" ||
    path === "dprint.json" ||
    path === "dprint.jsonc"
  ) {
    return "dprint";
  }

  return undefined;
}

function scriptInvokes(script: string, commandPattern: string): boolean {
  return new RegExp(
    `(?:^|[;&|])\\s*(?:(?:npx(?:\\s+--yes)?|npm\\s+exec(?:\\s+--)?)\\s+)?${commandPattern}(?=\\s|$)(?!\\s+(?:--\\s+)?(?:--help|--version|-h|-v)(?=\\s|$|[;&|]))`,
    "i",
  ).test(script);
}

function withoutTrailingShellComments(script: string): string {
  return script
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*#.*$/, "")
        .replace(/\s+#.*$/, "")
        .trimEnd(),
    )
    .join("\n")
    .trim();
}

function simpleSequentialSegments(script: string): readonly string[] {
  return withoutTrailingShellComments(script)
    .split(/\s*(?:;|\r?\n)\s*/)
    .filter((segment) => segment.length > 0);
}

type ObviousCommandOutcome = "exit" | "failure" | "success" | "unknown";

function obviousCommandOutcome(command: string): ObviousCommandOutcome {
  const normalized = command.trim().toLowerCase();

  if (/^exit(?:\s+\d+)?$/.test(normalized)) {
    return "exit";
  }

  if (
    /^(?::|true|(?:\/(?:usr\/)?bin\/)?true|command\s+true|echo(?:\s+.*)?|printf(?:\s+.*)?)$/.test(
      normalized,
    ) ||
    /^(?:ba|z|)sh\s+-c\s+(['"])(?::|true|exit(?:\s+0)?)\1$/.test(normalized) ||
    /^node\s+(?:--eval|-e)\s+(['"])(?:|process\.exit\(0\))\1$/.test(
      normalized,
    ) ||
    /^(?:(?:npx(?:\s+--yes)?|npm\s+exec(?:\s+--)?)\s+)?\S+(?:\s+--)?\s+(?:--help|--version|-h|-v)$/.test(
      normalized,
    )
  ) {
    return "success";
  }

  if (
    /^(?:false|(?:\/(?:usr\/)?bin\/)?false|command\s+false)$/.test(
      normalized,
    ) ||
    /^(?:ba|z|)sh\s+-c\s+(['"])(?:false|exit\s+0*[1-9]\d*)\1$/.test(
      normalized,
    ) ||
    /^node\s+(?:--eval|-e)\s+(['"])process\.exit\(0*[1-9]\d*\)\1$/.test(
      normalized,
    )
  ) {
    return "failure";
  }

  return "unknown";
}

function isObviousTrivialCommand(command: string): boolean {
  return obviousCommandOutcome(command) !== "unknown";
}

function definitelyReachesShellExit(segment: string): boolean {
  const parts = segment
    .split(/\s*(&&|\|\|)\s*/)
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return false;
  }

  let outcome = obviousCommandOutcome(parts[0] ?? "");

  if (outcome === "exit") {
    return true;
  }

  for (let index = 1; index + 1 < parts.length; index += 2) {
    const operator = parts[index];
    const nextOutcome = obviousCommandOutcome(parts[index + 1] ?? "");
    const executesNext =
      (operator === "&&" && outcome === "success") ||
      (operator === "||" && outcome === "failure");

    if (executesNext) {
      if (nextOutcome === "exit") {
        return true;
      }

      outcome = nextOutcome;
    } else if (!(
      (operator === "&&" && outcome === "failure") ||
      (operator === "||" && outcome === "success")
    )) {
      outcome = "unknown";
    }
  }

  return false;
}

function hasObviouslyUnreachableTail(script: string): boolean {
  const parts = withoutTrailingShellComments(script)
    .split(/\s*(&&|\|\|)\s*/)
    .filter((part) => part.length > 0);

  if (parts.length < 3) {
    return false;
  }

  let outcome = obviousCommandOutcome(parts[0] ?? "");

  for (let index = 1; index + 1 < parts.length; index += 2) {
    const operator = parts[index];

    if (
      outcome === "exit" ||
      (operator === "&&" && outcome === "failure") ||
      (operator === "||" && outcome === "success")
    ) {
      return true;
    }

    const executesNext =
      (operator === "&&" && outcome === "success") ||
      (operator === "||" && outcome === "failure");

    outcome = executesNext
      ? obviousCommandOutcome(parts[index + 1] ?? "")
      : "unknown";
  }

  return false;
}

function isRelevantStyleScriptName(
  name: string,
  category: CodeStyleCategory,
): boolean {
  const normalized = name.trim().toLowerCase();
  const relevantSegment =
    category === "linter" ? /^(?:check|lint)$/ : /^(?:fmt|format)$/;

  return normalized
    .split(/[:_-]/)
    .some((segment) => relevantSegment.test(segment));
}

function scriptSupportsStyleTool(
  name: string,
  script: string,
  tool: CodeStyleTool,
  category: CodeStyleCategory,
): boolean {
  if (!isRelevantStyleScriptName(name, category)) {
    return false;
  }

  const invokesTool = (segment: string): boolean => {
    switch (tool) {
      case "biome":
        return scriptInvokes(
          segment,
          category === "linter"
            ? "(?:@biomejs/)?biome\\s+(?:check|lint)"
            : "(?:@biomejs/)?biome\\s+(?:check|format)",
        );
      case "clang-format":
        return scriptInvokes(segment, "clang-format");
      case "deno":
        return scriptInvokes(
          segment,
          category === "linter" ? "deno\\s+lint" : "deno\\s+fmt",
        );
      case "dprint":
        return scriptInvokes(segment, "dprint");
      case "eslint":
        return scriptInvokes(segment, "eslint");
      case "golangci-lint":
        return scriptInvokes(segment, "golangci-lint");
      case "prettier":
        return scriptInvokes(segment, "prettier");
      case "pylint":
        return scriptInvokes(segment, "pylint");
      case "ruff":
        return scriptInvokes(
          segment,
          category === "linter" ? "ruff\\s+check" : "ruff\\s+format",
        );
      case "rustfmt":
        return (
          scriptInvokes(segment, "rustfmt") ||
          scriptInvokes(segment, "cargo\\s+fmt")
        );
      case "stylelint":
        return scriptInvokes(segment, "stylelint");
    }
  };

  for (const segment of simpleSequentialSegments(script)) {
    if (!hasObviouslyUnreachableTail(segment) && invokesTool(segment)) {
      return true;
    }

    if (definitelyReachesShellExit(segment)) {
      return false;
    }
  }

  return false;
}

function hasStyleToolSupport(
  inspection: RepositoryInspection,
  tool: CodeStyleTool,
  category: CodeStyleCategory,
): boolean {
  const manifest = inspection.packageManifest;

  if (manifest.state !== "valid") {
    return false;
  }

  const packageNames = new Set([
    ...Object.keys(manifest.data.dependencies),
    ...Object.keys(manifest.data.devDependencies),
    ...Object.keys(manifest.data.optionalDependencies),
  ]);
  const supportingPackages: Readonly<Record<CodeStyleTool, readonly string[]>> =
    {
      biome: ["@biomejs/biome"],
      "clang-format": ["clang-format"],
      deno: ["deno"],
      dprint: ["dprint"],
      eslint: ["eslint"],
      "golangci-lint": ["golangci-lint"],
      prettier: ["prettier"],
      pylint: ["pylint"],
      ruff: ["ruff"],
      rustfmt: ["rustfmt"],
      stylelint: ["stylelint"],
    };

  return (
    supportingPackages[tool].some((packageName) =>
      packageNames.has(packageName),
    ) ||
    Object.entries(manifest.data.scripts).some(([name, script]) =>
      scriptSupportsStyleTool(name, script, tool, category),
    )
  );
}

async function readableStyleConfigs(
  inspection: RepositoryInspection,
  category: CodeStyleCategory,
  names: ReadonlySet<string>,
  cache: Map<string, Awaited<ReturnType<typeof readRepositoryText>>>,
): Promise<{
  readonly configs: readonly DetectedStyleConfig[];
  readonly unavailable: boolean;
}> {
  const configs: DetectedStyleConfig[] = [];
  let unavailable = false;

  for (const path of configuredRootFiles(inspection, names)) {
    let content = cache.get(path);

    if (content === undefined) {
      content = await readRepositoryText(inspection, path);
      cache.set(path, content);
    }

    if (content.state === "ok" && content.content.trim().length > 0) {
      const tool = styleToolForConfig(path, category);

      if (tool !== undefined) {
        configs.push({
          label: path,
          tool,
        });
      }
    } else if (
      content.state === "too-large" ||
      content.state === "unreadable"
    ) {
      unavailable = true;
    }
  }

  return {
    configs,
    unavailable,
  };
}

export async function checkCodeStyle(
  inspection: RepositoryInspection,
): Promise<CheckExecution> {
  const contentCache = new Map<
    string,
    Awaited<ReturnType<typeof readRepositoryText>>
  >();
  const linterInspection = await readableStyleConfigs(
    inspection,
    "linter",
    LINTER_CONFIG_NAMES,
    contentCache,
  );
  const formatterInspection = await readableStyleConfigs(
    inspection,
    "formatter",
    FORMATTER_CONFIG_NAMES,
    contentCache,
  );
  const linterConfigs = [...linterInspection.configs];
  const formatterConfigs = [...formatterInspection.configs];
  let pyprojectUnavailable = false;

  if (hasRepositoryFile(inspection, "pyproject.toml")) {
    const pyproject = await readRepositoryText(inspection, "pyproject.toml");

    if (pyproject.state === "ok") {
      if (
        /^\s*\[\s*tool\.ruff(?:\.[^\]]+)?\s*\]\s*(?:#.*)?$/m.test(
          pyproject.content,
        )
      ) {
        linterConfigs.push({
          label: "pyproject.toml#tool.ruff",
          tool: "ruff",
        });
        formatterConfigs.push({
          label: "pyproject.toml#tool.ruff",
          tool: "ruff",
        });
      }
    } else {
      pyprojectUnavailable = true;
    }
  }

  const manifest = inspection.packageManifest;

  if (manifest.state === "valid") {
    if (manifest.data.hasEslintConfig) {
      linterConfigs.push({
        label: "package.json#eslintConfig",
        tool: "eslint",
      });
    }

    if (manifest.data.hasPrettierConfig) {
      formatterConfigs.push({
        label: "package.json#prettier",
        tool: "prettier",
      });
    }
  } else if (manifest.state === "unavailable") {
    return unavailableFileResult(CODE_STYLE_CHECK, "package.json");
  }

  if (
    (pyprojectUnavailable ||
      linterInspection.unavailable ||
      formatterInspection.unavailable) &&
    (linterConfigs.length === 0 || formatterConfigs.length === 0)
  ) {
    return unavailableFileResult(CODE_STYLE_CHECK, "code-style configuration");
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

  const supportedLinterConfigs = linterConfigs.filter((config) =>
    hasStyleToolSupport(inspection, config.tool, "linter"),
  );
  const supportedFormatterConfigs = formatterConfigs.filter((config) =>
    hasStyleToolSupport(inspection, config.tool, "formatter"),
  );
  const configured = [
    ...(linterConfigs.length > 0
      ? [
          `Readable linter config: ${linterConfigs
            .map((config) => config.label)
            .join(", ")}`,
        ]
      : []),
    ...(formatterConfigs.length > 0
      ? [
          `Readable formatter config: ${formatterConfigs
            .map((config) => config.label)
            .join(", ")}`,
        ]
      : []),
    ...(supportedLinterConfigs.length > 0
      ? [
          `Supporting linter declaration: ${[
            ...new Set(supportedLinterConfigs.map((config) => config.tool)),
          ].join(", ")}`,
        ]
      : []),
    ...(supportedFormatterConfigs.length > 0
      ? [
          `Supporting formatter declaration: ${[
            ...new Set(supportedFormatterConfigs.map((config) => config.tool)),
          ].join(", ")}`,
        ]
      : []),
  ];

  if (
    supportedLinterConfigs.length > 0 &&
    supportedFormatterConfigs.length > 0
  ) {
    return execution([
      createRepositoryResult(CODE_STYLE_CHECK, {
        status: "Pass",
        severity: "Info",
        finding:
          "Readable, nonempty linter and formatter configuration with supporting package or relevant npm-script evidence was detected at the repository root.",
        recommendation:
          "Keep the detected configuration and supporting tooling synchronized with the development workflow.",
        evidence: configured,
      }),
    ]);
  }

  const missing = [
    ...(linterConfigs.length === 0
      ? ["readable, nonempty linter configuration"]
      : supportedLinterConfigs.length === 0
        ? ["supporting linter dependency or relevant npm script"]
        : []),
    ...(formatterConfigs.length === 0
      ? ["readable, nonempty formatter configuration"]
      : supportedFormatterConfigs.length === 0
        ? ["supporting formatter dependency or relevant npm script"]
        : []),
  ];

  return execution([
    createRepositoryResult(CODE_STYLE_CHECK, {
      status: "Warn",
      severity: "Low",
      finding: `Sentinel could not establish ${missing.join(" and ")} at the repository root.`,
      recommendation:
        "Add readable, nonempty configuration and a matching package dependency or relevant npm script for both linting and formatting.",
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
    /\.(?:spec|test)\.(?:[cm]?[jt]sx?|py|go|rb|rs|java|kt|kts|scala|swift|php|cs|c|cc|cpp|cxx|h|hpp|sh|bash)$/i.test(
      fileName,
    ) ||
    /^test_.+\.py$/i.test(fileName) ||
    /_test\.(go|py)$/i.test(fileName)
  );
}

function isRunnableTestScript(script: string | undefined): boolean {
  if (script === undefined || script.trim().length === 0) {
    return false;
  }

  const normalized = withoutTrailingShellComments(script);

  if (normalized.length === 0) {
    return false;
  }

  for (const segment of simpleSequentialSegments(normalized)) {
    const lowerCaseSegment = segment.toLowerCase();
    const definitelyExits = definitelyReachesShellExit(segment);

    if (
      lowerCaseSegment.includes("no test specified") ||
      lowerCaseSegment.includes("no tests configured") ||
      /^echo\b.*\bexit\s+1\b/.test(lowerCaseSegment) ||
      hasObviouslyUnreachableTail(segment)
    ) {
      if (definitelyExits) {
        return false;
      }

      continue;
    }

    const commands = segment
      .split(/\s*(?:&&|\|\|)\s*/)
      .filter((command) => command.length > 0);

    if (
      commands.length > 0 &&
      commands.some((command) => !isObviousTrivialCommand(command))
    ) {
      return true;
    }

    if (definitelyExits) {
      return false;
    }
  }

  return false;
}

export async function checkTests(
  inspection: RepositoryInspection,
): Promise<CheckExecution> {
  const testFiles = inspection.entries
    .filter((entry) => entry.kind === "file" && isTestFile(entry.path))
    .map((entry) => entry.path)
    .sort();
  const nonemptyTestFiles: string[] = [];
  let unavailableTestFile: string | undefined;

  for (const testFile of testFiles) {
    const content = await readRepositoryText(inspection, testFile);

    if (content.state === "ok" && content.content.trim().length > 0) {
      nonemptyTestFiles.push(testFile);
    } else if (
      content.state === "too-large" ||
      content.state === "unreadable"
    ) {
      unavailableTestFile ??= testFile;
    }
  }

  const manifest = inspection.packageManifest;
  const testScript =
    manifest.state === "valid" ? manifest.data.scripts["test"] : undefined;
  const runnableTestScript = isRunnableTestScript(testScript);

  if (nonemptyTestFiles.length === 0 && unavailableTestFile !== undefined) {
    return unavailableFileResult(TESTS_CHECK, unavailableTestFile);
  }

  if (nonemptyTestFiles.length === 0 && !inspection.complete) {
    return incompleteInventoryResult(TESTS_CHECK, "repository tests");
  }

  if (
    inspection.nodeProject &&
    manifest.state === "unavailable" &&
    nonemptyTestFiles.length > 0
  ) {
    return unavailableFileResult(TESTS_CHECK, "package.json");
  }

  if (
    nonemptyTestFiles.length > 0 &&
    (!inspection.nodeProject || runnableTestScript)
  ) {
    return execution([
      createRepositoryResult(TESTS_CHECK, {
        status: "Pass",
        severity: "Info",
        finding: inspection.nodeProject
          ? "Test artifacts detected: readable, nonempty files and a non-placeholder npm test script are present."
          : "Test artifacts detected: readable, nonempty files are present.",
        recommendation:
          "Run the detected test workflow regularly and keep its artifacts aligned with implemented behavior.",
        evidence: nonemptyTestFiles.slice(0, 5),
      }),
    ]);
  }

  if (nonemptyTestFiles.length > 0) {
    return execution([
      createRepositoryResult(TESTS_CHECK, {
        status: "Warn",
        severity: "Low",
        finding:
          "Test artifacts detected: readable, nonempty files are present, but no non-placeholder npm test script was found.",
        recommendation:
          "Add a non-placeholder npm test script that runs the repository test suite.",
        evidence: nonemptyTestFiles.slice(0, 5),
      }),
    ]);
  }

  return execution([
    createRepositoryResult(TESTS_CHECK, {
      status: "Warn",
      severity: "Medium",
      finding:
        testFiles.length > 0
          ? "Recognized test filenames exist, but no readable, nonempty test artifacts were detected."
          : runnableTestScript
            ? "A non-placeholder npm test script was detected, but no readable, nonempty test artifacts were found."
            : "No readable, nonempty recognized test artifacts were found.",
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
  (context) => checkTests(context.repository),
);

export const repositoryCiCheck = createRepositoryCheck(CI_CHECK, (context) =>
  checkCi(context.repository),
);

export const repositoryReadmeCheck = createRepositoryCheck(
  README_CHECK,
  (context) => checkReadme(context.repository),
);
