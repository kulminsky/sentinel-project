import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import * as ts from "typescript";

import {
  MAX_INSPECTED_FILE_BYTES,
  hasRepositoryFile,
  readRepositoryText,
  type RepositoryInspection,
} from "../../repository/inspection.js";

export type ResolvedTypescriptConfig =
  | {
      readonly state: "missing";
    }
  | {
      readonly state: "unavailable";
    }
  | {
      readonly state: "invalid";
    }
  | {
      readonly state: "valid";
      readonly parsed: ts.ParsedCommandLine;
    };

function isInsideRoot(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);

  return (
    relativePath.length === 0 ||
    (!isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`))
  );
}

function readConfigFileSafely(
  inspection: RepositoryInspection,
  fileName: string,
): string | undefined {
  const root = resolve(inspection.root);
  const resolved = isAbsolute(fileName)
    ? resolve(fileName)
    : resolve(root, fileName);

  if (!isInsideRoot(root, resolved)) {
    return undefined;
  }

  try {
    const relativePath = relative(root, resolved);
    const repositoryPath = relativePath.split(sep).join("/");

    if (
      repositoryPath.length === 0 ||
      !hasRepositoryFile(inspection, repositoryPath)
    ) {
      return undefined;
    }

    const canonicalRoot = realpathSync(root);
    const canonicalPath = realpathSync(resolved);
    const expectedCanonicalPath = resolve(canonicalRoot, relativePath);

    if (
      canonicalPath !== expectedCanonicalPath ||
      !isInsideRoot(canonicalRoot, canonicalPath)
    ) {
      return undefined;
    }

    const fileStat = lstatSync(canonicalPath);

    if (
      !fileStat.isFile() ||
      fileStat.isSymbolicLink() ||
      fileStat.size > MAX_INSPECTED_FILE_BYTES
    ) {
      return undefined;
    }

    return readFileSync(canonicalPath, "utf8").replace(/^\uFEFF/, "");
  } catch {
    return undefined;
  }
}

export async function resolveRootTypescriptConfig(
  inspection: RepositoryInspection,
): Promise<ResolvedTypescriptConfig> {
  if (!hasRepositoryFile(inspection, "tsconfig.json")) {
    return {
      state: "missing",
    };
  }

  const rootConfig = await readRepositoryText(inspection, "tsconfig.json");

  if (rootConfig.state !== "ok") {
    return {
      state: "unavailable",
    };
  }

  const diagnostics: ts.Diagnostic[] = [];
  const configPath = resolve(inspection.root, "tsconfig.json");
  const host: ts.ParseConfigFileHost = {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    getCurrentDirectory: () => inspection.root,
    readDirectory: () => [],
    fileExists: (fileName) =>
      readConfigFileSafely(inspection, fileName) !== undefined,
    readFile: (fileName) =>
      fileName === configPath
        ? rootConfig.content
        : readConfigFileSafely(inspection, fileName),
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      diagnostics.push(diagnostic);
    },
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, host);
  const errors = [...diagnostics, ...(parsed?.errors ?? [])].filter(
    (diagnostic) =>
      diagnostic.category === ts.DiagnosticCategory.Error &&
      diagnostic.code !== 18003,
  );

  if (parsed === undefined || errors.length > 0) {
    return {
      state: "invalid",
    };
  }

  return {
    state: "valid",
    parsed,
  };
}
