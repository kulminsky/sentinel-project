import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import {
  MAX_INSPECTED_FILE_BYTES,
  inspectRepository,
  readRepositoryText,
} from "../src/repository/inspection.js";

async function withTemporaryRepository(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "sentinel-inventory-test-"));

  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("inventory is deterministic, excludes generated trees, and does not follow symlinks", async () => {
  await withTemporaryRepository(async (root) => {
    await mkdir(join(root, "src"));
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "src", "z.ts"), "export {};\n", "utf8");
    await writeFile(join(root, "src", "a.ts"), "export {};\n", "utf8");
    await writeFile(
      join(root, "node_modules", "ignored.js"),
      "ignored\n",
      "utf8",
    );
    await symlink(
      join(root, "node_modules", "ignored.js"),
      join(root, "linked.txt"),
    );

    const inspection = await inspectRepository(root);

    assert.deepEqual(
      inspection.entries.map((entry) => entry.path),
      ["linked.txt", "node_modules", "src", "src/a.ts", "src/z.ts"],
    );
    assert.equal(inspection.complete, true);
    assert.equal(inspection.typescriptProject, true);
    assert.equal(
      (await readRepositoryText(inspection, "linked.txt")).state,
      "missing",
    );
  });
});

test("inventory reports entry bounds instead of walking indefinitely", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(join(root, "a.txt"), "a\n", "utf8");
    await writeFile(join(root, "b.txt"), "b\n", "utf8");
    await writeFile(join(root, "c.txt"), "c\n", "utf8");

    const inspection = await inspectRepository(root, {
      maxEntries: 2,
    });

    assert.equal(inspection.complete, false);
    assert.equal(inspection.rootComplete, false);
    assert.deepEqual(inspection.issues, ["entry-limit"]);
    assert.equal(inspection.entries.length, 2);
  });
});

test("bounded reader rejects oversized files without returning content", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "README.md"),
      Buffer.alloc(MAX_INSPECTED_FILE_BYTES + 1, "x"),
    );
    const inspection = await inspectRepository(root);
    const result = await readRepositoryText(inspection, "README.md");

    assert.equal(result.state, "too-large");
    assert.equal("content" in result, false);
  });
});
