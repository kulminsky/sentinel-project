import { basename, extname } from "node:path";

import createIgnore from "ignore";

import {
  hasRepositoryFile,
  readRepositoryText,
  type RepositoryInspection,
} from "../../repository/inspection.js";

const ENVIRONMENT_TEMPLATE_NAMES = new Set([
  ".env.example",
  ".env.sample",
  ".env.template",
]);
const EXCLUDED_FILE_NAMES = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);
const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".cts",
  ".env",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".kts",
  ".md",
  ".mjs",
  ".mts",
  ".php",
  ".properties",
  ".ps1",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
]);

export type IgnorePolicy =
  | {
      readonly state: "available";
      readonly ignores: (path: string) => boolean;
    }
  | {
      readonly state: "absent";
      readonly ignores: (path: string) => boolean;
    }
  | {
      readonly state: "unavailable";
    };

export function isEnvironmentTemplate(path: string): boolean {
  return ENVIRONMENT_TEMPLATE_NAMES.has(basename(path).toLowerCase());
}

export function isRealEnvironmentFile(path: string): boolean {
  const name = basename(path).toLowerCase();
  return (
    (name === ".env" || name.startsWith(".env.")) &&
    !ENVIRONMENT_TEMPLATE_NAMES.has(name)
  );
}

export function isEnvironmentFile(path: string): boolean {
  return isRealEnvironmentFile(path) || isEnvironmentTemplate(path);
}

export function isSecretScannableFile(path: string): boolean {
  const name = basename(path).toLowerCase();

  if (
    EXCLUDED_FILE_NAMES.has(name) ||
    name.endsWith(".map") ||
    /\.(?:min|bundle)\.[^.]+$/i.test(name)
  ) {
    return false;
  }

  return (
    isEnvironmentFile(path) ||
    TEXT_EXTENSIONS.has(extname(name)) ||
    [".gitignore", "dockerfile", "makefile"].includes(name)
  );
}

export function isNodeSourceFile(path: string): boolean {
  if (
    /(?:^|\/)(?:__tests__|fixtures?|spec|test|tests)(?:\/|$)/i.test(path) ||
    /(?:^|\/)public\//i.test(path) ||
    /\.(?:spec|test)\.[^/]+$/i.test(path)
  ) {
    return false;
  }

  return /\.(?:[cm]?[jt]sx?)$/i.test(path);
}

export async function loadIgnorePolicy(
  inspection: RepositoryInspection,
): Promise<IgnorePolicy> {
  if (!hasRepositoryFile(inspection, ".gitignore")) {
    return {
      state: "absent",
      ignores: () => false,
    };
  }

  const content = await readRepositoryText(inspection, ".gitignore");

  if (content.state !== "ok") {
    return {
      state: "unavailable",
    };
  }

  try {
    const matcher = createIgnore().add(content.content);
    return {
      state: "available",
      ignores: (path: string) => matcher.ignores(path),
    };
  } catch {
    return {
      state: "unavailable",
    };
  }
}
