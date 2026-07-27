# Sentinel

Sentinel is a local TypeScript CLI that reviews a software project across code
and repository hygiene, security, API/backend behavior, and browser-visible UI
quality. It favors bounded, explainable checks and graceful degradation over
broad claims it cannot support.

## Current status

The reviewable MVP is implemented. It includes a runnable CLI, strict
configuration, four concurrent analysis levels, a deliberately flawed sample
application, a tracked sample report, optional AI-assisted semantic test-gap
analysis, and an optional Docker demo.

The codebase and this README describe what exists today; the supporting
documents are mapped below.

Packaging is complete. Remaining submission verification is limited to a
clearly Cursor-identified evidence capture, a clean public-clone run, and
publishing the final documentation commit.

Choose the path that matches your goal:

- **Reviewers:** run the [sample application](#sample-application), inspect the
  [sample report](docs/sample-report.md), review the
  [development evidence](docs/evidence/README.md), and read the
  [architecture](docs/architecture.md).
- **Users:** follow the [quick start](#quick-start), then use the
  [configuration reference](docs/configuration.md), optional
  [Docker guide](docs/docker.md), or [AI safety guidance](#ai-assisted-semantic-test-gap-analysis).
- **Contributors:** [verify the repository](#verify-the-repository), then read
  the [architecture](docs/architecture.md), [decisions](docs/decisions.md), and
  [agent instructions](AGENTS.md).

## Quick start

Prerequisites are Git and Node.js 20.19 or later, including npm.

Linux, macOS, or WSL Bash:

```bash
git --version
node --version
npm --version
git clone https://github.com/kulminsky/sentinel-project.git
cd sentinel-project
npm install
npm start
```

Native Windows Command Prompt:

```bat
git --version
node --version
npm --version
git clone https://github.com/kulminsky/sentinel-project.git
cd sentinel-project
npm install
npm start
```

`npm install` also performs a script-disabled, lockfile-based install for the
standalone sample package. It does not download a Playwright browser.
`npm start` builds Sentinel, scans the invocation directory, and writes
`sentinel-report.md`.

The default scan needs no configuration, API key, browser, or running service.
AI is disabled. Missing optional services, npm, or registry access becomes a
visible skipped result instead of crashing the scan.

### Reports and exit codes

Sentinel renders exactly one report from a shared runtime-validated model:

- Markdown is the default and writes `sentinel-report.md` unless another path
  is configured.
- JSON requires an explicit output path.
- Terminal format writes the complete plain-text report to stdout and forbids
  an output path.

Every result, including a skipped result, has a nonempty status, finding,
severity, and recommendation. Every format includes the same normalized
overall summary and results.

Exit code `0` means Sentinel completed its reporting contract; it does not mean
that every check passed. Findings, ordinary skips, unreachable optional
services, and isolated check failures remain report content. A nonzero exit is
reserved for fatal tool errors such as invalid invocation or configuration, an
unreadable target, or a report render/write failure.

### Scan a configured target

Sentinel never starts or stops target services. Start any required service
separately, then select its configuration.

Linux, macOS, or WSL Bash:

```bash
npm start -- --config ./path/to/sentinel.config.json
```

Native Windows Command Prompt:

```bat
npm start -- --config .\path\to\sentinel.config.json
```

Configuration is recursively strict. Process environment values override
`.env`, which overrides JSON, which overrides the clean-run target and
Markdown-report defaults. Invalid, incomplete, conflicting, or unknown
supplied values are fatal and identify the affected property.

The full JSON shape, environment mappings, authentication references, path
rules, and report examples are in
[`docs/configuration.md`](docs/configuration.md).

### Verify the repository

The same command works in Bash and Windows Command Prompt:

```text
npm run check
```

It verifies formatting, linting, Sentinel tests, and the standalone sample
package.

## Sample application

`sample-app/` is a standalone Express/TypeScript fixture with intentional,
deterministic problems in repository hygiene, dependency security, API
behavior, and browser behavior. Sentinel does not manage its process.

Install Chromium once before the native browser demo.

Linux or WSL, terminal 1:

```bash
npx playwright install --with-deps chromium
npm run sample:start
```

macOS, terminal 1:

```bash
npx playwright install chromium
npm run sample:start
```

Native Windows Command Prompt, terminal 1:

```bat
npx playwright install chromium
npm run sample:start
```

After the sample reports that it is listening, use terminal 2.

Linux, macOS, or WSL:

```bash
curl --fail http://127.0.0.1:4310/health
npm run sample:scan
```

Native Windows Command Prompt:

```bat
curl.exe --fail http://127.0.0.1:4310/health
npm run sample:scan
```

The scan writes `sample-app/sentinel-report.md`, which is intentionally ignored
because it is regenerated. The reviewable tracked snapshot is
[`docs/sample-report.md`](docs/sample-report.md). Stop the sample with
`Ctrl+C` in terminal 1. See [`sample-app/README.md`](sample-app/README.md) for
the fixture inventory and expected findings.

## One-command Docker demo

With Docker Desktop or Docker Engine plus the Compose plugin, run this from the
repository root in Bash or Windows Command Prompt:

```text
docker compose up --build --exit-code-from sentinel --attach sentinel --no-log-prefix
```

Compose builds isolated Sentinel and sample images, starts the sample on a
private network, waits for health, prints the Markdown report, propagates
Sentinel's fatal-error exit code, and stops the sample. It publishes no host
port and creates no host report. Clean up afterward:

```text
docker compose down --remove-orphans
```

The Sentinel image currently runs as root and is not a hardened sandbox. The
bundled Compose demo scans only the trusted local sample; a read-only mount
limits normal writes but does not make a hostile repository or website safe.
Image boundaries, direct repository scans, host networking, and optional AI
pass-through are documented in [`docs/docker.md`](docs/docker.md).

The npm workflow remains the authoritative development path. Sentinel itself
never gains target-service lifecycle control through Docker.

## Capabilities and boundaries

The four analysis levels run concurrently. Fixed checks remain sequential
within each level, share centralized setup and cached reachability, and isolate
timeouts or failures so other checks can finish.

| Level             | Current capability                                                                                                                                                                                                                                    | Deliberate boundary                                                                                                                                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Code & Repository | Builds one bounded, symlink-safe inventory; detects generic, Node/npm, and TypeScript context; checks ignore rules, quality-tool configuration, tests, CI, TypeScript strictness, lockfiles, dependency freshness, and README guidance.               | Analysis is root-focused. Node/npm and TypeScript receive deeper handling; other stacks receive useful generic checks rather than claimed language-specific coverage. Static heuristics inspect evidence but do not run target linters or tests. |
| Security          | Runs a bounded npm audit, detects high-confidence credential signatures without rendering values, checks environment-file hygiene, and observes configured unauthenticated headers, CORS, and evidence-derived debug routes.                          | No full SAST, entropy or Git-history scan, broad token heuristic, route brute force, authenticated penetration testing, unsafe methods, redirects, or exploitation.                                                                              |
| API / Backend     | Uses the cached API probe to select either live read-only checks for configured `GET`, `HEAD`, and `OPTIONS` endpoints or static OpenAPI 3.0/3.1 fallback. It checks configured status, media type, latency, required fields, and shallow JSON shape. | Live and static modes are exclusive in a scan. Sentinel does not guess or fetch contracts, generate mutations, fuzz, load test, deeply resolve schemas, or claim complete source-route coverage.                                                 |
| UI / Browser      | Reuses one Playwright Chromium session across configured pages and two viewports for navigation, console errors, broken images, axe accessibility, horizontal overflow, and explicit bounded form flows.                                              | No cross-browser matrix, visual regression, arbitrary form discovery, or general responsive-design claim. Missing Chromium or runtime prerequisites degrade to explicit skipped results.                                                         |

Runtime requests are bounded and read-only. Target URLs, paths, endpoints,
authentication references, viewports, and form flows come from configuration;
Sentinel does not scan ports, guess services, or start them. Cached API
reachability enables live contract checks or static fallback, never both.

### Why Security is intentionally narrow

Security findings are useful only when the evidence is defensible and safe to
collect. Sentinel therefore favors high-confidence credential signatures,
lockfile-backed npm audit data, environment-file policy, and conservative
unauthenticated HTTP observations. Weak or unverifiable policy produces a
warning or skip rather than an unearned pass.

This boundary limits false positives and prevents a quality scanner from
silently becoming an exploitation tool. Security requests never resolve target
credentials, brute-force paths, follow redirects, render response/header
values, or report detected secret values. Missing runtime context is explained
in the report; it does not crash unrelated analysis.

## AI-assisted semantic test-gap analysis

Deterministic checks can prove status, media-type, latency, and shallow-schema
facts, but they cannot reliably infer test intent spread across contract prose,
domain names, helpers, fixtures, and assertions. Sentinel's optional AI check
has one purpose: compare bounded target-derived API contract and test evidence
and identify one supported semantic test gap, or say that the evidence supports
none. It does not summarize the report or replace deterministic checks.

For example, a contract may describe owner success, unauthenticated rejection,
and an authenticated cross-account `403`. Tests may cover the first two through
project-specific helpers and names. Keyword matching cannot safely determine
whether the cross-account case is absent; the AI check performs that bounded
semantic comparison.

Sentinel selects the configured target OpenAPI document and one related,
readable test artifact from at most 12 candidates. It sends at most 8 KiB of
target-relative evidence after pattern-based redaction and a final safety
check. Exact provider citations must match supplied target-relative paths.

Outcomes are deliberately asymmetric:

- A supported `gap` becomes `Fail` for Critical/High severity or `Warn` for
  Medium/Low severity.
- `no_supported_gap` becomes `Skipped / Info`; AI never creates a `Pass`.
- Disabled AI, a missing provider credential, or insufficient safe evidence
  skips before dispatch, makes no paid call, and leaves the scan complete.
- A dispatched timeout, refusal, truncation, limit, invalid schema, or
  unrecognized response affects only the AI check and marks the scan incomplete
  without changing the CLI exit-code policy.

> [!WARNING]
> **Cost and repository-data disclosure:** AI is opt-in and allows at most one
> paid provider request per scan. It may transmit up to 8 KiB of selected
> OpenAPI and test content after bounded pattern-based redaction. Redaction is
> not a data-loss-prevention or declassification system. Enable AI only for
> repositories you are authorized to send to the selected provider, and review
> that provider's retention, privacy, processing, and pricing terms. Provider
> credentials are used only as authentication headers and never enter prompts,
> request bodies, evidence, reports, logs, tests, or documentation.

Sentinel uses fixed models `gpt-5.6-luna` and `claude-haiku-4-5`, permits one
request, caps provider output at 512 tokens, and performs no retries, streaming,
batching, or provider comparison. At a representative 2,000 input tokens plus
the full 512-token output allowance, list prices checked on July 27, 2026
estimate about **$0.0051** for
[OpenAI GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
and **$0.0046** for
[Claude Haiku 4.5](https://platform.claude.com/docs/en/about-claude/pricing).
Actual tokens, billing rules, and prices can change; check the linked official
pages before enabling AI.

OpenAI on Linux, macOS, or WSL Bash:

```bash
read -rsp "OpenAI API key: " OPENAI_API_KEY
printf '\n'
export OPENAI_API_KEY
export SENTINEL_AI_ENABLED=true
export SENTINEL_AI_PROVIDER=openai
npm start -- --config ./sample-app/sentinel.config.json
unset OPENAI_API_KEY SENTINEL_AI_ENABLED SENTINEL_AI_PROVIDER
```

OpenAI on native Windows Command Prompt:

Command Prompt cannot mask interactive input. Prefer loading the credential
from an approved secret manager. This fallback keeps it out of command history,
but displays it while typed:

```bat
set "OPENAI_API_KEY="
set /p "OPENAI_API_KEY=OpenAI API key (input is visible): "
set "SENTINEL_AI_ENABLED=true"
set "SENTINEL_AI_PROVIDER=openai"
npm start -- --config .\sample-app\sentinel.config.json
set "OPENAI_API_KEY="
set "SENTINEL_AI_ENABLED="
set "SENTINEL_AI_PROVIDER="
```

For Claude, use `ANTHROPIC_API_KEY` instead of `OPENAI_API_KEY` and set
`SENTINEL_AI_PROVIDER=claude`; all evidence, cost, privacy, outcome, and cleanup
rules remain the same. If a Command Prompt run is interrupted before cleanup,
clear the variables manually or close that window.

## Repository map

- `src/` — CLI, configuration, runner, report model, analysis checks, and AI
  transports.
- `tests/` — deterministic Vitest coverage; AI/provider and browser behavior
  use fakes in the normal suite.
- `sample-app/` — standalone intentionally flawed Express/TypeScript target.
- `docs/configuration.md` — complete configuration and credential-reference
  contract.
- `docs/architecture.md` and `docs/decisions.md` — current architecture and
  stable boundaries.
- `docs/docker.md` — optional image, Compose, direct-scan, and trust guidance.
- `docs/sample-report.md` and `docs/evidence/` — review artifacts.
- `Dockerfile` and `compose.yaml` — separate local Sentinel and sample images.
- `.github/workflows/ci.yml` — shared quality gate.

## Current limitations

- Deep stack analysis is limited to root Node/npm and TypeScript projects;
  unknown stacks receive generic repository checks.
- Security coverage is intentionally not full SAST, secret-history analysis,
  authenticated penetration testing, or a complete multi-package-manager
  audit.
- OpenAPI validation is shallow and JSON-focused; deep `$ref` composition,
  generated payloads, mutation, fuzzing, and load testing are absent.
- UI coverage uses Chromium only and does not include visual regression or
  claim general responsive adaptation.
- AI evidence selection is limited to one configured contract and one related
  test, and pattern redaction is not a general DLP boundary.
- API/UI services and all runtime targets must be configured and started
  externally; Sentinel does not discover or manage them.
- Docker images are local-only. The root scanner is suitable for the trusted
  demo and other trusted, authorized targets, not hostile-content isolation.
