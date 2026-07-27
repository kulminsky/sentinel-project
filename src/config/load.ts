import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";

import { ZodError, type ZodIssue } from "zod";

import { createSentinelConfigSchema, type SentinelConfig } from "./schema.js";

const DEFAULT_CONFIG_FILE_NAME = "sentinel.config.json";
const DEFAULT_ENV_FILE_NAME = ".env";

const STRING_ENVIRONMENT_MAPPINGS = [
  ["SENTINEL_TARGET_ROOT", ["target", "root"]],
  ["SENTINEL_REPORT_FORMAT", ["report", "format"]],
  ["SENTINEL_REPORT_PATH", ["report", "path"]],
  ["SENTINEL_API_BASE_URL", ["api", "baseUrl"]],
  ["SENTINEL_API_HEALTH_PATH", ["api", "healthPath"]],
  ["SENTINEL_API_OPENAPI_PATH", ["api", "openApiPath"]],
  ["SENTINEL_UI_BASE_URL", ["ui", "baseUrl"]],
  ["SENTINEL_AI_PROVIDER", ["ai", "provider"]],
] as const;

const NUMBER_ENVIRONMENT_MAPPINGS = [
  ["SENTINEL_API_TIMEOUT_MS", ["api", "timeoutMs"]],
  ["SENTINEL_API_LATENCY_THRESHOLD_MS", ["api", "latencyThresholdMs"]],
  ["SENTINEL_UI_TIMEOUT_MS", ["ui", "timeoutMs"]],
] as const;

const JSON_ENVIRONMENT_MAPPINGS = [
  ["SENTINEL_API_ENDPOINTS", ["api", "endpoints"]],
  ["SENTINEL_API_AUTHENTICATION", ["api", "authentication"]],
  ["SENTINEL_UI_PAGES", ["ui", "pages"]],
  ["SENTINEL_UI_VIEWPORTS", ["ui", "viewports"]],
  ["SENTINEL_UI_AUTHENTICATION", ["ui", "authentication"]],
  ["SENTINEL_UI_FORM_FLOWS", ["ui", "formFlows"]],
] as const;

const BOOLEAN_ENVIRONMENT_MAPPINGS = [
  ["SENTINEL_AI_ENABLED", ["ai", "enabled"]],
] as const;

const KNOWN_SENTINEL_ENVIRONMENT_KEYS = new Set<string>([
  ...STRING_ENVIRONMENT_MAPPINGS.map(([key]) => key),
  ...NUMBER_ENVIRONMENT_MAPPINGS.map(([key]) => key),
  ...JSON_ENVIRONMENT_MAPPINGS.map(([key]) => key),
  ...BOOLEAN_ENVIRONMENT_MAPPINGS.map(([key]) => key),
]);

export interface ConfigIssue {
  path: string;
  message: string;
}

export class SentinelConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(
      [
        "Invalid Sentinel configuration:",
        ...issues.map((issue) => `- ${issue.path}: ${issue.message}`),
      ].join("\n"),
    );
    this.name = "SentinelConfigError";
    this.issues = issues;
  }
}

export interface LoadSentinelConfigOptions {
  cwd?: string;
  configPath?: string;
  environment?: NodeJS.ProcessEnv;
}

export interface LoadedSentinelConfig {
  config: SentinelConfig;
  resolveEnvironmentReference: (name: string) => string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function readOptionalFile(
  path: string,
  required: boolean,
  issuePath: "configFile" | "envFile",
): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      if (!required) {
        return undefined;
      }

      throw new SentinelConfigError([
        {
          path: issuePath,
          message: "The explicitly requested file does not exist.",
        },
      ]);
    }

    throw new SentinelConfigError([
      {
        path: issuePath,
        message: "The file could not be read.",
      },
    ]);
  }
}

function parseConfigFile(content: string): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    throw new SentinelConfigError([
      {
        path: "configFile",
        message: "Expected valid JSON.",
      },
    ]);
  }

  if (!isRecord(parsed)) {
    throw new SentinelConfigError([
      {
        path: "configFile",
        message: "Expected a JSON object at the document root.",
      },
    ]);
  }

  return parsed;
}

function parseEnvironmentFile(content: string): Record<string, string> {
  const normalizedContent = content.replace(/^\uFEFF/u, "");
  validateEnvironmentFileSyntax(normalizedContent);

  try {
    const parsed = parseEnv(normalizedContent);
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
  } catch {
    throw new SentinelConfigError([
      {
        path: "envFile",
        message: "The .env file could not be parsed.",
      },
    ]);
  }
}

function validateEnvironmentFileSyntax(content: string): void {
  let openQuote: "'" | '"' | undefined;

  for (const rawLine of content.split(/\r?\n/u)) {
    if (openQuote !== undefined) {
      const closingQuoteIndex = findClosingQuoteIndex(rawLine, openQuote);
      if (closingQuoteIndex !== undefined) {
        validateQuotedValueSuffix(rawLine.slice(closingQuoteIndex + 1));
        openQuote = undefined;
      }
      continue;
    }

    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const assignment = /^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=(.*)$/u.exec(
      line,
    );
    if (assignment === null) {
      throw invalidEnvironmentFileError();
    }

    const value = assignment[1]?.trimStart() ?? "";
    const firstCharacter = value[0];
    if (firstCharacter === "'" || firstCharacter === '"') {
      const quotedValue = value.slice(1);
      const closingQuoteIndex = findClosingQuoteIndex(
        quotedValue,
        firstCharacter,
      );
      if (closingQuoteIndex === undefined) {
        openQuote = firstCharacter;
      } else {
        validateQuotedValueSuffix(quotedValue.slice(closingQuoteIndex + 1));
      }
    }
  }

  if (openQuote !== undefined) {
    throw invalidEnvironmentFileError();
  }
}

function findClosingQuoteIndex(
  value: string,
  quote: "'" | '"',
): number | undefined {
  const index = value.indexOf(quote);
  return index === -1 ? undefined : index;
}

function validateQuotedValueSuffix(value: string): void {
  const suffix = value.trimStart();
  if (suffix.length > 0 && !suffix.startsWith("#")) {
    throw invalidEnvironmentFileError();
  }
}

function invalidEnvironmentFileError(): SentinelConfigError {
  return new SentinelConfigError([
    {
      path: "envFile",
      message: "The .env file could not be parsed.",
    },
  ]);
}

function mergeEnvironment(
  environmentFile: Readonly<Record<string, string>>,
  processEnvironment: NodeJS.ProcessEnv,
): Record<string, string> {
  const merged = { ...environmentFile };

  for (const [key, value] of Object.entries(processEnvironment)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }

  return merged;
}

function setConfigPath(
  config: Record<string, unknown>,
  path: readonly string[],
  value: unknown,
): void {
  let current = config;

  for (const [index, segment] of path.slice(0, -1).entries()) {
    const existing = current[segment];
    if (existing === undefined) {
      const nested: Record<string, unknown> = {};
      current[segment] = nested;
      current = nested;
      continue;
    }

    if (!isRecord(existing)) {
      throw new SentinelConfigError([
        {
          path: path.slice(0, index + 1).join("."),
          message:
            "Expected an object before applying an environment override.",
        },
      ]);
    }

    current = existing;
  }

  const finalSegment = path.at(-1);
  if (finalSegment !== undefined) {
    current[finalSegment] = value;
  }
}

function parseEnvironmentNumber(key: string, value: string): number {
  if (value.trim().length === 0) {
    throw new SentinelConfigError([
      {
        path: `environment.${key}`,
        message: "Expected a number.",
      },
    ]);
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new SentinelConfigError([
      {
        path: `environment.${key}`,
        message: "Expected a number.",
      },
    ]);
  }

  return parsed;
}

function parseEnvironmentBoolean(key: string, value: string): boolean {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new SentinelConfigError([
    {
      path: `environment.${key}`,
      message: "Expected exactly 'true' or 'false'.",
    },
  ]);
}

function parseEnvironmentJson(key: string, value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new SentinelConfigError([
      {
        path: `environment.${key}`,
        message: "Expected valid JSON.",
      },
    ]);
  }
}

function applyEnvironmentOverrides(
  config: Record<string, unknown>,
  environment: Readonly<Record<string, string>>,
): void {
  for (const [key, path] of STRING_ENVIRONMENT_MAPPINGS) {
    const value = environment[key];
    if (value !== undefined) {
      setConfigPath(config, path, value);
    }
  }

  for (const [key, path] of NUMBER_ENVIRONMENT_MAPPINGS) {
    const value = environment[key];
    if (value !== undefined) {
      setConfigPath(config, path, parseEnvironmentNumber(key, value));
    }
  }

  for (const [key, path] of JSON_ENVIRONMENT_MAPPINGS) {
    const value = environment[key];
    if (value !== undefined) {
      setConfigPath(config, path, parseEnvironmentJson(key, value));
    }
  }

  for (const [key, path] of BOOLEAN_ENVIRONMENT_MAPPINGS) {
    const value = environment[key];
    if (value !== undefined) {
      setConfigPath(config, path, parseEnvironmentBoolean(key, value));
    }
  }
}

function formatPath(path: readonly PropertyKey[]): string {
  return path.length === 0 ? "configuration" : path.map(String).join(".");
}

function formatZodIssues(error: ZodError): ConfigIssue[] {
  const issues: ConfigIssue[] = [];

  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        issues.push({
          path: formatPath([...issue.path, key]),
          message: "Unknown configuration key.",
        });
      }
      continue;
    }

    issues.push({
      path: formatPath(issue.path),
      message: safeZodMessage(issue),
    });
  }

  return issues;
}

function safeZodMessage(issue: ZodIssue): string {
  if (issue.code === "invalid_type") {
    return "Value has the wrong type.";
  }

  if (issue.code === "invalid_value") {
    return "Value is not one of the supported options.";
  }

  return issue.message;
}

function collectEnvironmentReferences(
  value: unknown,
  references: Set<string>,
): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectEnvironmentReferences(item, references));
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  if (typeof value.env === "string") {
    references.add(value.env);
  }

  Object.values(value).forEach((item) =>
    collectEnvironmentReferences(item, references),
  );
}

function validateEnvironmentKeys(
  environment: Readonly<Record<string, string>>,
  config: SentinelConfig,
): void {
  const referencedEnvironmentVariables = new Set<string>();
  collectEnvironmentReferences(config, referencedEnvironmentVariables);

  const issues = Object.keys(environment)
    .filter(
      (key) =>
        key.startsWith("SENTINEL_") &&
        !KNOWN_SENTINEL_ENVIRONMENT_KEYS.has(key) &&
        !referencedEnvironmentVariables.has(key),
    )
    .sort()
    .map((key) => ({
      path: `environment.${key}`,
      message: "Unknown Sentinel environment variable.",
    }));

  if (issues.length > 0) {
    throw new SentinelConfigError(issues);
  }
}

export async function loadSentinelConfig(
  options: LoadSentinelConfigOptions = {},
): Promise<LoadedSentinelConfig> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const explicitConfigPath = options.configPath;

  if (
    explicitConfigPath !== undefined &&
    explicitConfigPath.trim().length === 0
  ) {
    throw new SentinelConfigError([
      {
        path: "configFile",
        message: "Expected a non-empty config path.",
      },
    ]);
  }

  const configPath = resolve(
    cwd,
    explicitConfigPath ?? DEFAULT_CONFIG_FILE_NAME,
  );
  const baseDirectory =
    explicitConfigPath === undefined ? cwd : dirname(configPath);
  const environmentPath = resolve(baseDirectory, DEFAULT_ENV_FILE_NAME);

  const [configContent, environmentContent] = await Promise.all([
    readOptionalFile(
      configPath,
      explicitConfigPath !== undefined,
      "configFile",
    ),
    readOptionalFile(environmentPath, false, "envFile"),
  ]);

  const rawConfig =
    configContent === undefined ? {} : parseConfigFile(configContent);
  const environmentFile =
    environmentContent === undefined
      ? {}
      : parseEnvironmentFile(environmentContent);
  const environment = mergeEnvironment(
    environmentFile,
    options.environment ?? process.env,
  );

  applyEnvironmentOverrides(rawConfig, environment);

  let config: SentinelConfig;
  try {
    config = createSentinelConfigSchema(baseDirectory, cwd).parse(rawConfig);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      throw new SentinelConfigError(formatZodIssues(error));
    }

    throw error;
  }

  validateEnvironmentKeys(environment, config);

  return {
    config,
    resolveEnvironmentReference: (name) => environment[name],
  };
}
