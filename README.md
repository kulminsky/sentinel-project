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

- Git.
- Node.js 20.19 or later, including npm.

Confirm them before cloning:

```bash
git --version
node --version
npm --version
```

### Linux or WSL (Bash)

```bash
git clone https://github.com/kulminsky/sentinel-project.git
cd sentinel-project
npm install
npm start
```

### Native Windows (PowerShell)

```powershell
git --version
node --version
npm --version
git clone https://github.com/kulminsky/sentinel-project.git
Set-Location sentinel-project
npm install
npm start
```

The root installation also performs a script-disabled, lockfile-based install
for the standalone sample target. It does not install Playwright browser
binaries. `npm start` builds Sentinel automatically, scans the current
directory, and writes `sentinel-report.md`.

The default path needs no configuration file, API key, browser, or running
target service. AI is disabled, and unavailable npm or registry access becomes
a report note rather than a crash. WSL follows the Linux instructions; native
Windows uses PowerShell.

### Run a custom target

Sentinel never starts or stops the target. Start any required service
separately, then select a configuration file.

Linux or WSL:

```bash
npm start -- --config ./path/to/sentinel.config.json
```

Windows PowerShell:

```powershell
npm start -- --config .\path\to\sentinel.config.json
```

### Verify the repository

The same command works on Linux, WSL, and Windows PowerShell:

```text
npm run check
```

Available development commands:

```text
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

The UI scan needs the Playwright-managed Chromium binary, which is deliberately
not downloaded by `npm install`.

Linux or WSL, in terminal 1:

```bash
npx playwright install --with-deps chromium
npm run sample:start
```

On Playwright-supported Linux distributions, `--with-deps` installs required
system packages and may request administrator privileges. If the system
packages are already managed centrally, use
`npx playwright install chromium` instead.

Native Windows PowerShell, in terminal 1:

```powershell
npx playwright install chromium
npm run sample:start
```

The target listens on `http://127.0.0.1:4310` and requires no database,
credentials, or external service. Verify it and scan it from terminal 2.

Linux or WSL:

```bash
curl --fail http://127.0.0.1:4310/health
npm run sample:scan
```

Windows PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:4310/health
npm run sample:scan
```

Stop the sample with `Ctrl+C` in terminal 1 after the scan. Sentinel itself
never manages the target process.

Sentinel uses
[`sample-app/sentinel.config.json`](sample-app/sentinel.config.json) and writes
the ignored local report `sample-app/sentinel-report.md`. A fresh, reviewable
run is provided as [`docs/sample-report.md`](docs/sample-report.md). The
committed report is an example, not output that is regenerated by
`npm run check`.

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

## Optional Docker Workflow

The npm workflow above remains the primary setup. Docker is an optional local
convenience for reviewers who want isolated Sentinel and sample images plus
Chromium and its Linux system dependencies.

Prerequisites:

- Docker Desktop, or Docker Engine with the Compose plugin.
- Linux-container mode when using Docker Desktop.

Confirm the Docker client and daemon before continuing:

```text
docker version
docker compose version
```

The first build needs network access for locked npm packages, Chromium, and its
system dependencies. It does not alter the host npm installation and does not
make `npm install` download a browser.

One multi-stage Dockerfile produces two final images:

- `sentinel:local` contains Sentinel and Chromium, but no sample source,
  package, or deliberately vulnerable `lodash`.
- `sentinel-sample-app:local` contains the sample's production dependencies and
  compiled assets, but no Sentinel code or browser installation.

The Sentinel image currently retains its locked development dependencies
because repository checks import TypeScript at runtime. Correcting that package
boundary is separate from this optional packaging workflow.

### Run the complete sample

From the Sentinel repository root, use the same command in Linux/WSL Bash or
native Windows PowerShell:

```text
docker compose up --build --exit-code-from sentinel --attach sentinel --no-log-prefix
```

Compose builds both isolated local images, starts the sample on its private
network, waits for `/health`, runs the configured API, Security, and Playwright
observations, prints the temporary Markdown report, stops the sample, and
returns Sentinel's fatal-error exit code. It does not publish the sample port
to the host or create a host report. With AI environment variables absent, AI
remains disabled and no provider request is made.

The containers remain available in a stopped state for inspection. Remove them
and the private network when finished:

```text
docker compose down --remove-orphans
```

Compose is not required for ordinary scans; it exists only to coordinate the
two-process sample demonstration. Sentinel itself still never starts or stops a
target.

### Scan another local repository

Build the reusable image once from the Sentinel repository:

```text
docker build --target sentinel --tag sentinel:local .
```

Then change to the target repository. Linux or WSL Bash:

```bash
docker run --rm --init --ipc=host \
  --mount "type=bind,src=${PWD},dst=/workspace,readonly" \
  -e SENTINEL_TARGET_ROOT=/workspace \
  -e SENTINEL_REPORT_FORMAT=terminal \
  sentinel:local
```

Native Windows PowerShell:

```powershell
$target = (Get-Location).Path
docker run --rm --init --ipc=host `
  --mount "type=bind,src=$target,dst=/workspace,readonly" `
  -e SENTINEL_TARGET_ROOT=/workspace `
  -e SENTINEL_REPORT_FORMAT=terminal `
  sentinel:local
```

This zero-configuration form mounts the target read-only, does not
automatically load a conventional target configuration, and writes the full
report to stdout. API and UI observations require an explicitly selected
configuration whose service addresses are reachable from the container;
Sentinel does not guess host-network addresses.

### Enable optional AI in the Docker demo

Never place a provider key in `compose.yaml`, `.env`, a Docker build argument,
or the command line. Prompt for it, pass only the environment-variable name to
Compose, and remove it afterward.

Linux or WSL Bash with OpenAI:

```bash
read -rsp "OpenAI API key: " OPENAI_API_KEY
printf '\n'
export OPENAI_API_KEY

SENTINEL_AI_ENABLED=true \
SENTINEL_AI_PROVIDER=openai \
docker compose up --build --exit-code-from sentinel \
  --attach sentinel --no-log-prefix

unset OPENAI_API_KEY
```

Native Windows PowerShell with OpenAI:

```powershell
$secureKey = Read-Host "OpenAI API key" -AsSecureString
$env:OPENAI_API_KEY = [System.Net.NetworkCredential]::new("", $secureKey).Password
$env:SENTINEL_AI_ENABLED = "true"
$env:SENTINEL_AI_PROVIDER = "openai"

try {
  docker compose up --build --exit-code-from sentinel `
    --attach sentinel --no-log-prefix
} finally {
  Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:SENTINEL_AI_ENABLED -ErrorAction SilentlyContinue
  Remove-Item Env:SENTINEL_AI_PROVIDER -ErrorAction SilentlyContinue
  Remove-Variable secureKey -ErrorAction SilentlyContinue
}
```

For Claude, use `ANTHROPIC_API_KEY` and provider `claude`. Runtime pass-through
prevents the value from entering repository files, shell history, image layers,
or build logs, but Docker administrators can inspect a running container's
environment. A stronger Docker-secrets integration would require a
Docker-specific credential wrapper and is intentionally outside this minimal
workflow. The AI cost, privacy, evidence-redaction, and one-request limits in
[AI-Assisted Test-Gap Analysis](#ai-assisted-test-gap-analysis) still apply.

The container is a development and review convenience, not a hardened sandbox
for hostile websites. The included Compose workflow scans the trusted local
sample; stronger browser isolation is required before visiting untrusted
targets.

## Configuration

No configuration is required for the default static scan. Sentinel uses the invocation directory as its target and writes `sentinel-report.md` there.

Sentinel automatically reads optional `sentinel.config.json` and `.env` files.
Use the platform-specific custom-target commands above to select another JSON
file.

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

| Check                   | Implemented behavior                                                                                                                                                                     | Why it is included                                                                                     | Deliberate boundary                                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| npm dependency audit    | Runs bounded, script-disabled `npm audit` only for a single root npm lockfile. A clean pass requires exit code 0 and a valid, internally consistent empty audit report.                  | A lockfile-backed audit can provide an authoritative result for the primary npm stack.                 | Other package managers receive lockfile checks, not a claimed deep vulnerability audit.                                           |
| High-confidence secrets | Scans bounded, non-ignored text files for complete plausible private-key blocks and known provider credential formats; findings contain only relative path, line, and detector category. | High-confidence signatures catch immediately actionable exposure while limiting noisy false positives. | No entropy scan, Git-history scan, generic token heuristic, or full SAST.                                                         |
| `.env` hygiene          | Warns when real environment files are not ignored or environment templates are themselves ignored.                                                                                       | Repository hygiene can be assessed without reading or displaying environment values.                   | This check does not validate secret strength or inspect ignored environment-file values.                                          |
| Headers and CORS        | Checks configured unauthenticated API/UI responses for a bounded policy baseline, warns on weak or unverifiable policies, and reports wildcard API CORS separately.                      | Common browser-facing policy mistakes are observable through safe, read-only requests.                 | CSP, frame, and Permissions-Policy checks are conservative; policy strength that cannot be proven produces a warning, not a pass. |
| Debug endpoints         | Derives candidates from configured paths and bounded Node/TypeScript route declarations, then makes read-only unauthenticated observations where safe.                                   | Public diagnostics are high-impact and can be checked without exploitation.                            | No path brute forcing, authenticated penetration testing, unsafe methods, or exploitation.                                        |

Security checks do not brute-force routes, resolve target credentials, follow
redirects, start services, render response/header values, or report detected
secret values. Missing npm, registry access, runtime configuration, or service
availability produces a substantive skipped note. Invalid purported audit
output and bounded-coverage limitations cannot earn a clean pass and mark the
report incomplete where the result is not trustworthy.

This scope intentionally favors high-confidence, actionable findings over the
appearance of complete security coverage. Sentinel is not a full SAST tool,
Git-history scanner, authenticated penetration-testing system, exploitation
framework, or complete multi-package-manager auditor.

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

For example, a contract may document owner success, unauthenticated rejection,
and an authenticated cross-account `403`. Related tests may cover owner success
and unauthenticated rejection while expressing those cases through project
helpers and domain-specific test names. Keyword matching cannot establish that
the cross-account semantic case is absent, and a framework-specific AST rule
would couple Sentinel to one test stack. The implemented AI use case performs
that bounded semantic comparison. This is an illustrative example of the
implemented behavior, not a claim about the AI result in the committed no-key
sample report.

Sentinel selects the configured target OpenAPI document and one bounded,
relevant readable test artifact from the shared repository inventory. Evidence
is target-relative, size-limited to 8 KiB, and redacted for private-key,
provider-credential, authorization, URL-credential, and secret-like assignment
patterns before transmission. A final safety check prevents dispatch when the
evidence cannot be safely sanitized. If Sentinel cannot establish safe contract
and related test evidence, the check returns `Skipped / Info` without making a
request.

> [!WARNING]
> **Paid request and repository-data disclosure:** AI is opt-in and permits at
> most one provider request per scan. Sentinel may transmit up to 8 KiB of
> selected OpenAPI and test evidence after bounded pattern-based redaction.
> Redaction is not a general declassification or data-loss-prevention system.
> Enable AI only for repositories you are authorized to send to the selected
> provider. Provider retention, privacy, and processing terms still apply.
> Provider credentials are used only in authentication headers. The default
> AI-disabled path, a missing credential, or insufficient safe evidence makes no
> paid request.

Illustrative cost at 2,000 input tokens and the configured 512-token output
limit, using list prices verified **July 27, 2026**:

| Provider and fixed model                                                               | Input price | Output price | Example calculation             | Estimated request |
| -------------------------------------------------------------------------------------- | ----------- | ------------ | ------------------------------- | ----------------- |
| [OpenAI GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)      | $1 / MTok   | $6 / MTok    | $0.002 + (512 × $6 / 1,000,000) | About $0.0051     |
| [Anthropic Claude Haiku 4.5](https://platform.claude.com/docs/en/about-claude/pricing) | $1 / MTok   | $5 / MTok    | $0.002 + (512 × $5 / 1,000,000) | About $0.0046     |

These figures are estimates, not maximum charges. Actual billed tokens,
provider accounting, and future prices may differ; review the linked official
pricing before enabling AI.

Sentinel reads `OPENAI_API_KEY` for OpenAI and `ANTHROPIC_API_KEY` for Claude.
Prompt for the selected credential so it is not embedded in repository files or
the command itself.

Linux or WSL with OpenAI:

```bash
read -rsp "OpenAI API key: " OPENAI_API_KEY
printf '\n'
export OPENAI_API_KEY
export SENTINEL_AI_ENABLED=true
export SENTINEL_AI_PROVIDER=openai
npm start -- --config ./sample-app/sentinel.config.json
unset OPENAI_API_KEY SENTINEL_AI_ENABLED SENTINEL_AI_PROVIDER
```

Native Windows PowerShell with OpenAI:

```powershell
$secureKey = Read-Host "OpenAI API key" -AsSecureString
$env:OPENAI_API_KEY = [System.Net.NetworkCredential]::new("", $secureKey).Password
$env:SENTINEL_AI_ENABLED = "true"
$env:SENTINEL_AI_PROVIDER = "openai"
try {
  npm start -- --config .\sample-app\sentinel.config.json
} finally {
  Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:SENTINEL_AI_ENABLED -ErrorAction SilentlyContinue
  Remove-Item Env:SENTINEL_AI_PROVIDER -ErrorAction SilentlyContinue
  Remove-Variable secureKey -ErrorAction SilentlyContinue
}
```

Linux or WSL with Claude:

```bash
read -rsp "Anthropic API key: " ANTHROPIC_API_KEY
printf '\n'
export ANTHROPIC_API_KEY
export SENTINEL_AI_ENABLED=true
export SENTINEL_AI_PROVIDER=claude
npm start -- --config ./sample-app/sentinel.config.json
unset ANTHROPIC_API_KEY SENTINEL_AI_ENABLED SENTINEL_AI_PROVIDER
```

Native Windows PowerShell with Claude:

```powershell
$secureKey = Read-Host "Anthropic API key" -AsSecureString
$env:ANTHROPIC_API_KEY = [System.Net.NetworkCredential]::new("", $secureKey).Password
$env:SENTINEL_AI_ENABLED = "true"
$env:SENTINEL_AI_PROVIDER = "claude"
try {
  npm start -- --config .\sample-app\sentinel.config.json
} finally {
  Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:SENTINEL_AI_ENABLED -ErrorAction SilentlyContinue
  Remove-Item Env:SENTINEL_AI_PROVIDER -ErrorAction SilentlyContinue
  Remove-Variable secureKey -ErrorAction SilentlyContinue
}
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
├── .dockerignore
├── AGENTS.md
├── Dockerfile
├── README.md
├── compose.yaml
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

## Known Gaps and Next Priorities

| Gap                                                                                                                    | Why omitted                                                                                                      | Next priority                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| AI redaction is pattern-based, and evidence selection is limited to one contract and one related test.                 | This bounds paid input, data exposure, and implementation complexity; it is not a general DLP boundary.          | Add policy-driven evidence approval and broader multi-test synthesis before increasing the evidence window.   |
| Deep security analysis is npm-only; entropy, Git-history, full SAST, and authenticated runtime testing are absent.     | Low-noise, read-only checks were more defensible within the assignment window than broad speculative findings.   | Add one authenticated, explicitly configured workflow and one additional lockfile-backed audit adapter.       |
| OpenAPI validation is shallow and JSON-focused, without deep `$ref`, mutation, fuzzing, or load testing.               | Complete schema evaluation and active testing require substantially larger correctness and safety boundaries.    | Resolve local `$ref` safely and expand deterministic schema coverage before adding active request generation. |
| UI coverage is Chromium-only, with no visual regression, cross-browser matrix, or general responsive-adaptation claim. | One mandatory Playwright browser session covers the requested observable failures without inflating runtime.     | Add explicit layout assertions, then a second browser only if target risk justifies the cost.                 |
| Stack-specific depth is limited to Node/npm and TypeScript.                                                            | The sample and primary assignment implementation use this stack; other projects still receive generic checks.    | Add a stack adapter only after selecting a representative target and authoritative toolchain.                 |
| Service handling uses configured targets rather than port discovery or lifecycle management.                           | Guessing ports or starting processes would make scans less deterministic and could mutate the reviewer’s system. | Keep orchestration explicit; the optional Compose recipe is limited to the trusted bundled sample.            |
| Final packaging still needs unmistakably Cursor-identifiable evidence and public-clone verification.                   | Existing evidence is genuine and indexed, but not every capture visibly identifies the editor and repository.    | Capture one clearly identified Cursor session and verify the documented workflow from an anonymous clone.     |
