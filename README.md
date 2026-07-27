# Sentinel

Sentinel is a TypeScript CLI under active development for reviewing the quality of local software projects.

## Project Goal

Deliver a polished, reviewable MVP that demonstrates deliberate quality-engineering decisions within a 2-3 business-day implementation window. The project favors useful, explainable findings and graceful degradation over broad but shallow coverage.

## Current Status

**The reviewable MVP is implemented and the development evidence is indexed.
Final submission packaging remains.**

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
- Runs one composite Playwright Chromium check across configured pages and viewports for axe accessibility, browser errors, broken images, horizontal overflow, and optional form flows.
- Selects bounded target OpenAPI and related test evidence for one semantic API test-gap check through a provider-neutral typed client.
- Supports explicit OpenAI or Claude selection while keeping vendor envelopes out of check logic.
- Uses native schema-constrained output, validates it locally, and fails closed on every unrecognized response.
- Skips AI without making a paid request when the feature, selected credential, or sufficient target evidence is unavailable.
- Produces one configured Markdown, JSON, or plain-text terminal report from a shared runtime-validated model.
- Includes one normalized Overall Summary with complete status/severity counts and a deterministic narrative.
- Returns a nonzero exit code only for fatal CLI or tool errors, including invalid invocation, configuration failure, an unreadable target, or report failure.

Source-route fallback, entropy scanning, and Git-history scanning are not implemented. Configured API and UI authentication references are resolved only for the explicitly protected runtime targets that use them. Playwright browser binaries remain an explicit installation step and are intentionally not downloaded by `npm install`.

The repository also contains a runnable, deliberately flawed Express and
TypeScript target under `sample-app/`. Sentinel consumes its Security, API, and
UI evidence.

## Development Setup

Prerequisites:

- Node.js 20.19 or later.
- npm.

From a clean machine:

```sh
git clone https://github.com/kulminsky/sentinel-project.git
cd sentinel-project
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

Playwright browser downloads are deliberately separate from package
installation. Install the compatible Chromium binary only when running UI
analysis:

```sh
npx playwright install chromium
```

On Linux hosts that also need system packages, use
`npx playwright install --with-deps chromium`. The default no-UI scan and
`npm run check` do not require a browser binary.

Available development commands:

```sh
npm run build        # Compile strict TypeScript
npm test             # Build and run Vitest once
npm run test:watch   # Build, then watch source tests
npm run lint         # Run ESLint
npm run lint:fix     # Apply safe ESLint fixes
npm run format       # Format project files
npm run format:check # Verify formatting
npm run sample:start # Build and run the local sample target
npm run sample:scan  # Scan the running sample target
npm run sample:check # Check the standalone sample package
npm run check        # Check Sentinel and the sample package
```

## Sample Target

Start the deliberately flawed target after the root install:

```sh
npx playwright install chromium
npm run sample:start
```

It listens on `http://127.0.0.1:4310` by default and requires no database,
credentials, or external services. In a second terminal, run:

```sh
npm run sample:scan
```

Sentinel uses
[`sample-app/sentinel.config.json`](sample-app/sentinel.config.json) and writes
the ignored local report `sample-app/sentinel-report.md`. A fresh, reviewable
run is provided as [`docs/sample-report.md`](docs/sample-report.md). The
scanner does not start or stop the target.

The committed run enabled OpenAI selection, but no credential was available in
the execution environment. Its explicit `AI_CREDENTIAL_MISSING` row therefore
demonstrates the no-paid-API fallback; no provider request was made.

The fixture intentionally includes:

- A stale, pinned dependency currently reported as vulnerable by npm.
- A public debug route, missing security headers, and route-scoped wildcard
  CORS.
- One OpenAPI/live-response drift and one endpoint above the configured latency
  threshold.
- A broken image, deterministic console error, and unlabeled form input.

Health, catalog behavior, non-public CORS behavior, page navigation, absence of
horizontal overflow at the configured viewports, and the configured client-side
form flow remain correct so the report contains meaningful passes as well as
findings. The Playwright scan reports the deliberate console error, broken
image, and axe-detected unlabeled input. See
[`sample-app/README.md`](sample-app/README.md) for the fixture contract.

## Configuration

No configuration is required for the default static scan. Sentinel uses the invocation directory as its target and writes `sentinel-report.md` there.

Sentinel automatically reads optional `sentinel.config.json` and `.env` files. Select another JSON file with:

```sh
npm start -- --config ./path/to/sentinel.config.json
```

Configuration is recursively strict. Invalid values, incomplete supplied sections, and unknown keys stop the scan with a property-specific error; Sentinel never silently replaces invalid configuration with defaults.

See [`docs/configuration.md`](docs/configuration.md) for the complete JSON contract, environment mappings, precedence, path resolution, and credential-reference rules. API configuration drives central reachability, exclusive live/static contract analysis, and unauthenticated Security observations. UI configuration drives the shared Playwright session, page/viewports, optional authentication, and bounded form flows.

## Report Output

Sentinel renders exactly one report per scan. Markdown is the default and retains the clean-run `sentinel-report.md` path. Select `json` with an explicit `report.path`, or select `terminal` without a path to write the full report to stdout. `SENTINEL_REPORT_FORMAT` and `SENTINEL_REPORT_PATH` provide the equivalent environment overrides.

Every format contains the same validated Overall Summary and result data. Status, finding, severity, and recommendation are mandatory for every row, including skipped checks.

## Why This Scope

The four levels reflect different failure surfaces and remain useful under
different runtime conditions:

| Level             | Why it is included                                                                                         | Deliberate MVP boundary                                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Code & Repository | Missing quality controls are visible before a service can start and should work for every readable target. | Root-focused evidence with deeper Node/npm and TypeScript handling; broad language-specific adapters are deferred.                          |
| Security          | Dependency, credential, environment, header, and debug-route problems can create immediate release risk.   | High-confidence secrets, npm audit, bounded policies, and unauthenticated read-only observations avoid noisy SAST or exploitation.          |
| API / Backend     | Contract drift and latency are user-visible even when compilation succeeds.                                | Shallow OpenAPI checks and safe configured requests provide defensible coverage without building a full schema engine or issuing mutations. |
| UI / Browser      | Browser-only failures require an actual rendering engine.                                                  | One shared Chromium session covers the brief’s observable behaviors without a cross-browser or visual-regression matrix.                    |

Central reachability is cached once because it prevents contradictory runtime
decisions and duplicate probes. The API selects exactly one live or static
mode, while Playwright uses one composite session so each page load supplies
multiple observations. These choices keep the result deterministic and
proportional to the assignment window.

## Repository Analysis

Sentinel currently performs these root-focused checks:

| Check                | Implemented behavior                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.gitignore`         | Validates environment, platform, dependency, and detected generated-output coverage without reading ignored secret values.                                                                                    |
| Linter and formatter | Requires readable, nonempty recognized root configuration plus a matching package dependency or relevant npm script. Script recognition uses a bounded static heuristic; Sentinel does not execute the tools. |
| Tests                | Detects readable, nonempty conventional test artifacts and requires an npm test script that is not an obvious no-op for Node projects. This is a bounded static heuristic; Sentinel does not run tests.       |
| CI                   | Detects nonempty configuration for common hosted and self-managed CI systems.                                                                                                                                 |
| TypeScript           | Resolves the root `tsconfig.json` and requires strict mode without disabled strict-family options.                                                                                                            |
| Dependency freshness | Runs one read-only `npm outdated` query with a 10-second timeout and bounded output; automated tests use fakes.                                                                                               |
| Lockfile             | Detects npm, Yarn, pnpm, and Bun lockfiles and validates npm root-manifest consistency where available.                                                                                                       |
| README               | Checks bounded root README content for meaningful purpose, setup or development, and usage guidance.                                                                                                          |

The shared inventory does not follow symlinks, retains paths and file metadata rather than repository contents, and excludes dependency, VCS, generated, cache, and vendor trees. Traversal is limited to depth 8, 20,000 entries, and five seconds; inspected text files are limited to 128 KiB. When a bound prevents a reliable absence claim, the affected check is skipped and the report is marked incomplete.

Dependency freshness is informational and separate from the npm vulnerability audit. Non-npm package managers receive generic lockfile detection only; deep workspace and package-manager-specific analysis is not implemented.

## Security Analysis

Sentinel currently runs five fixed Security checks:

| Check                   | Implemented behavior                                                                                                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm dependency audit    | Runs bounded, script-disabled `npm audit` only for a single root npm lockfile. A clean pass requires exit code 0 and a valid, internally consistent empty audit report.                  |
| High-confidence secrets | Scans bounded, non-ignored text files for complete plausible private-key blocks and known provider credential formats; findings contain only relative path, line, and detector category. |
| `.env` hygiene          | Warns when real environment files are not ignored or environment templates are themselves ignored.                                                                                       |
| Headers and CORS        | Checks configured unauthenticated API/UI responses for a bounded policy baseline, warns on weak or unverifiable policies, and reports wildcard API CORS separately.                      |
| Debug endpoints         | Derives candidates from configured paths and bounded Node/TypeScript route declarations, then makes read-only unauthenticated observations where safe.                                   |

Security checks do not brute-force routes, resolve target credentials, follow
redirects, start services, render response/header values, or report detected
secret values. Missing npm, registry access, runtime configuration, or service
availability produces a substantive skipped note. Invalid purported audit
output and bounded-coverage limitations cannot earn a clean pass and mark the
report incomplete where the result is not trustworthy.

This scope intentionally favors high-confidence, actionable findings. npm is
the only deeply audited package manager because the sample and primary stack
use its authoritative lockfile format. Secret scanning avoids entropy and
generic assignment heuristics to reduce false positives. Runtime Security
requests remain unauthenticated and evidence-derived so Sentinel never guesses
credentials, probes arbitrary routes, or performs exploitation.

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
Malformed configured read-only operations remain visible and prevent a
document-level OpenAPI pass.

## UI / Browser Analysis

When the cached UI probe is reachable and browser targets are configured,
Sentinel launches Playwright Chromium once. One composite check reuses public
and optional authenticated contexts across all observations:

- Each configured page loads once at each of the two configured viewports.
  Those loads provide navigation status, `console.error` and uncaught exception
  counts, broken-image observations, axe WCAG A/AA results, and horizontal
  overflow checks.
- Header authentication is added only to same-origin requests. Storage-state
  authentication is passed directly to Playwright. Missing authentication
  prerequisites skip only protected targets.
- Optional configured form flows run at the widest configured viewport and are
  limited to navigation, fill, check/uncheck, click, exact visible-text, and
  exact same-origin URL assertions.

Configuration accepts at most 10 pages, five form flows, and 20 steps per flow.
The browser check has a 120-second internal budget and preserves completed
findings when that budget is exhausted. Evidence contains counts, sanitized
same-origin image paths, viewport names, and axe rule metadata; it never
contains console text, raw exceptions, form values, selectors, authentication
headers, credentials, full URLs, or query strings.
Indeterminate axe rules remain visible and prevent an accessibility pass, but
they represent incomplete evidence rather than an execution failure and do not
make the whole scan incomplete.

If Chromium cannot launch, the complete browser analysis degrades to one
`Skipped / Info` row with the remediation command
`npx playwright install chromium`. The report is marked incomplete, other
analysis levels continue, and the CLI still exits zero. Missing or unreachable
UI services are ordinary complete-scan skips and never cause a browser launch.
Sentinel does not start the target service.

## AI-Assisted Test-Gap Analysis

Sentinel’s deterministic API checks can compare configured statuses, media
types, shallow schemas, and required fields. They cannot reliably infer whether
tests cover the _intent_ of an operation when that intent is spread across
contract descriptions, route names, test names, fixtures, and assertions. The
AI check is limited to that semantic comparison: it determines whether
target-derived evidence supports one concrete missing API test or no supported
gap. It does not summarize the report or replace deterministic contract
validation.

Sentinel selects the configured target OpenAPI document and one bounded,
relevant readable test artifact from the shared repository inventory. Evidence
is target-relative, size-limited to 8 KiB, and redacted for private-key,
provider-credential, authorization, URL-credential, and secret-like assignment
patterns before transmission. A final safety check prevents dispatch when the
evidence cannot be safely sanitized. If Sentinel cannot establish safe contract
and related test evidence, the check returns `Skipped / Info` without making a
request.

> [!WARNING]
> AI is opt-in and makes at most one paid provider request per scan. With the
> fixed 8 KiB input and 512-token output bounds, one request is expected to cost
> well under USD $0.01 at current list prices, but provider pricing can change.
> The default AI-disabled mode runs every deterministic check without charge.

Place a credential only in the process environment using your normal secure
shell workflow. Sentinel reads `OPENAI_API_KEY` for OpenAI and
`ANTHROPIC_API_KEY` for Claude; never place credential values in repository
files or commands.

Run exactly one selected provider:

```sh
SENTINEL_AI_ENABLED=true SENTINEL_AI_PROVIDER=openai npm start
```

```sh
SENTINEL_AI_ENABLED=true SENTINEL_AI_PROVIDER=claude npm start
```

When AI is enabled, `SENTINEL_AI_PROVIDER` is required and must be `openai` or
`claude`. A missing selected-provider credential is a normal `Skipped / Info`
result. Disabled AI, a missing credential, or insufficient evidence makes no
paid call and leaves the scan complete. A dispatched timeout, refusal,
truncation, call-limit, unrecognized response, or invalid schema affects only
the AI check and marks execution incomplete without changing the CLI exit code.

The check receives only a locally validated typed finding and sanitized
provider/model/token provenance. OpenAI and Claude transports own their native
schema-constrained request and response envelopes. One explicit provider switch
constructs one client per scan; the client permits one paid request total and
one active request at a time. It performs no retries, streaming, batching,
provider comparison, or free-text JSON recovery. Exact citations must match all
supplied target-relative paths, and provider-authored narratives are checked for
credential content before reporting. A supported `gap` maps to `Fail` or
`Warn`; `no_supported_gap` maps to informational `Skipped` without inventing a
finding. AI never produces a `Pass`.

The fixed models are `gpt-5.6-luna` and `claude-haiku-4-5`. Provider output is
limited to 512 tokens, the accepted response to 64 KiB, the provider request to
20 seconds, and the complete AI check to 25 seconds. Automated tests use
deterministic fakes and never make paid requests.

## Architecture Documents

- [`docs/architecture.md`](docs/architecture.md) defines the approved scope, module boundaries, execution flow, result model, integration boundaries, testing strategy, and implementation order.
- [`docs/configuration.md`](docs/configuration.md) defines the implemented strict configuration contract and source precedence.
- [`docs/decisions.md`](docs/decisions.md) records the key scope and engineering decisions that must remain stable during the MVP.
- [`docs/evidence/README.md`](docs/evidence/README.md) annotates the development-session screenshots and correlates them with the progressive Git history.
- [`AGENTS.md`](AGENTS.md) contains repository-wide instructions for AI coding agents contributing to the project.

`docs/architecture.md` and `docs/decisions.md` define the approved target.
This README and the codebase define the currently implemented state.

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
- One selected-provider, bounded LLM-based semantic test-gap analysis over target OpenAPI and related tests using OpenAI or Claude.
- Graceful behavior when services, configuration, tools, or optional AI credentials are unavailable.
- Focused automated tests, a reproducible demo target, and a reviewable sample report.

This list describes the implemented MVP boundary. The separate
[development-evidence index](docs/evidence/README.md) maps genuine session
captures to the progressive Git history and labels remaining evidence gaps.

## Planned Milestones

1. **Complete:** Establish the CLI-to-report vertical slice.
2. **Complete:** Validate the bounded multi-provider AI approach with an early synthetic risk spike.
3. **Complete:** Configuration, the runner, inventory, stack detection, repository checks, and bounded target-derived AI evidence selection.
4. **Complete:** Add high-confidence secret detection, `.env` hygiene, and npm-only vulnerability analysis.
5. **Complete:** Add service reachability, Security runtime observations, shallow OpenAPI fallback, and read-only API contract/latency assertions.
6. **Complete:** Add the shared Playwright Chromium lifecycle and required browser checks.
7. **Complete:** Harden provider-neutral, fail-closed AI execution, target-derived evidence, redaction, and no-AI behavior.
8. **In progress:** The reproducible demo target, final sample report, submission documentation, and annotated process-evidence index are complete; Cursor-identifiable evidence and final packaging remain.

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
│   │   ├── evidence.ts
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
│   │   ├── ui/
│   │   │   ├── check.ts
│   │   │   └── session.ts
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
│   ├── ai-client.test.ts
│   ├── ai-evidence.test.ts
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
│   ├── security-runtime.test.ts
│   └── ui-browser.test.ts
├── .prettierignore
├── .prettierrc.json
├── AGENTS.md
├── README.md
├── docs/
│   ├── architecture.md
│   ├── configuration.md
│   ├── decisions.md
│   ├── evidence/
│   │   └── README.md
│   └── sample-report.md
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
- **Tooling — complete:** reproducible npm setup, CLI/config libraries, Vitest, linting, formatting, and CI checks; Playwright Chromium installation remains an explicit runtime step.
- **Configuration — complete:** strict JSON and environment loading, normalized target/report paths, source precedence, and fatal path-specific validation.
- **Core runner — complete:** four concurrent analysis-level groups, sequential per-level checks, per-check timeouts, isolated failures, and deterministic ordering.
- **Static analysis — complete for the approved scope:** bounded inventory, Node/TypeScript detection, repository checks, npm audit, high-confidence secret detection, `.env` hygiene, and static OpenAPI fallback.
- **Runtime analysis — complete for the approved deterministic scope:** centralized API/UI reachability, unauthenticated header/CORS/debug observations, read-only API contract/latency checks, and shared-session Playwright browser checks are implemented.
- **AI analysis — complete for the approved bounded scope:** target-derived evidence, redaction, provider-neutral schema-constrained output, one-call enforcement, fail-closed validation, and no-key behavior.
- **Submission readiness — in progress:** implementation, demo target, documentation, sample report, and the annotated process-evidence index are complete; Cursor-identifiable evidence and the final public push remain.

## Known Limitations and Next Priorities

1. **Submission artifacts:** the
   [development-evidence index](docs/evidence/README.md) documents genuine
   session captures, their Git correlations, and historical states. Add one
   capture or short screencast with Cursor and the repository workspace visibly
   identifiable, then verify the complete history from an anonymous public
   clone.
2. **AI evidence breadth:** the AI check requires an explicitly configured
   OpenAPI document and selects one related readable test from at most 12
   candidates. Source-route evidence, multiple-test synthesis, and live Claude
   verification are deferred to keep paid input and secret exposure bounded.
3. **API depth:** OpenAPI validation is intentionally shallow and JSON-focused;
   deep `$ref`, composition, mutation, fuzzing, and load testing would require a
   larger schema and safety boundary.
4. **Security depth:** npm is the only deeply audited package manager. Entropy,
   Git-history scanning, generic SAST, authenticated probing, and exploitation
   are omitted to favor low-noise, read-only results.
5. **Browser breadth:** Chromium is the only browser. Sentinel performs no
   screenshots, visual regression, arbitrary form discovery, or general
   responsive-adaptation inference.
6. **Stack breadth:** Node/npm and TypeScript receive deeper adaptation;
   Python, Java, Go, pnpm, Yarn, and Bun receive only applicable generic checks.
