import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "vitest";

const CLI_PATH = resolve("dist/src/cli.js");

test("CLI exposes Commander help without running a scan", () => {
  const result = spawnSync(process.execPath, [CLI_PATH, "--help"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: sentinel/);
  assert.match(result.stdout, /Scan a local project/);
});

test("CLI rejects unknown options", () => {
  const result = spawnSync(process.execPath, [CLI_PATH, "--unknown"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown option '--unknown'/);
});

test("CLI rejects unexpected positional arguments", () => {
  const result = spawnSync(process.execPath, [CLI_PATH, "unexpected"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /too many arguments/);
});
