# Sentinel

Sentinel is a TypeScript CLI under active development for reviewing the quality of local software projects.

## Project Goal

Deliver a polished, reviewable MVP that demonstrates deliberate quality-engineering decisions within a 2-3 business-day implementation window. The project favors useful, explainable findings and graceful degradation over broad but shallow coverage.

## Current Status

**Foundation, AI feasibility, tooling, configuration, concurrent-runner, validated-reporting, repository-analysis, Security-analysis, API-analysis, and reproducible-demo-target milestones complete.**

Sentinel currently:

- Compiles to a runnable Node.js CLI.
- Uses Commander for CLI behavior and one strict Zod configuration boundary.
- Loads strict JSON, `.env`, and process-environment configuration with path-specific fatal errors.
- Scans the configured target root, defaulting to the invocation directory.
- Builds one bounded, symlink-safe repository inventory and detects generic, Node/npm, and TypeScript context.
- Probes configured API and UI services once with bounded, read-only `HEAD` requests and reports missing or unreachable services as notes.
- Runs the four analysis-level groups concurrently, keeps checks sequential within each level, and isolates every check with its own timeout.
- Checks `.gitignore` coverage, code-style configuration, tests, CI, TypeScript strictness, dependency freshness, lockfiles, and README quality.
- Audits root npm lockfiles, detects high-confidence secrets without reporting their values, and checks `.env` ignore hygiene.
- Uses configured unauthenticated targets for bounded security-header, CORS, and evidence-derived debug-endpoint observations.
- Exclusively selects live API contract/latency analysis or static OpenAPI fallback from the cached API reachability result.
- Reports an explicit `Skipped / Info` coverage row for unfinished UI analysis.
- Runs or gracefully skips one synthetic semantic API test-gap check through a provider-neutral typed client.
- Supports explicit OpenAI or Claude selection while keeping vendor envelopes out of check logic.
- Uses native schema-constrained output, validates it locally, and fails closed on every unrecognized response.
- Has a manually verified live OpenAI synthetic-fixture path; the Claude path remains covered by deterministic offline tests rather than a recorded live call.
- Produces one configured Markdown, JSON, or plain-text terminal report from a shared runtime-validated model.
- Includes one normalized Overall Summary with complete status/severity counts and a deterministic narrative.
- Returns a nonzero exit code only when configuration cannot be loaded, the scan cannot run, or the selected report cannot be rendered or written.

Playwright browser automation, production AI evidence selection, source-route fallback, entropy scanning, and Git-history scanning are not implemented yet. Configured API endpoints and header-authentication references are consumed by API analysis; UI authentication values, viewports, and form flows remain dormant. The Playwright library is installed for the planned browser milestone, but browser binaries are intentionally not installed.

The repository also contains a runnable, deliberately flawed Express and
TypeScript target under `sample-app/`. Sentinel now consumes its Security and
API evidence; the seeded UI flaws remain fixtures for the unfinished browser
milestone.

## Development Setup

Prerequisites:

- Node.js 20.19 or later.
- npm.

From a clean clone, install dependencies:

```sh
npm install
```

The root installation also performs a script-disabled, lockfile-based install
for the standalone sample target. It does not install Playwright browser
binaries.

Then run the current scan against the repository in the current working directory:

```sh
npm start
```

`npm start` builds the project automatically and writes `sentinel-report.md` in the current working directory. No environment configuration or running target service is required for this default, AI-disabled path. Applicable Node/npm targets receive bounded dependency-freshness and vulnerability queries; unavailable npm or registry access produces skipped notes rather than stopping the scan.

Playwright browser downloads are deliberately separate from package installation. This milestone does not include a Playwright configuration, browser installation command, or browser automation.

Available development commands:

```sh
npm run build        # Compile strict TypeScript
npm test             # Build and run Vitest once
npm run test:watch   # Build, then watch source tests
npm run lint         # Run ESLint
npm run lint:fix     # Apply safe ESLint fixes
npm run format       # Format tracked project files
npm run format:check # Verify formatting
npm run sample:start # Build and run the local sample target
npm run sample:scan  # Scan the running sample target
npm run sample:check # Check the standalone sample package
npm run check        # Check Sentinel and the sample package
```

## Sample Target

Start the deliberately flawed target after the root install:

```sh
npm run sample:start
```

It listens on `http://127.0.0.1:4310` by default and requires no database,
credentials, or external services. In a second terminal, run:

```sh
npm run sample:scan
```

Sentinel uses
[`sample-app/sentinel.config.json`](sample-app/sentinel.config.json) and writes
the ignored local report `sample-app/sentinel-report.md`. The scanner does not
start or stop the target.

The fixture intentionally includes:

- A stale, pinned dependency currently reported as vulnerable by npm.
- A public debug route, missing security headers, and route-scoped wildcard
  CORS.
- One OpenAPI/live-response drift and one endpoint above the configured latency
  threshold.
- A broken image, deterministic console error, and unlabeled form input.

Health, catalog behavior, non-public CORS behavior, responsive layout, and the
configured client-side form flow remain correct so the eventual report contains
meaningful passes as well as findings. Security and API checks are implemented;
the browser checks remain planned. See
[`sample-app/README.md`](sample-app/README.md) for the fixture contract.

## Configuration

No configuration is required for the default static scan. Sentinel uses the invocation directory as its target and writes `sentinel-report.md` there.

Sentinel automatically reads optional `sentinel.config.json` and `.env` files. Select another JSON file with:

```sh
npm start -- --config ./path/to/sentinel.config.json
```

Configuration is recursively strict. Invalid values, incomplete supplied sections, and unknown keys stop the scan with a property-specific error; Sentinel never silently replaces invalid configuration with defaults.

See [`docs/configuration.md`](docs/configuration.md) for the complete JSON contract, environment mappings, precedence, path resolution, and credential-reference rules. API configuration drives central reachability, exclusive live/static contract analysis, and unauthenticated Security observations. UI browser behavior is not executed yet.

## Report Output

Sentinel renders exactly one report per scan. Markdown is the default and retains the clean-run `sentinel-report.md` path. Select `json` with an explicit `report.path`, or select `terminal` without a path to write the full report to stdout. `SENTINEL_REPORT_FORMAT` and `SENTINEL_REPORT_PATH` provide the equivalent environment overrides.

Every format contains the same validated Overall Summary and result data. Status, finding, severity, and recommendation are mandatory for every row, including skipped checks.

## Repository Analysis

Sentinel currently performs these root-focused checks:

| Check                | Implemented behavior                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `.gitignore`         | Validates environment, platform, dependency, and detected generated-output coverage without reading ignored secret values. |
| Linter and formatter | Detects recognized root configuration, including supported `package.json` keys.                                            |
| Tests                | Detects conventional test files and requires a runnable test script for Node projects.                                     |
| CI                   | Detects nonempty configuration for common hosted and self-managed CI systems.                                              |
| TypeScript           | Resolves the root `tsconfig.json` and requires strict mode without disabled strict-family options.                         |
| Dependency freshness | Runs one read-only `npm outdated` query with a 10-second timeout and bounded output; automated tests use fakes.            |
| Lockfile             | Detects npm, Yarn, pnpm, and Bun lockfiles and validates npm root-manifest consistency where available.                    |
| README               | Checks bounded root README content for meaningful purpose, setup or development, and usage guidance.                       |

The shared inventory does not follow symlinks, retains paths and file metadata rather than repository contents, and excludes dependency, VCS, generated, cache, and vendor trees. Traversal is limited to depth 8, 20,000 entries, and five seconds; inspected text files are limited to 128 KiB. When a bound prevents a reliable absence claim, the affected check is skipped and the report is marked incomplete.

Dependency freshness is informational and separate from the npm vulnerability audit. Non-npm package managers receive generic lockfile detection only; deep workspace and package-manager-specific analysis is not implemented.

## Security Analysis

Sentinel currently runs five fixed Security checks:

| Check                   | Implemented behavior                                                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm dependency audit    | Runs bounded, script-disabled `npm audit` only for a single root npm lockfile. A clean pass requires exit code 0 and a valid, internally consistent empty audit report. |
| High-confidence secrets | Scans bounded, non-ignored text files for private keys and known provider credential formats; findings contain only relative path, line, and detector category.         |
| `.env` hygiene          | Warns when real environment files are not ignored or environment templates are themselves ignored.                                                                      |
| Headers and CORS        | Checks configured unauthenticated API/UI responses for a bounded header baseline and reports wildcard API CORS separately.                                              |
| Debug endpoints         | Derives candidates from configured paths and bounded Node/TypeScript route declarations, then makes read-only unauthenticated observations where safe.                  |

Security checks do not brute-force routes, resolve target credentials, follow
redirects, start services, render response/header values, or report detected
secret values. Missing npm, registry access, runtime configuration, or service
availability produces a substantive skipped note. Invalid purported audit
output and bounded-coverage limitations cannot earn a clean pass and mark the
report incomplete where the result is not trustworthy.

## API / Backend Analysis

Every configured API supplies an explicit target-contained `openApiPath`.
Sentinel uses the cached reachability result to select exactly one contract
mode:

- A reachable API receives sequential, read-only requests to at most 12
  configured `GET`, `HEAD`, or `OPTIONS` endpoints. Each endpoint produces one
  combined status, shallow OpenAPI shape, configured-field, and response-header
  latency result from a single request.
- An unreachable API receives static OpenAPI 3.0/3.1 JSON or YAML analysis.
  Sentinel checks configured endpoint alignment without claiming live status,
  response, or latency coverage.

The inactive mode emits one `Skipped / Info` note. A service that disappears
after the central probe does not switch modes mid-scan. Runtime responses are
limited to 256 KiB, authenticated endpoints resolve only configured header
environment references, redirects are not followed, and credentials, response
bodies, query values, header values, parser errors, and absolute paths are not
rendered.

OpenAPI validation is deliberately shallow and JSON-focused: top-level response
type, required fields, and direct property types are supported for JSON
responses. A matched non-JSON response schema produces a visible limitation
instead of an unearned shape pass. Schema types follow the declared OpenAPI
3.0/3.1 dialect; OpenAPI 3.0 arrays remain a visible limitation because their
required nested `items` schema is outside this shallow validator. Deep
composition, comprehensive `$ref` resolution, generated payloads, unsafe
methods, and source-route discovery remain out of scope.

## Synthetic AI Feasibility Check

AI is disabled by default and uses only a committed, secret-free synthetic contract-and-test fixture. Sentinel does not scan or send repository source code in this milestone.

To exercise one provider manually, first place its credential in the process environment using your normal secure shell workflow. Sentinel reads `OPENAI_API_KEY` for OpenAI and `ANTHROPIC_API_KEY` for Claude; never place credential values in repository files or commands.

Run exactly one selected provider:

```sh
SENTINEL_AI_ENABLED=true SENTINEL_AI_PROVIDER=openai npm start
```

```sh
SENTINEL_AI_ENABLED=true SENTINEL_AI_PROVIDER=claude npm start
```

When AI is enabled, `SENTINEL_AI_PROVIDER` is required and must be `openai` or `claude`; missing or unsupported selection is a fatal configuration error. A missing selected-provider credential produces a normal `Skipped / Info` result. Provider, timeout, refusal, truncation, call-limit, and unrecognized or schema-invalid response failures affect only the AI check, mark the report incomplete, and do not produce a nonzero exit code.

The check receives only a locally validated typed finding and sanitized provider/model/token provenance. OpenAI and Claude transports own their vendor-native structured-output request and response envelopes. An exact provider switch constructs one client per scan; the client atomically permits one paid request total and one active request at a time. It performs no retries, streaming, batching, provider comparison, or free-text JSON recovery. An AI outcome can be only `Fail`, `Warn`, or `Skipped`; it never produces a `Pass`.

The spike uses fixed models (`gpt-5.6-luna` and `claude-haiku-4-5`), an 8 KiB evidence limit, a 512-token output limit, a 64 KiB response limit, a 20-second provider timeout, and a 25-second check timeout. A failed or malformed request still consumes the one-call allowance. A request against the synthetic fixture is expected to cost well under USD $0.01 at current list prices; Sentinel does not embed provider pricing.

### Verified OpenAI Run

On July 27, 2026, a manual OpenAI-enabled scan completed against the committed
synthetic fixture. The AI check returned `Fail / High` for the missing
authenticated cross-account `403` test, cited only the supplied contract and
test fixture paths, and reported sanitized provenance for `gpt-5.6-luna` with
238 input tokens and 121 output tokens. The overall scan remained `Complete`,
confirming that report completeness is independent of finding status.

This verifies one live OpenAI request through the implemented fail-closed
boundary. It does not verify a live Claude request, production repository
evidence selection or redaction, or the final demo-target sample report. The
generated root report remains a local ignored artifact.

## Architecture Documents

- [`docs/architecture.md`](docs/architecture.md) defines the approved scope, module boundaries, execution flow, result model, integration boundaries, testing strategy, and implementation order.
- [`docs/configuration.md`](docs/configuration.md) defines the implemented strict configuration contract and source precedence.
- [`docs/decisions.md`](docs/decisions.md) records the key scope and engineering decisions that must remain stable during the MVP.
- [`AGENTS.md`](AGENTS.md) contains repository-wide instructions for AI coding agents contributing to the project.

These documents are the source of truth until an approved decision is deliberately changed.

## Implementation Principles

- Implement only the current milestone.
- Prefer KISS, plain functions, composition, and small explicit boundaries.
- Avoid speculative abstractions and unrequested flexibility.
- Keep target-specific URLs, ports, paths, parameters, and credentials outside production source.
- Preserve centralized setup, one cached service probe per configured target, concurrent analysis levels, and sequential checks within each level.
- Keep runtime checks read-only and never start target services.
- Use Playwright for all browser automation.
- Redact repository and target secrets before logging, reporting, persistence, or AI evidence transmission; use provider credentials only as authentication headers.
- Keep the project compiling and run relevant tests after each change.
- Complete required deliverables before beginning stretch work.

## Current MVP Scope

The approved MVP is scoped to:

- A TypeScript CLI with one selected Markdown, JSON, or plain-text terminal report.
- Generic static repository and security analysis for readable local projects.
- Deeper Node.js/npm analysis when a Node project is detected.
- Centralized setup and reachability probing followed by concurrent analysis-level execution and conditional API/browser checks.
- Shallow OpenAPI analysis and read-only runtime API requests.
- Playwright-based Chromium checks for explicitly configured pages and flows.
- One selected-provider, bounded LLM-based semantic test-gap analysis using OpenAI or Claude.
- Graceful behavior when services, configuration, tools, or optional AI credentials are unavailable.
- Focused automated tests, a reproducible demo target, a sample report, and genuine development-process evidence.

This list describes the approved implementation target, not functionality currently available.

## Planned Milestones

1. **Complete:** Establish the CLI-to-report vertical slice.
2. **Complete:** Validate the bounded multi-provider AI approach with an early synthetic risk spike.
3. **In progress:** Configuration, the runner, inventory, stack detection, and repository checks are complete; production AI evidence redaction remains pending.
4. **Complete:** Add high-confidence secret detection, `.env` hygiene, and npm-only vulnerability analysis.
5. **Complete:** Add service reachability, Security runtime observations, shallow OpenAPI fallback, and read-only API contract/latency assertions.
6. Add the Playwright lifecycle and required browser checks.
7. **Complete for the synthetic spike:** Harden provider-neutral, fail-closed AI execution and no-AI behavior; production evidence selection and redaction remain pending.
8. **In progress:** The reproducible demo target is complete; harden remaining tests and complete the sample report, documentation, and process evidence.

Stretch work begins only after all required milestones and submission artifacts are complete.

## Project Structure

The repository currently contains the foundation implementation and its documentation:

```text
.
├── .github/
│   └── workflows/
│       └── ci.yml
├── src/
│   ├── ai/
│   │   ├── check.ts
│   │   ├── claude.ts
│   │   ├── client.ts
│   │   ├── config.ts
│   │   ├── fixture.ts
│   │   ├── openai.ts
│   │   └── provider.ts
│   ├── checks/
│   │   ├── api/
│   │   │   ├── checks.ts
│   │   │   └── openapi.ts
│   │   ├── repository/
│   │   │   ├── common.ts
│   │   │   ├── node.ts
│   │   │   ├── static.ts
│   │   │   └── typescript-config.ts
│   │   ├── security/
│   │   │   ├── common.ts
│   │   │   ├── debug-endpoints.ts
│   │   │   ├── dependency-audit.ts
│   │   │   ├── env-hygiene.ts
│   │   │   ├── files.ts
│   │   │   ├── headers.ts
│   │   │   ├── runtime.ts
│   │   │   └── secrets.ts
│   │   ├── coverage.ts
│   │   ├── registry.ts
│   │   └── service-availability.ts
│   ├── config/
│   │   ├── load.ts
│   │   └── schema.ts
│   ├── core/
│   │   ├── check.ts
│   │   ├── result.ts
│   │   └── runner.ts
│   ├── report/
│   │   ├── json.ts
│   │   ├── markdown.ts
│   │   └── terminal.ts
│   ├── runtime/
│   │   └── reachability.ts
│   ├── repository/
│   │   └── inspection.ts
│   ├── cli.ts
│   └── scan.ts
├── sample-app/
│   ├── public/
│   │   └── assets/
│   ├── src/
│   ├── tests/
│   ├── openapi.json
│   ├── package.json
│   ├── sentinel.config.json
│   └── tsconfig.json
├── tests/
│   ├── support/
│   │   └── fake-ai-provider.ts
│   ├── ai-check.test.ts
│   ├── api-analysis.test.ts
│   ├── ai-config.test.ts
│   ├── ai-provider.test.ts
│   ├── cli.test.ts
│   ├── config-load.test.ts
│   ├── config-schema.test.ts
│   ├── reachability.test.ts
│   ├── report-renderers.test.ts
│   ├── repository-checks.test.ts
│   ├── repository-inspection.test.ts
│   ├── result.test.ts
│   ├── runner.test.ts
│   ├── scan-report.test.ts
│   ├── security-audit.test.ts
│   ├── security-files.test.ts
│   └── security-runtime.test.ts
├── .prettierignore
├── .prettierrc.json
├── AGENTS.md
├── README.md
├── docs/
│   ├── architecture.md
│   ├── configuration.md
│   └── decisions.md
├── eslint.config.mjs
├── .gitignore
├── package-lock.json
├── package.json
└── tsconfig.json
```

Additional implementation directories will be added only as their milestones begin. The approved conceptual structure is documented in `docs/architecture.md`; empty scaffolding is intentionally avoided.

## Development Workflow

For each milestone:

1. Confirm the milestone boundary against the approved documentation.
2. Implement the smallest complete vertical change.
3. Keep the project compiling throughout the change.
4. Add tests only for behavior introduced by that milestone.
5. Run the smallest relevant test set, then `npm run check`.
6. Update documentation only where implemented behavior or an approved decision changed.
7. Capture genuine development-process evidence.
8. Summarize changed files, tests run, and remaining limitations before stopping.

## Roadmap

- **Foundation — complete:** executable project skeleton, runtime-validated result/summary model, and selectable Markdown/JSON/terminal reporting.
- **Tooling — complete:** reproducible npm setup, CLI/config libraries, Vitest, linting, formatting, and CI checks; Playwright browser installation remains deferred.
- **Configuration — complete:** strict JSON and environment loading, normalized target/report paths, source precedence, and fatal path-specific validation.
- **Core runner — complete:** four concurrent analysis-level groups, sequential per-level checks, per-check timeouts, isolated failures, and deterministic ordering.
- **Static analysis — in progress:** bounded inventory, Node/TypeScript detection, repository checks, npm audit, high-confidence secret detection, `.env` hygiene, and static OpenAPI fallback are implemented; source-route fallback remains pending.
- **Runtime analysis — in progress:** centralized API/UI reachability, unauthenticated header/CORS/debug observations, and read-only API contract/latency checks are complete; Playwright checks remain planned.
- **AI analysis:** provider-neutral, fail-closed synthetic multi-provider execution is complete and the OpenAI path has been manually verified; live Claude verification plus production evidence selection and redaction remain planned.
- **Submission readiness — in progress:** the standalone demo target is complete;
  the final sample report, remaining documentation, and process evidence are
  pending.

## README Maintenance by Milestone

This README should grow with implemented behavior rather than describe planned functionality as complete:

| Milestone                        | README sections to complete or update                                                                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundation                       | Completed: Current Status, Development Setup, Project Structure, and the first verified command now reflect the implementation.                                   |
| Validated reporting              | Completed: Current Status, Configuration, report behavior, model invariants, and Project Structure reflect all three implemented formats.                         |
| Repository and security analysis | Completed: Current Status, Repository Analysis, Security Analysis, Project Structure, and limitations reflect implemented behavior.                               |
| API runtime and fallback         | Completed: Current Status, Configuration, API / Backend Analysis, Project Structure, roadmap, and degradation behavior reflect the implementation.                |
| Playwright                       | Update MVP Scope; document supported browser checks and any verified limitations.                                                                                 |
| AI feasibility spike             | Completed: Current Status, Development Setup, Project Structure, provider behavior, synthetic data handling, limits, and fallback now reflect the implementation. |
| Production AI integration        | Replace synthetic-only guidance with verified evidence selection, redaction, configuration, and sample-report behavior.                                           |
| Demo target                      | Completed: Current Status, Development Setup, Sample Target, Project Structure, roadmap, and limitations describe the runnable fixture.                           |
| Submission readiness             | Replace remaining planning-oriented status text; add the committed sample report, final known gaps, and process-evidence sections.                                |

Planned items should be removed or marked complete only after their implementation and tests are verified.
