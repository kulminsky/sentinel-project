import { constants, type Dirent } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const MAX_INVENTORY_DEPTH = 8;
export const MAX_INVENTORY_ENTRIES = 20_000;
export const INVENTORY_TIMEOUT_MS = 5_000;
export const MAX_INSPECTED_FILE_BYTES = 128 * 1024;

const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".cache",
  ".git",
  ".next",
  ".parcel-cache",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

export type RepositoryEntryKind = "directory" | "file" | "symlink";
export type RepositoryInventoryIssue =
  "depth-limit" | "entry-limit" | "timeout" | "unreadable-directory";

export interface RepositoryEntry {
  readonly path: string;
  readonly kind: RepositoryEntryKind;
}

interface RepositoryFileIndex {
  readonly root: string;
  readonly entries: readonly RepositoryEntry[];
}

export interface PackageManifestData {
  readonly scripts: Readonly<Record<string, string>>;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
  readonly optionalDependencies: Readonly<Record<string, string>>;
  readonly packageManager?: string;
  readonly hasEslintConfig: boolean;
  readonly hasPrettierConfig: boolean;
}

export type PackageManifest =
  | {
      readonly state: "absent";
    }
  | {
      readonly state: "invalid";
    }
  | {
      readonly state: "unavailable";
      readonly reason: "too-large" | "unreadable";
    }
  | {
      readonly state: "valid";
      readonly data: PackageManifestData;
    };

export interface RepositoryInspection {
  readonly root: string;
  readonly entries: readonly RepositoryEntry[];
  readonly complete: boolean;
  readonly rootComplete: boolean;
  readonly issues: readonly RepositoryInventoryIssue[];
  readonly nodeProject: boolean;
  readonly typescriptProject: boolean;
  readonly packageManifest: PackageManifest;
}

export interface InspectRepositoryOptions {
  readonly maxDepth?: number;
  readonly maxEntries?: number;
  readonly timeoutMs?: number;
}

export type BoundedTextResult =
  | {
      readonly state: "ok";
      readonly content: string;
    }
  | {
      readonly state: "missing";
    }
  | {
      readonly state: "too-large";
    }
  | {
      readonly state: "unreadable";
    };

class InventoryTimeoutError extends Error {}

function toRepositoryPath(parts: readonly string[]): string {
  return parts.join("/");
}

function entryKind(entry: Dirent<string>): RepositoryEntryKind | undefined {
  if (entry.isFile()) {
    return "file";
  }

  if (entry.isDirectory()) {
    return "directory";
  }

  if (entry.isSymbolicLink()) {
    return "symlink";
  }

  return undefined;
}

async function readdirBeforeDeadline(
  directory: string,
  deadline: number,
): Promise<Dirent<string>[]> {
  const remainingMs = deadline - performance.now();

  if (remainingMs <= 0) {
    throw new InventoryTimeoutError();
  }

  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new InventoryTimeoutError()),
      remainingMs,
    );
  });

  try {
    return await Promise.race([
      readdir(directory, { withFileTypes: true }),
      timeoutPromise,
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function isInsideRoot(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);

  return (
    relativePath.length === 0 ||
    (!isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`))
  );
}

export function findRepositoryEntry(
  inspection: RepositoryFileIndex,
  path: string,
): RepositoryEntry | undefined {
  return inspection.entries.find((entry) => entry.path === path);
}

export function hasRepositoryFile(
  inspection: RepositoryFileIndex,
  path: string,
): boolean {
  return findRepositoryEntry(inspection, path)?.kind === "file";
}

export async function readRepositoryText(
  inspection: RepositoryFileIndex,
  path: string,
  maxBytes = MAX_INSPECTED_FILE_BYTES,
): Promise<BoundedTextResult> {
  if (!hasRepositoryFile(inspection, path)) {
    return {
      state: "missing",
    };
  }

  const absolutePath = resolve(inspection.root, path);

  if (!isInsideRoot(inspection.root, absolutePath)) {
    return {
      state: "unreadable",
    };
  }

  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    handle = await open(
      absolutePath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const fileStat = await handle.stat();

    if (!fileStat.isFile()) {
      return {
        state: "unreadable",
      };
    }

    if (fileStat.size > maxBytes) {
      return {
        state: "too-large",
      };
    }

    const content = await handle.readFile({
      encoding: "utf8",
    });

    return {
      state: "ok",
      content: content.replace(/^\uFEFF/, ""),
    };
  } catch {
    return {
      state: "unreadable",
    };
  } finally {
    try {
      await handle?.close();
    } catch {
      // A close failure must not expose a raw filesystem error or crash a check.
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringRecord(
  value: unknown,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value);

  if (entries.some(([, entryValue]) => typeof entryValue !== "string")) {
    return undefined;
  }

  return Object.fromEntries(entries) as Readonly<Record<string, string>>;
}

async function inspectPackageManifest(
  inspection: RepositoryFileIndex,
): Promise<PackageManifest> {
  if (!hasRepositoryFile(inspection, "package.json")) {
    return {
      state: "absent",
    };
  }

  const content = await readRepositoryText(inspection, "package.json");

  if (content.state === "too-large" || content.state === "unreadable") {
    return {
      state: "unavailable",
      reason: content.state,
    };
  }

  if (content.state !== "ok") {
    return {
      state: "absent",
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

  if (!isRecord(parsed)) {
    return {
      state: "invalid",
    };
  }

  const scripts = stringRecord(parsed["scripts"]);
  const dependencies = stringRecord(parsed["dependencies"]);
  const devDependencies = stringRecord(parsed["devDependencies"]);
  const optionalDependencies = stringRecord(parsed["optionalDependencies"]);
  const packageManager = parsed["packageManager"];

  if (
    scripts === undefined ||
    dependencies === undefined ||
    devDependencies === undefined ||
    optionalDependencies === undefined ||
    (packageManager !== undefined &&
      (typeof packageManager !== "string" ||
        packageManager.trim().length === 0))
  ) {
    return {
      state: "invalid",
    };
  }

  return {
    state: "valid",
    data: {
      scripts,
      dependencies,
      devDependencies,
      optionalDependencies,
      ...(packageManager === undefined ? {} : { packageManager }),
      hasEslintConfig: isRecord(parsed["eslintConfig"]),
      hasPrettierConfig: isRecord(parsed["prettier"]),
    },
  };
}

export async function inspectRepository(
  root: string,
  options: InspectRepositoryOptions = {},
): Promise<RepositoryInspection> {
  const maxDepth = options.maxDepth ?? MAX_INVENTORY_DEPTH;
  const maxEntries = options.maxEntries ?? MAX_INVENTORY_ENTRIES;
  const timeoutMs = options.timeoutMs ?? INVENTORY_TIMEOUT_MS;
  const entries: RepositoryEntry[] = [];
  const issues = new Set<RepositoryInventoryIssue>();
  const deadline = performance.now() + timeoutMs;
  let stopped = false;
  let rootComplete = false;

  async function walk(parts: readonly string[], depth: number): Promise<void> {
    if (stopped) {
      return;
    }

    let directoryEntries: Dirent<string>[];

    try {
      directoryEntries = await readdirBeforeDeadline(
        resolve(root, ...parts),
        deadline,
      );
    } catch (error: unknown) {
      if (error instanceof InventoryTimeoutError) {
        issues.add("timeout");
        stopped = true;
        return;
      }

      if (parts.length === 0) {
        throw error;
      }

      issues.add("unreadable-directory");
      return;
    }

    directoryEntries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of directoryEntries) {
      if (entries.length >= maxEntries) {
        issues.add("entry-limit");
        stopped = true;
        return;
      }

      const kind = entryKind(entry);

      if (kind === undefined) {
        continue;
      }

      const entryParts = [...parts, entry.name];
      entries.push({
        path: toRepositoryPath(entryParts),
        kind,
      });

      if (kind !== "directory" || EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
        continue;
      }

      if (depth >= maxDepth) {
        issues.add("depth-limit");
        continue;
      }

      await walk(entryParts, depth + 1);

      if (stopped) {
        return;
      }
    }

    if (parts.length === 0) {
      rootComplete = true;
    }
  }

  await walk([], 0);
  entries.sort((left, right) => left.path.localeCompare(right.path));

  const baseInspection = {
    root,
    entries,
    complete: issues.size === 0,
    rootComplete,
    issues: [...issues].sort(),
  };
  const packageManifest = await inspectPackageManifest(baseInspection);
  const nodeProject = entries.some(
    (entry) => entry.path === "package.json" && entry.kind === "file",
  );
  const typescriptProject =
    entries.some(
      (entry) => entry.path === "tsconfig.json" && entry.kind === "file",
    ) ||
    entries.some(
      (entry) =>
        entry.kind === "file" &&
        (entry.path.endsWith(".ts") || entry.path.endsWith(".tsx")),
    );

  return {
    ...baseInspection,
    nodeProject,
    typescriptProject,
    packageManifest,
  };
}
