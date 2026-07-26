import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "vitest";

const CLI_PATH = resolve("dist/src/cli.js");

async function withTemporaryDirectory(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(resolve(tmpdir(), "sentinel-cli-test-"));

  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("CLI exposes Commander help without running a scan", () => {
  const result = spawnSync(process.execPath, [CLI_PATH, "--help"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: sentinel/);
  assert.match(result.stdout, /Scan a local project/);
  assert.match(result.stdout, /--config <path>/);
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

test("CLI uses configured target and report paths", async () => {
  await withTemporaryDirectory(async (directory) => {
    const configDirectory = resolve(directory, "configuration");
    const targetDirectory = resolve(directory, "target");
    const configPath = resolve(configDirectory, "custom.json");
    const reportPath = resolve(configDirectory, "configured-report.md");

    await mkdir(configDirectory, {
      recursive: true,
    });
    await mkdir(targetDirectory);
    await writeFile(
      resolve(targetDirectory, "README.md"),
      "# Configured target\n",
      "utf8",
    );
    await writeFile(
      configPath,
      JSON.stringify({
        target: {
          root: "../target",
        },
        report: {
          path: "./configured-report.md",
        },
        ai: {
          enabled: false,
        },
      }),
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      [CLI_PATH, "--config", configPath],
      {
        cwd: directory,
        encoding: "utf8",
        env: {},
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /configured-report\.md/);
    const report = await readFile(reportPath, "utf8");
    assert.match(report, /\*\*Target:\*\* target/);
    assert.match(report, /\*\*Status:\*\* Pass/);
  });
});

test("CLI writes a validated JSON report to the configured path", async () => {
  await withTemporaryDirectory(async (directory) => {
    const targetDirectory = resolve(directory, "target");
    const configPath = resolve(directory, "json.config.json");
    const reportPath = resolve(directory, "sentinel-report.json");

    await mkdir(targetDirectory);
    await writeFile(
      resolve(targetDirectory, "README.md"),
      "# JSON target\n",
      "utf8",
    );
    await writeFile(
      configPath,
      JSON.stringify({
        target: {
          root: "./target",
        },
        report: {
          format: "json",
          path: "./sentinel-report.json",
        },
        ai: {
          enabled: false,
        },
      }),
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      [CLI_PATH, "--config", configPath],
      {
        cwd: directory,
        encoding: "utf8",
        env: {},
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /sentinel-report\.json/);
    const report = JSON.parse(await readFile(reportPath, "utf8")) as Record<
      string,
      unknown
    >;
    assert.ok(report.overallSummary);
    assert.ok(Array.isArray(report.results));
  });
});

test("CLI renders a full terminal report without writing a file", async () => {
  await withTemporaryDirectory(async (directory) => {
    const targetDirectory = resolve(directory, "target");
    const configPath = resolve(directory, "terminal.config.json");

    await mkdir(targetDirectory);
    await writeFile(
      resolve(targetDirectory, "README.md"),
      "# Terminal target\n",
      "utf8",
    );
    await writeFile(
      configPath,
      JSON.stringify({
        target: {
          root: "./target",
        },
        report: {
          format: "terminal",
        },
        ai: {
          enabled: false,
        },
      }),
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      [CLI_PATH, "--config", configPath],
      {
        cwd: directory,
        encoding: "utf8",
        env: {},
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^SENTINEL QUALITY REPORT\n/);
    assert.match(result.stdout, /OVERALL SUMMARY/);
    assert.match(result.stdout, /Status: Skipped/);
    assert.match(result.stdout, /Finding:/);
    assert.match(result.stdout, /Severity: Info/);
    assert.match(result.stdout, /Recommendation:/);
    assert.equal(result.stdout.includes("report written"), false);
    assert.equal(result.stdout.includes(String.fromCodePoint(27)), false);
    await assert.rejects(readFile(resolve(directory, "sentinel-report.md")));
  });
});

test("CLI reports path-specific configuration errors before scanning", async () => {
  await withTemporaryDirectory(async (directory) => {
    const configPath = resolve(directory, "invalid.json");
    await writeFile(
      configPath,
      JSON.stringify({
        unsupported: true,
      }),
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      [CLI_PATH, "--config", configPath],
      {
        cwd: directory,
        encoding: "utf8",
        env: {},
      },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /unsupported: Unknown configuration key/);
    assert.equal(result.stdout.includes("Sentinel report written"), false);
  });
});
