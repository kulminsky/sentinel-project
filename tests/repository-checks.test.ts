import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import {
  checkDependencyFreshness,
  checkLockfile,
  checkTsconfigStrictness,
  type NpmOutdatedRunner,
} from "../src/checks/repository/node.js";
import {
  checkCi,
  checkCodeStyle,
  checkGitignore,
  checkReadme,
  checkTests,
} from "../src/checks/repository/static.js";
import {
  MAX_INSPECTED_FILE_BYTES,
  inspectRepository,
} from "../src/repository/inspection.js";

const GOOD_README = `# Fixture

This fixture demonstrates a small project used to verify Sentinel repository analysis without relying on any running service.

## Development Setup

Install the declared dependencies and run the local quality checks before changing the fixture.

## Usage

Run the project verification command and review the generated quality report.
`;

async function withTemporaryRepository(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "sentinel-check-test-"));

  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("gitignore validates applicable patterns without reading environment contents", async () => {
  await withTemporaryRepository(async (root) => {
    await writeJson(join(root, "package.json"), {
      name: "fixture",
    });
    await writeFile(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          outDir: "dist",
        },
      }),
      "utf8",
    );
    await mkdir(join(root, "dist"));
    await writeFile(
      join(root, ".gitignore"),
      "**/.env\n.DS_Store\nnode_modules/\ndist/\n",
      "utf8",
    );
    const credentialLikeValue = "fixture-secret-must-not-appear";
    await writeFile(join(root, ".env"), credentialLikeValue, "utf8");

    const result = await checkGitignore(await inspectRepository(root));

    assert.equal(result.results[0]?.status, "Pass");
    assert.equal(JSON.stringify(result).includes(credentialLikeValue), false);
  });
});

test("gitignore reports missing baseline coverage", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, ".gitignore"),
      ".env\n!.env\n.DS_Store\n",
      "utf8",
    );

    const result = await checkGitignore(await inspectRepository(root));

    assert.equal(result.results[0]?.status, "Warn");
    assert.match(result.results[0]?.finding ?? "", /environment files/);
  });
});

test("gitignore checks a TypeScript outDir inherited through extends", async () => {
  await withTemporaryRepository(async (root) => {
    await writeJson(join(root, "tsconfig.base.json"), {
      compilerOptions: {
        outDir: "generated",
      },
    });
    await writeJson(join(root, "tsconfig.json"), {
      extends: "./tsconfig.base.json",
    });
    await mkdir(join(root, "generated"));
    await writeFile(join(root, ".gitignore"), ".env\n.DS_Store\n", "utf8");

    const result = await checkGitignore(await inspectRepository(root));

    assert.equal(result.results[0]?.status, "Warn");
    assert.match(result.results[0]?.finding ?? "", /TypeScript output/);
  });
});

test("code style requires both linter and formatter configuration", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(join(root, "eslint.config.mjs"), "export default [];\n");
    await writeFile(join(root, ".prettierrc.json"), "{}\n");
    await writeJson(join(root, "package.json"), {
      devDependencies: {
        eslint: "1.0.0",
        prettier: "1.0.0",
      },
    });

    const pass = await checkCodeStyle(await inspectRepository(root));
    assert.equal(pass.results[0]?.status, "Pass");

    await rm(join(root, ".prettierrc.json"));
    const warning = await checkCodeStyle(await inspectRepository(root));
    assert.equal(warning.results[0]?.status, "Warn");
    assert.match(warning.results[0]?.finding ?? "", /formatter/);
  });
});

test("code style recognizes package-embedded configuration", async () => {
  await withTemporaryRepository(async (root) => {
    await writeJson(join(root, "package.json"), {
      devDependencies: {
        eslint: "1.0.0",
        prettier: "1.0.0",
      },
      eslintConfig: {
        root: true,
      },
      prettier: {
        semi: true,
      },
    });

    const result = await checkCodeStyle(await inspectRepository(root));
    assert.equal(result.results[0]?.status, "Pass");
  });
});

test("code style recognizes supported Stylelint and Ruff configuration forms", async () => {
  const cases = [
    {
      files: {
        "stylelint.config.mjs": "export default {};\n",
        ".prettierrc": "{}\n",
        "package.json": JSON.stringify({
          devDependencies: {
            stylelint: "1.0.0",
            prettier: "1.0.0",
          },
        }),
      },
    },
    {
      files: {
        "ruff.toml": "line-length = 88\n",
        "package.json": JSON.stringify({
          scripts: {
            lint: "ruff check .",
            format: "ruff format .",
          },
        }),
      },
    },
    {
      files: {
        "pyproject.toml": "[tool.ruff]\nline-length = 88\n",
        "package.json": JSON.stringify({
          scripts: {
            lint: "ruff check .",
            format: "ruff format .",
          },
        }),
      },
    },
  ] as const;

  for (const fixture of cases) {
    await withTemporaryRepository(async (root) => {
      for (const [path, content] of Object.entries(fixture.files)) {
        await writeFile(join(root, path), content, "utf8");
      }

      const result = await checkCodeStyle(await inspectRepository(root));

      assert.equal(result.results[0]?.status, "Pass");
    });
  }
});

test("code style does not pass empty or unsupported filename-only configuration", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(join(root, "eslint.config.mjs"), " \n", "utf8");
    await writeFile(join(root, ".prettierrc"), "\n", "utf8");

    const empty = await checkCodeStyle(await inspectRepository(root));

    assert.equal(empty.results[0]?.status, "Warn");
    assert.match(empty.results[0]?.finding ?? "", /readable, nonempty/);

    await writeFile(join(root, "eslint.config.mjs"), "export default [];\n");
    await writeFile(join(root, ".prettierrc"), "{}\n", "utf8");

    const filenameOnly = await checkCodeStyle(await inspectRepository(root));

    assert.equal(filenameOnly.results[0]?.status, "Warn");
    assert.match(
      filenameOnly.results[0]?.finding ?? "",
      /supporting linter dependency or relevant npm script/,
    );
    assert.match(
      filenameOnly.results[0]?.finding ?? "",
      /supporting formatter dependency or relevant npm script/,
    );

    await writeJson(join(root, "package.json"), {
      devDependencies: {
        eslint: "1.0.0",
        prettier: "1.0.0",
      },
    });
    await writeFile(
      join(root, "eslint.config.mjs"),
      "x".repeat(MAX_INSPECTED_FILE_BYTES + 1),
      "utf8",
    );

    const oversizedConfig = await checkCodeStyle(await inspectRepository(root));

    assert.equal(oversizedConfig.results[0]?.status, "Skipped");
    assert.equal(oversizedConfig.incomplete, true);
  });
});

test("code style rejects irrelevant, informational, and unreachable npm script evidence", async () => {
  const cases = [
    {
      scripts: {
        postinstall: "eslint --version && prettier --version",
      },
      dependencies: {},
      missing:
        /supporting linter dependency or relevant npm script.*supporting formatter dependency or relevant npm script/,
    },
    {
      scripts: {
        lint: "eslint --version",
      },
      dependencies: {
        prettier: "1.0.0",
      },
      missing: /supporting linter dependency or relevant npm script/,
    },
    {
      scripts: {
        format: "prettier --help",
      },
      dependencies: {
        eslint: "1.0.0",
      },
      missing: /supporting formatter dependency or relevant npm script/,
    },
    {
      scripts: {
        lint: "exit 0; eslint .",
      },
      dependencies: {
        prettier: "1.0.0",
      },
      missing: /supporting linter dependency or relevant npm script/,
    },
    {
      scripts: {
        format: "true || prettier --write .",
      },
      dependencies: {
        eslint: "1.0.0",
      },
      missing: /supporting formatter dependency or relevant npm script/,
    },
    {
      scripts: {
        lint: "false && eslint .",
      },
      dependencies: {
        prettier: "1.0.0",
      },
      missing: /supporting linter dependency or relevant npm script/,
    },
    {
      scripts: {
        format: "exit 1; prettier --write .",
      },
      dependencies: {
        eslint: "1.0.0",
      },
      missing: /supporting formatter dependency or relevant npm script/,
    },
    {
      scripts: {
        lint: "echo prep; exit 0; eslint .",
      },
      dependencies: {
        prettier: "1.0.0",
      },
      missing: /supporting linter dependency or relevant npm script/,
    },
    {
      scripts: {
        lint: "echo prep; false && eslint .",
      },
      dependencies: {
        prettier: "1.0.0",
      },
      missing: /supporting linter dependency or relevant npm script/,
    },
    {
      scripts: {
        format: "echo prep; exit 0; prettier --write .",
      },
      dependencies: {
        eslint: "1.0.0",
      },
      missing: /supporting formatter dependency or relevant npm script/,
    },
    {
      scripts: {
        lint: "npm exec eslint -- --version",
      },
      dependencies: {
        prettier: "1.0.0",
      },
      missing: /supporting linter dependency or relevant npm script/,
    },
    {
      scripts: {
        format: "npm exec prettier -- --help",
      },
      dependencies: {
        eslint: "1.0.0",
      },
      missing: /supporting formatter dependency or relevant npm script/,
    },
    {
      scripts: {
        lint: "eslint --version || eslint .",
      },
      dependencies: {
        prettier: "1.0.0",
      },
      missing: /supporting linter dependency or relevant npm script/,
    },
    {
      scripts: {
        format: "prettier --version || prettier --write .",
      },
      dependencies: {
        eslint: "1.0.0",
      },
      missing: /supporting formatter dependency or relevant npm script/,
    },
    {
      scripts: {
        lint: "echo done # ; eslint .",
      },
      dependencies: {
        prettier: "1.0.0",
      },
      missing: /supporting linter dependency or relevant npm script/,
    },
    {
      scripts: {
        format: "echo done # ; prettier --write .",
      },
      dependencies: {
        eslint: "1.0.0",
      },
      missing: /supporting formatter dependency or relevant npm script/,
    },
    {
      scripts: {
        lint: "sh -c 'false' && eslint .",
      },
      dependencies: {
        prettier: "1.0.0",
      },
      missing: /supporting linter dependency or relevant npm script/,
    },
    {
      scripts: {
        format: "sh -c 'false' && prettier --write .",
      },
      dependencies: {
        eslint: "1.0.0",
      },
      missing: /supporting formatter dependency or relevant npm script/,
    },
    {
      scripts: {
        lint: "node -e 'process.exit(1)' && eslint .",
      },
      dependencies: {
        prettier: "1.0.0",
      },
      missing: /supporting linter dependency or relevant npm script/,
    },
    {
      scripts: {
        format: "node -e 'process.exit(1)' && prettier --write .",
      },
      dependencies: {
        eslint: "1.0.0",
      },
      missing: /supporting formatter dependency or relevant npm script/,
    },
    {
      scripts: {
        lint: "true && exit 0; eslint .",
      },
      dependencies: {
        prettier: "1.0.0",
      },
      missing: /supporting linter dependency or relevant npm script/,
    },
    {
      scripts: {
        format: "false || exit 1; prettier --write .",
      },
      dependencies: {
        eslint: "1.0.0",
      },
      missing: /supporting formatter dependency or relevant npm script/,
    },
    {
      scripts: {
        lint: "echo prep || eslint .",
      },
      dependencies: {
        prettier: "1.0.0",
      },
      missing: /supporting linter dependency or relevant npm script/,
    },
    {
      scripts: {
        format: "printf ok || prettier --write .",
      },
      dependencies: {
        eslint: "1.0.0",
      },
      missing: /supporting formatter dependency or relevant npm script/,
    },
  ] as const;

  for (const fixture of cases) {
    await withTemporaryRepository(async (root) => {
      await writeFile(
        join(root, "eslint.config.mjs"),
        "export default [];\n",
        "utf8",
      );
      await writeFile(join(root, ".prettierrc"), "{}\n", "utf8");
      await writeJson(join(root, "package.json"), {
        scripts: fixture.scripts,
        devDependencies: fixture.dependencies,
      });

      const result = await checkCodeStyle(await inspectRepository(root));

      assert.equal(
        result.results[0]?.status,
        "Warn",
        `Unexpected style-script classification: ${JSON.stringify(fixture.scripts)}`,
      );
      assert.match(result.results[0]?.finding ?? "", fixture.missing);
    });
  }
});

test("code style accepts reachable tool commands after earlier compound clauses", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(
      join(root, "eslint.config.mjs"),
      "export default [];\n",
      "utf8",
    );
    await writeFile(join(root, ".prettierrc"), "{}\n", "utf8");
    await writeJson(join(root, "package.json"), {
      scripts: {
        lint: "eslint --version || true; eslint .",
        format: "prettier --version || true; prettier --write .",
      },
    });

    const result = await checkCodeStyle(await inspectRepository(root));

    assert.equal(result.results[0]?.status, "Pass");
  });
});

test("test presence validates Node test files and a runnable script", async () => {
  await withTemporaryRepository(async (root) => {
    await mkdir(join(root, "tests"));
    await writeFile(join(root, "tests", "feature.test.ts"), "export {};\n");
    await writeJson(join(root, "package.json"), {
      scripts: {
        test: "vitest run",
      },
    });

    const pass = await checkTests(await inspectRepository(root));
    assert.equal(pass.results[0]?.status, "Pass");
    assert.match(pass.results[0]?.finding ?? "", /test artifacts detected/i);
    assert.doesNotMatch(pass.results[0]?.finding ?? "", /tests? passed/i);

    await writeJson(join(root, "package.json"), {
      scripts: {
        test: 'echo "Error: no test specified" && exit 1',
      },
    });
    const warning = await checkTests(await inspectRepository(root));
    assert.equal(warning.results[0]?.status, "Warn");
    assert.equal(warning.results[0]?.severity, "Low");
  });
});

test("test presence rejects obvious no-op scripts with nonempty artifacts", async () => {
  const noOpScripts = [
    "true",
    "exit 0",
    ":",
    "/bin/true",
    'echo "nothing to run" && exit 0',
    "exit 0; vitest run",
    "exit 1; vitest run",
    "true || vitest run",
    "false && vitest run",
    "echo prep; exit 0; vitest run",
    "exit 0\nvitest run",
    "false",
    "exit 1",
    "npm --version",
    "true # deliberate no-op",
    "npm --version || vitest run",
    "sh -c 'true' || vitest run",
    "node -e 'process.exit(0)' || vitest run",
    "sh -c 'false' && vitest run",
    "node -e 'process.exit(1)' && vitest run",
    "# vitest run",
    "# vitest run\ntrue",
    "# vitest run\nexit 0",
    "true && exit 0; vitest run",
    "false || exit 1; vitest run",
    "echo prep || vitest run",
    "printf ok || vitest run",
  ];

  for (const testScript of noOpScripts) {
    await withTemporaryRepository(async (root) => {
      await mkdir(join(root, "tests"));
      await writeFile(
        join(root, "tests", "feature.test.ts"),
        "export {};\n",
        "utf8",
      );
      await writeJson(join(root, "package.json"), {
        scripts: {
          test: testScript,
        },
      });

      const result = await checkTests(await inspectRepository(root));

      assert.equal(
        result.results[0]?.status,
        "Warn",
        `Unexpected test-script classification: ${JSON.stringify(testScript)}`,
      );
      assert.equal(result.results[0]?.severity, "Low");
      assert.match(
        result.results[0]?.finding ?? "",
        /no non-placeholder npm test script/i,
      );
    });
  }
});

test("test presence accepts a reachable test command after an earlier failed branch", async () => {
  await withTemporaryRepository(async (root) => {
    await mkdir(join(root, "tests"));
    await writeFile(
      join(root, "tests", "feature.test.ts"),
      "export {};\n",
      "utf8",
    );
    await writeJson(join(root, "package.json"), {
      scripts: {
        test: "false && echo skipped; vitest run",
      },
    });

    const result = await checkTests(await inspectRepository(root));

    assert.equal(result.results[0]?.status, "Pass");
  });
});

test("test presence rejects empty artifacts independently of script evidence", async () => {
  await withTemporaryRepository(async (root) => {
    await mkdir(join(root, "tests"));
    await writeFile(join(root, "tests", "empty.test.ts"), " \n", "utf8");
    await writeJson(join(root, "package.json"), {
      scripts: {
        test: "vitest run",
      },
    });

    const result = await checkTests(await inspectRepository(root));

    assert.equal(result.results[0]?.status, "Warn");
    assert.equal(result.results[0]?.severity, "Medium");
    assert.match(
      result.results[0]?.finding ?? "",
      /no readable, nonempty test artifacts/i,
    );
  });
});

test("test presence ignores non-code files with test-like names", async () => {
  const paths = ["sample.test.png", "notes.spec.txt"];

  for (const path of paths) {
    await withTemporaryRepository(async (root) => {
      await writeFile(join(root, path), "not executable test source\n", "utf8");
      await writeJson(join(root, "package.json"), {
        scripts: {
          test: "vitest run",
        },
      });

      const result = await checkTests(await inspectRepository(root));

      assert.equal(
        result.results[0]?.status,
        "Warn",
        `Unexpected test-artifact classification: ${JSON.stringify(path)}`,
      );
      assert.equal(result.results[0]?.severity, "Medium");
      assert.match(
        result.results[0]?.finding ?? "",
        /no readable, nonempty test artifacts/i,
      );
    });
  }
});

test("test presence does not pass an artifact outside the readable size bound", async () => {
  await withTemporaryRepository(async (root) => {
    await mkdir(join(root, "tests"));
    await writeFile(
      join(root, "tests", "oversized.test.ts"),
      "x".repeat(MAX_INSPECTED_FILE_BYTES + 1),
      "utf8",
    );
    await writeJson(join(root, "package.json"), {
      scripts: {
        test: "vitest run",
      },
    });

    const result = await checkTests(await inspectRepository(root));

    assert.equal(result.results[0]?.status, "Skipped");
    assert.equal(
      result.results[0]?.diagnosticCode,
      "REPOSITORY_FILE_UNAVAILABLE",
    );
    assert.equal(result.incomplete, true);
  });
});

test("test absence is a medium warning", async () => {
  await withTemporaryRepository(async (root) => {
    const result = await checkTests(await inspectRepository(root));

    assert.equal(result.results[0]?.status, "Warn");
    assert.equal(result.results[0]?.severity, "Medium");
  });
});

test("test presence ignores placeholder files in conventional directories", async () => {
  await withTemporaryRepository(async (root) => {
    await mkdir(join(root, "tests"));
    await writeFile(join(root, "tests", ".gitkeep"), "", "utf8");

    const result = await checkTests(await inspectRepository(root));

    assert.equal(result.results[0]?.status, "Warn");
    assert.equal(result.results[0]?.severity, "Medium");
    assert.equal(JSON.stringify(result).includes(".gitkeep"), false);
  });
});

test("incomplete inventory prevents a false test-absence warning", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(join(root, "a.txt"), "a\n", "utf8");
    await writeFile(join(root, "b.txt"), "b\n", "utf8");
    const inspection = await inspectRepository(root, {
      maxEntries: 1,
    });
    const result = await checkTests(inspection);

    assert.equal(result.results[0]?.status, "Skipped");
    assert.equal(
      result.results[0]?.diagnosticCode,
      "REPOSITORY_INVENTORY_INCOMPLETE",
    );
    assert.equal(result.incomplete, true);

    const codeStyle = await checkCodeStyle(inspection);
    assert.equal(codeStyle.results[0]?.status, "Skipped");
    assert.equal(codeStyle.incomplete, true);

    let freshnessCalled = false;
    const freshness = await checkDependencyFreshness(
      inspection,
      new AbortController().signal,
      () => {
        freshnessCalled = true;
        return Promise.resolve({
          state: "unavailable",
        });
      },
    );
    assert.equal(freshnessCalled, false);
    assert.equal(freshness.results[0]?.status, "Skipped");
    assert.equal(freshness.incomplete, true);
  });
});

test("CI check distinguishes nonempty, empty, and missing configuration", async () => {
  await withTemporaryRepository(async (root) => {
    await mkdir(join(root, ".github", "workflows"), {
      recursive: true,
    });
    const workflow = join(root, ".github", "workflows", "ci.yml");
    await writeFile(workflow, "name: CI\n", "utf8");

    const pass = await checkCi(await inspectRepository(root));
    assert.equal(pass.results[0]?.status, "Pass");

    await writeFile(workflow, " \n", "utf8");
    const empty = await checkCi(await inspectRepository(root));
    assert.equal(empty.results[0]?.status, "Warn");
    assert.match(empty.results[0]?.finding ?? "", /empty/);

    await rm(join(root, ".github"), {
      recursive: true,
    });
    const missing = await checkCi(await inspectRepository(root));
    assert.equal(missing.results[0]?.status, "Warn");
  });
});

test("tsconfig strictness resolves extends and rejects explicit strict overrides", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(join(root, "index.ts"), "export {};\n", "utf8");
    await writeJson(join(root, "tsconfig.base.json"), {
      compilerOptions: {
        strict: true,
      },
    });
    await writeJson(join(root, "tsconfig.json"), {
      extends: "./tsconfig.base.json",
    });

    const pass = await checkTsconfigStrictness(await inspectRepository(root));
    assert.equal(pass.results[0]?.status, "Pass");

    await writeJson(join(root, "tsconfig.json"), {
      extends: "./tsconfig.base.json",
      compilerOptions: {
        strictNullChecks: false,
      },
    });
    const warning = await checkTsconfigStrictness(
      await inspectRepository(root),
    );
    assert.equal(warning.results[0]?.status, "Warn");
    assert.match(warning.results[0]?.finding ?? "", /strictNullChecks/);

    await writeJson(join(root, "tsconfig.json"), {
      compilerOptions: {
        strict: true,
        strictBuiltinIteratorReturn: false,
      },
    });
    const iteratorWarning = await checkTsconfigStrictness(
      await inspectRepository(root),
    );
    assert.equal(iteratorWarning.results[0]?.status, "Warn");
    assert.match(
      iteratorWarning.results[0]?.finding ?? "",
      /strictBuiltinIteratorReturn/,
    );
  });
});

test("tsconfig resolution rejects an extended config through a symlinked parent", async () => {
  const outsideRoot = await mkdtemp(
    join(tmpdir(), "sentinel-tsconfig-outside-test-"),
  );

  try {
    await writeJson(join(outsideRoot, "base.json"), {
      compilerOptions: {
        strict: true,
      },
    });
    await withTemporaryRepository(async (root) => {
      await writeFile(join(root, "index.ts"), "export {};\n", "utf8");
      await symlink(outsideRoot, join(root, "linked-config"), "dir");
      await writeJson(join(root, "tsconfig.json"), {
        extends: "./linked-config/base.json",
      });

      const result = await checkTsconfigStrictness(
        await inspectRepository(root),
      );

      assert.equal(result.results[0]?.status, "Warn");
      assert.equal(result.results[0]?.diagnosticCode, "TSCONFIG_INVALID");
    });
  } finally {
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("tsconfig strictness skips a complete non-TypeScript repository", async () => {
  await withTemporaryRepository(async (root) => {
    const result = await checkTsconfigStrictness(await inspectRepository(root));

    assert.equal(result.results[0]?.status, "Skipped");
    assert.equal(
      result.results[0]?.diagnosticCode,
      "TYPESCRIPT_PROJECT_NOT_DETECTED",
    );
    assert.equal(result.incomplete, false);
  });
});

test("tsconfig strictness reports missing and invalid root configuration", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(join(root, "index.ts"), "export {};\n", "utf8");

    const missing = await checkTsconfigStrictness(
      await inspectRepository(root),
    );
    assert.equal(missing.results[0]?.status, "Warn");
    assert.match(missing.results[0]?.finding ?? "", /without a root/);

    await writeFile(join(root, "tsconfig.json"), "{ invalid", "utf8");
    const invalid = await checkTsconfigStrictness(
      await inspectRepository(root),
    );
    assert.equal(invalid.results[0]?.status, "Warn");
    assert.equal(invalid.results[0]?.diagnosticCode, "TSCONFIG_INVALID");
  });
});

async function npmInspection(root: string) {
  await writeJson(join(root, "package.json"), {
    dependencies: {
      alpha: "^1.0.0",
      beta: "^1.0.0",
    },
  });

  return inspectRepository(root);
}

test("dependency freshness maps npm output into package-specific findings", async () => {
  await withTemporaryRepository(async (root) => {
    const inspection = await npmInspection(root);
    const runner: NpmOutdatedRunner = () =>
      Promise.resolve({
        state: "completed",
        exitCode: 1,
        stdout: JSON.stringify({
          alpha: {
            current: "1.0.0",
            wanted: "1.1.0",
            latest: "2.0.0",
          },
          beta: {
            current: "1.0.0",
            wanted: "1.0.0",
            latest: "2.0.0",
          },
        }),
      });

    const result = await checkDependencyFreshness(
      inspection,
      new AbortController().signal,
      runner,
    );

    assert.deepEqual(
      result.results.map((entry) => [
        entry.subject,
        entry.status,
        entry.severity,
      ]),
      [
        ["alpha", "Warn", "Medium"],
        ["beta", "Warn", "Low"],
      ],
    );
  });
});

test("dependency freshness passes empty output and isolates unavailable queries", async () => {
  await withTemporaryRepository(async (root) => {
    const inspection = await npmInspection(root);
    const fresh = await checkDependencyFreshness(
      inspection,
      new AbortController().signal,
      () =>
        Promise.resolve({
          state: "completed",
          exitCode: 0,
          stdout: "{}",
        }),
    );
    assert.equal(fresh.results[0]?.status, "Pass");

    const unavailable = await checkDependencyFreshness(
      inspection,
      new AbortController().signal,
      () =>
        Promise.resolve({
          state: "unavailable",
        }),
    );
    assert.equal(unavailable.results[0]?.status, "Skipped");
    assert.equal(unavailable.incomplete, false);
  });
});

test("dependency freshness ignores configured-workspace dependencies", async () => {
  await withTemporaryRepository(async (root) => {
    const inspection = await npmInspection(root);
    const result = await checkDependencyFreshness(
      inspection,
      new AbortController().signal,
      () =>
        Promise.resolve({
          state: "completed",
          exitCode: 1,
          stdout: JSON.stringify({
            "workspace-only": {
              current: "1.0.0",
              wanted: "1.1.0",
              latest: "2.0.0",
            },
          }),
        }),
    );

    assert.equal(result.results.length, 1);
    assert.equal(result.results[0]?.status, "Pass");
    assert.match(result.results[0]?.finding ?? "", /root dependencies/);
    assert.equal(JSON.stringify(result).includes("workspace-only"), false);
  });
});

test("dependency freshness marks invalid successful output incomplete", async () => {
  await withTemporaryRepository(async (root) => {
    const inspection = await npmInspection(root);
    const result = await checkDependencyFreshness(
      inspection,
      new AbortController().signal,
      () =>
        Promise.resolve({
          state: "completed",
          exitCode: 0,
          stdout: "not-json",
        }),
    );

    assert.equal(result.results[0]?.status, "Skipped");
    assert.equal(
      result.results[0]?.diagnosticCode,
      "DEPENDENCY_FRESHNESS_INVALID_RESPONSE",
    );
    assert.equal(result.incomplete, true);
  });
});

test("dependency freshness treats npm error envelopes and empty exit-one output as unavailable", async () => {
  await withTemporaryRepository(async (root) => {
    const inspection = await npmInspection(root);
    const errorEnvelope = await checkDependencyFreshness(
      inspection,
      new AbortController().signal,
      () =>
        Promise.resolve({
          state: "completed",
          exitCode: 1,
          stdout: JSON.stringify({
            error: {
              code: "ENETUNREACH",
            },
          }),
        }),
    );
    assert.equal(errorEnvelope.results[0]?.status, "Skipped");
    assert.equal(errorEnvelope.incomplete, false);

    const empty = await checkDependencyFreshness(
      inspection,
      new AbortController().signal,
      () =>
        Promise.resolve({
          state: "completed",
          exitCode: 1,
          stdout: "",
        }),
    );
    assert.equal(empty.results[0]?.status, "Skipped");
    assert.equal(empty.incomplete, false);
  });
});

test("dependency freshness bounds detailed findings", async () => {
  await withTemporaryRepository(async (root) => {
    const dependencies = Object.fromEntries(
      Array.from({ length: 26 }, (_, index) => [
        `package-${String(index).padStart(2, "0")}`,
        "^1.0.0",
      ]),
    );
    await writeJson(join(root, "package.json"), {
      dependencies,
    });
    const output = Object.fromEntries(
      Object.keys(dependencies).map((name) => [
        name,
        {
          current: "1.0.0",
          wanted: "1.0.0",
          latest: "2.0.0",
        },
      ]),
    );
    const result = await checkDependencyFreshness(
      await inspectRepository(root),
      new AbortController().signal,
      () =>
        Promise.resolve({
          state: "completed",
          exitCode: 1,
          stdout: JSON.stringify(output),
        }),
    );

    assert.equal(result.results.length, 26);
    assert.equal(result.results.at(-1)?.subject, "Additional dependencies");
  });
});

test("non-npm projects skip freshness without invoking npm", async () => {
  await withTemporaryRepository(async (root) => {
    await writeJson(join(root, "package.json"), {
      packageManager: "pnpm@10.0.0",
      dependencies: {
        alpha: "^1.0.0",
      },
    });
    let called = false;
    const result = await checkDependencyFreshness(
      await inspectRepository(root),
      new AbortController().signal,
      () => {
        called = true;
        return Promise.resolve({
          state: "unavailable",
        });
      },
    );

    assert.equal(called, false);
    assert.equal(result.results[0]?.status, "Skipped");
    assert.equal(result.results[0]?.diagnosticCode, "NPM_PROJECT_NOT_DETECTED");
  });
});

test("lockfile-only Yarn and pnpm projects skip npm freshness", async () => {
  const cases = [
    {
      lockfile: "yarn.lock",
      content: "# yarn lockfile\n",
    },
    {
      lockfile: "pnpm-lock.yaml",
      content: "lockfileVersion: 9\n",
    },
  ] as const;

  for (const fixture of cases) {
    await withTemporaryRepository(async (root) => {
      await writeJson(join(root, "package.json"), {
        dependencies: {
          alpha: "^1.0.0",
        },
      });
      await writeFile(join(root, fixture.lockfile), fixture.content, "utf8");
      const inspection = await inspectRepository(root);
      let freshnessCalled = false;
      const freshness = await checkDependencyFreshness(
        inspection,
        new AbortController().signal,
        () => {
          freshnessCalled = true;
          return Promise.resolve({
            state: "completed",
            exitCode: 0,
            stdout: "{}",
          });
        },
      );
      const lockfile = await checkLockfile(inspection);

      assert.equal(freshnessCalled, false);
      assert.equal(freshness.results[0]?.status, "Skipped");
      assert.equal(
        freshness.results[0]?.diagnosticCode,
        "NPM_PROJECT_NOT_DETECTED",
      );
      assert.equal(lockfile.results[0]?.status, "Pass");
      assert.doesNotMatch(lockfile.results[0]?.finding ?? "", /does not match/);
    });
  }
});

test("npm lockfile validates root manifest consistency", async () => {
  await withTemporaryRepository(async (root) => {
    await writeJson(join(root, "package.json"), {
      dependencies: {
        alpha: "^1.0.0",
      },
    });
    await writeJson(join(root, "package-lock.json"), {
      lockfileVersion: 3,
      packages: {
        "": {
          dependencies: {
            alpha: "^1.0.0",
          },
        },
        "node_modules/alpha": {
          version: "1.0.1",
        },
      },
    });

    const pass = await checkLockfile(await inspectRepository(root));
    assert.equal(pass.results[0]?.status, "Pass");

    await writeJson(join(root, "package-lock.json"), {
      lockfileVersion: 3,
      packages: {
        "": {
          dependencies: {
            alpha: "^2.0.0",
          },
        },
      },
    });
    const warning = await checkLockfile(await inspectRepository(root));
    assert.equal(warning.results[0]?.status, "Warn");
    assert.match(warning.results[0]?.finding ?? "", /do not match/);
  });
});

test("lockfile detects malformed and conflicting files", async () => {
  await withTemporaryRepository(async (root) => {
    await writeJson(join(root, "package.json"), {});
    await writeFile(join(root, "package-lock.json"), "not-json\n", "utf8");

    const malformed = await checkLockfile(await inspectRepository(root));
    assert.equal(malformed.results[0]?.status, "Warn");

    await writeFile(join(root, "yarn.lock"), "# lock\n", "utf8");
    const conflict = await checkLockfile(await inspectRepository(root));
    assert.equal(conflict.results[0]?.status, "Warn");
    assert.match(conflict.results[0]?.finding ?? "", /Multiple/);
  });
});

test("lockfile skips generic repositories and accepts a single non-npm lockfile", async () => {
  await withTemporaryRepository(async (root) => {
    const notApplicable = await checkLockfile(await inspectRepository(root));
    assert.equal(notApplicable.results[0]?.status, "Skipped");

    await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    const recognized = await checkLockfile(await inspectRepository(root));
    assert.equal(recognized.results[0]?.status, "Pass");
  });
});

test("README quality distinguishes complete, weak, missing, and oversized files", async () => {
  await withTemporaryRepository(async (root) => {
    await writeFile(join(root, "README.md"), GOOD_README, "utf8");
    const pass = await checkReadme(await inspectRepository(root));
    assert.equal(pass.results[0]?.status, "Pass");

    await writeFile(join(root, "README.md"), "# Fixture\n", "utf8");
    const weak = await checkReadme(await inspectRepository(root));
    assert.equal(weak.results[0]?.status, "Warn");
    assert.equal(weak.results[0]?.severity, "Low");

    await writeFile(
      join(root, "README.md"),
      `# Fixture

## Setup

Install dependencies, configure the local development environment, and verify every required prerequisite before continuing.

## Usage

Run the documented project command and inspect its generated output during the normal development workflow.
`,
      "utf8",
    );
    const missingPurpose = await checkReadme(await inspectRepository(root));
    assert.equal(missingPurpose.results[0]?.status, "Warn");
    assert.match(missingPurpose.results[0]?.finding ?? "", /project purpose/);

    await rm(join(root, "README.md"));
    const missing = await checkReadme(await inspectRepository(root));
    assert.equal(missing.results[0]?.status, "Warn");
    assert.equal(missing.results[0]?.severity, "Medium");

    await writeFile(
      join(root, "README.md"),
      Buffer.alloc(MAX_INSPECTED_FILE_BYTES + 1, "x"),
    );
    const oversized = await checkReadme(await inspectRepository(root));
    assert.equal(oversized.results[0]?.status, "Skipped");
    assert.equal(oversized.incomplete, true);
  });
});
