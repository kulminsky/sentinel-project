# Sentinel Architecture

## Goal and Scope

Sentinel is a TypeScript CLI that scans a local project and produces an actionable quality report. The MVP is designed for a 2-3 business-day implementation window and prioritizes a polished, reviewable result over broad but shallow coverage.

This document describes the approved MVP target architecture. `README.md` and the codebase define the currently implemented state; a planned capability is not implemented until they show it as available.

Sentinel provides:

- Generic static repository and security checks for any readable local project.
- Deeper Node.js/npm checks when a Node project is detected.
- Safe API and browser checks when configured services are reachable.
- Static API fallback when services are unavailable.
- One bounded LLM-based semantic test-gap check.
- One selected Markdown, JSON, or plain-text terminal report containing all required statuses, severities, findings, recommendations, and summary data.

The design favors plain functions, fixed check registration, explicit boundaries, and bounded concurrency at the analysis-level boundary. Sentinel is not a plugin platform or a hosted service.

The repository currently includes a standalone Express and TypeScript sample
target with its own manifest and lockfile. Root installation installs it with
package scripts disabled, while its process remains explicitly controlled by
the reviewer. Its Security and API evidence is consumed by implemented checks;
its seeded UI flaws remain fixtures for the future browser milestone.

## Approved Architecture

The scan is coordinated by one visible pipeline:

1. Load and validate configuration.
2. Validate the target and build one bounded shared repository inventory.
3. Probe each configured API and UI service once and cache the observations.
4. Run the four fixed analysis-level groups concurrently.
5. Run checks sequentially in registration order within each level.
6. Normalize results, build one summary, and render the configured report format.

Every check owns an explicit timeout and error boundary. Completion timing never controls report order, and no scheduler or general concurrency framework is used.

## Module Boundaries

| Boundary                        | Responsibility                                                                                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI                             | Parse operational options, invoke the scan, and return the final exit code. It contains no check logic.                                                        |
| Configuration                   | Load strict JSON, `.env`, and process environment values; apply precedence; normalize paths; and expose individual environment references without enumeration. |
| Scan coordinator                | Validate shared prerequisites, cache reachability, run the four concurrent level groups, and collect deterministic results.                                    |
| Project inventory               | Walk the target once and retain categorized paths and metadata, not whole-repository contents.                                                                 |
| Bounded file reader             | Apply shared exclusions and size limits when checks read file content.                                                                                         |
| Repository checks               | Inspect source/config inventory, manifests, lockfiles, `.gitignore`, CI, linting, and test presence.                                                           |
| Security checks                 | Perform secret detection, npm vulnerability analysis, security-header checks, and evidence-derived debug checks.                                               |
| Service probe and HTTP boundary | Determine reachability and perform bounded, read-only HTTP requests. It returns observations rather than policy decisions.                                     |
| API checks                      | Interpret API observations and shallow OpenAPI or route evidence.                                                                                              |
| Playwright boundary             | Own Chromium lifecycle, contexts, authentication state, timeouts, axe integration, and browser observations.                                                   |
| AI boundary                     | Expose typed structured output to checks; own explicit vendor selection, private transports, paid-call limits, and fail-closed response validation.            |
| Result model                    | Runtime-validate every result and construct one deterministic Overall Summary.                                                                                 |
| Report module                   | Validate the normalized report and render one selected Markdown, JSON, or plain-text terminal representation.                                                  |

Use a fixed list of plain check functions. External capabilities are passed only to modules that need them; there is no dependency-injection container, dynamic plugin registry, or class hierarchy.

## Implemented Tooling Baseline

- The CLI uses Commander while keeping check logic outside the command boundary.
- One recursively strict Zod schema validates and normalizes target, report, API, UI, and AI configuration.
- TypeScript is strict, ESM, and compiled with `NodeNext` for Node.js 20.19 or later.
- Vitest runs source tests, while ESLint and Prettier enforce static quality and formatting.
- GitHub Actions runs the same aggregate `npm run check` command used locally.
- One symlink-safe repository inventory supports generic, Node/npm, and TypeScript checks without retaining whole-repository contents.
- The Playwright library is installed, but its configuration, browser binaries, and automation boundary remain deferred to the browser milestone.

## Setup and Concurrent Execution Flow

Sentinel validates the readable target, builds the shared repository inventory, detects root Node/npm and TypeScript context, and prepares the shared scan context before check execution.

Sentinel then probes only configured API and UI targets:

- API health and UI base targets receive one bounded `HEAD` request each.
- API and UI probes run concurrently and are cached for the current scan.
- Any HTTP response means reachable, including `401`, `404`, and `500`.
- Connection refusal, DNS/TLS failure, malformed responses, or timeout means unavailable.
- Missing or unavailable services produce `Skipped / Info` availability notes and do not make the scan incomplete.

After probing, Code & Repository, Security, API / Backend, and UI / Browser groups start concurrently. Checks remain sequential within a level. The runner preserves level and registration order, enforces each check timeout with an abort signal, and converts a timeout or exception into one isolated `Skipped / Info` diagnostic row.

Security checks consume the cached observations before making bounded requests to configured unauthenticated endpoints or pages. Cached API reachability exclusively selects live contract/latency analysis or static OpenAPI fallback. Reachable UIs receive Playwright checks when browser automation is implemented.

Sentinel never scans localhost ports and never starts, stops, or restarts target services.

## Common Check and Result Model

Each check has a stable ID, title, analysis level, phase, required timeout, and plain function receiving the shared context and a per-check abort signal.

Each check execution returns one or more results plus an explicit incomplete flag. Empty, invalid, or inconsistent output is isolated as a single execution-error result. Handled missing prerequisites remain normal skips, while internal timeouts and execution failures mark the report incomplete.

Each result represents one stable check-and-subject pair and contains:

- Check ID and title.
- Analysis level: Code & Repository, Security, API / Backend, or UI / Browser.
- Phase: static, runtime, or AI.
- Optional subject and redacted evidence.
- Status: Pass, Warn, Fail, or Skipped.
- Severity: Critical, High, Medium, Low, or Info.
- Finding and concrete recommendation.
- Optional duration and diagnostic code.

Result rules:

- Status, finding, severity, and recommendation are non-optional and runtime-validated for every result.
- No issue produces one `Pass / Info` result.
- A missing prerequisite produces one `Skipped / Info` result with a substantive finding and enablement recommendation.
- Independently actionable subjects produce separate warning or failure results.
- A check does not emit a generic pass alongside issue results.
- Internal execution errors are not normal skips: they use a diagnostic code and make the report summary state that the scan was incomplete.
- All evidence and diagnostics are redacted before being stored or rendered.
- One normalized Overall Summary stores the scan status, total, every status/severity count including zeroes, and the deterministic complete/incomplete narrative. Renderers never recalculate it.

## Configuration

The implemented loader reads optional `sentinel.config.json` and `.env` files from the invocation directory. `--config <path>` selects another JSON file and makes its directory the base for explicitly configured relative filesystem paths. Omitted target and report settings retain their invocation-directory defaults.

The strict schema contains MVP settings for:

- Target and report locations.
- API base URL, health path, safe endpoints, expectations, timeouts, latency thresholds, and authentication references.
- UI base URL, pages, two viewports, storage state or header references, and bounded form flows.
- AI enablement and explicit provider selection; provider credentials and safety limits retain their existing fixed boundaries.

Configuration precedence is:

1. Existing process environment.
2. `.env`.
3. `sentinel.config.json`.
4. The clean-run target and Markdown report defaults.

The clean run defaults to the invocation directory for `target.root`, `markdown` for `report.format`, and `sentinel-report.md` for `report.path`. JSON requires an explicit path; terminal output forbids a path and writes only to stdout. API and UI sections are optional, but every value inside a supplied section is required according to the schema. Unknown keys and invalid, incomplete, unreadable, or malformed configuration are fatal path-specific errors; the loader never drops a bad section or falls back after validation fails.

Credentials are resolved through environment-variable references and must never be written to reports or logs. Target URLs, ports, paths, credentials, endpoint parameters, and authentication values must not be hardcoded in production source.

The production AI redaction milestone will register only explicitly referenced values at the boundary that needs them; the configuration loader will not expose or enumerate the merged environment.

Rule customization, custom secret-pattern languages, and per-check plugin configuration are outside the MVP.

API/UI base targets and timeouts drive central reachability probing. API configuration also supplies one target-contained OpenAPI file, read-only endpoints, expectations, and optional header-authentication references for implemented API analysis. Unauthenticated endpoints and pages are consumed by Security header/CORS observations, and configured debug-like paths contribute debug-route evidence; Security never resolves target authentication. UI authentication, viewports, and form flows remain dormant until the Playwright milestone. The complete implemented contract is documented in `docs/configuration.md`.

## Repository Analysis Boundary

The implemented repository boundary walks the target once, records relative paths and file kinds, and never follows symlinks. It excludes VCS, dependency, generated, cache, and vendor trees. Traversal is bounded to depth 8, 20,000 entries, and five seconds; individual inspected text files are limited to 128 KiB.

The fixed Code & Repository checks cover:

- `.gitignore` coverage.
- Recognized linter and formatter configuration.
- Test files and the Node test script.
- Common CI configuration.
- Resolved root TypeScript strictness.
- Root npm dependency freshness.
- Root dependency lockfiles.
- README quality.

Generic repositories receive applicable filesystem checks. Root Node/npm and TypeScript evidence enables the deeper checks; pnpm, Yarn, Bun, and unknown stacks receive lockfile-presence behavior without deep adapters.

Dependency freshness runs one read-only, non-scripted `npm outdated --json --long` process with a 10-second timeout and 64 KiB output limit. Missing npm, timeout, or registry failure produces a normal skipped note. Invalid successful structured output is isolated to the check and marks the report incomplete. This analysis is separate from the implemented npm vulnerability audit.

An incomplete inventory never becomes a false absence warning. Positive evidence remains usable, while an affected absence-based check returns `Skipped / Info` and marks the report incomplete. Repository evidence contains only relative paths, recognized configuration names, and validated package/version metadata; raw file contents, command errors, registry configuration, and credentials are not rendered.

API contract/runtime analysis is implemented. UI browser coverage remains explicitly represented by a `Skipped / Info` placeholder row until its milestone is implemented. Existing Security checks, API/UI availability, and synthetic AI behavior remain active.

## Security Analysis Boundary

The fixed Security group runs sequentially in this order:

1. A root npm dependency audit.
2. A high-confidence secret scan.
3. Environment-file ignore hygiene.
4. Runtime security headers and CORS.
5. Evidence-derived debug endpoints.

The npm audit runs only for a root npm project with exactly one
`package-lock.json`. It uses one script-disabled, lockfile-only command with a
12-second timeout and 1 MiB output bound. A clean result requires exit code 0,
a valid npm audit v2 report, an empty vulnerability object, and internally
consistent zero counts. Exit code 1 with a valid vulnerability report is
interpreted as completed analysis; JSON npm error envelopes, other command
failures, malformed output, and inconsistent counts can never become a pass.
Findings are capped at 25 packages and contain only validated package metadata.

The secret scan reads only bounded, non-ignored text/source files from the
shared symlink-safe inventory. It detects private-key material, known provider
credential formats, and secret-like assignments in environment files. It does
not use entropy or generic source assignment heuristics. Findings store only a
relative path, line number, and detector category—never the matched value or
surrounding source. Environment hygiene separately checks whether real `.env`
variants are ignored and whether placeholder templates remain reviewable.

Runtime Security checks use cached reachability only as a prerequisite. The
header check makes separate `GET`, `HEAD`, or `OPTIONS` requests to at most 12
configured unauthenticated targets. Security requests never resolve target
credentials or follow redirects. Header values, response bodies, full URLs,
and transport errors are not rendered. The baseline covers API MIME-sniffing
protection and HTTPS HSTS; UI CSP/frame protection, MIME-sniffing protection,
referrer and permissions policies, and HTTPS HSTS; wildcard API CORS is
reported separately.

Debug candidates come only from configured paths and bounded Node/TypeScript
route declarations. Sentinel does not brute-force common paths. Public 2xx/3xx
responses fail; authentication rejection, unavailable runtime, 404, and unsafe
methods retain static warnings so declared debug evidence never becomes a
pass.

## Graceful Degradation

Sentinel should produce the most complete report possible:

| Condition                                                            | Behavior                                                                               |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| No config or runtime URLs                                            | Scan the current directory statically; skip affected runtime checks.                   |
| API unavailable                                                      | Emit a normal availability note and run only static OpenAPI fallback.                  |
| UI unavailable                                                       | Emit a normal availability note and skip future browser checks.                        |
| Authentication absent                                                | Run public checks and skip only protected expectations.                                |
| OpenAPI invalid                                                      | Warn without claiming runtime shape coverage; source-route fallback remains pending.   |
| Repository inventory bounded or partially unreadable                 | Preserve positive evidence; skip affected absence claims and mark the scan incomplete. |
| npm freshness query unavailable                                      | Skip freshness analysis without failing or marking the scan incomplete.                |
| `package-lock.json` or npm audit unavailable                         | Skip vulnerability lookup; never claim the project is clean.                           |
| npm audit output malformed or internally inconsistent                | Skip the audit result, mark the scan incomplete, and never claim the project is clean. |
| Runtime Security target unavailable or authentication required       | Retain static evidence or emit a scoped skipped note; never send target credentials.   |
| Playwright launch fails                                              | Continue other checks and mark the scan incomplete.                                    |
| AI disabled or credential absent                                     | Skip only the AI check; the scan remains complete.                                     |
| AI provider timeout/failure, call-limit refusal, or invalid response | Skip only the AI check, continue deterministic checks, and mark the scan incomplete.   |
| Individual check throws                                              | Emit a redacted execution diagnostic and mark the overall scan incomplete.             |
| Target root unreadable or report cannot be rendered or written       | Treat as a fatal tool error.                                                           |

The CLI returns a nonzero exit code only for fatal tool errors. Target findings, unavailable services, and isolated check failures remain report content.

## OpenAPI and Runtime Safety

OpenAPI support is deliberately shallow:

- Require one explicit, target-contained `api.openApiPath`; Sentinel never guesses a filename or fetches the contract from the service.
- Parse bounded OpenAPI 3.0/3.1 JSON or YAML documents through the symlink-safe repository boundary.
- Use cached reachability to select one mode for the scan. Reachable APIs receive only live analysis; unavailable APIs receive only static fallback.
- Request at most 12 configured `GET`, `HEAD`, or `OPTIONS` endpoints sequentially, once each, without following redirects.
- Check configured and documented status, content type, JSON parseability, supported top-level JSON response type, required fields, direct property types, and latency to response headers. Schema types follow the declared OpenAPI 3.0/3.1 dialect; OpenAPI 3.0 arrays remain a visible limitation because their required nested `items` schema is outside the shallow validator. Matched non-JSON schemas produce a visible limitation rather than an unverified shape pass.
- Limit response bodies to 256 KiB and preserve completed findings when an endpoint, body, or internal deadline bound limits coverage.

The inactive mode emits one explicit skipped result. Endpoint transport failures after a successful central probe never trigger fallback during that scan. Missing authentication references skip only the affected endpoint, and target credentials are used only as request headers.

Deep schema composition, comprehensive `$ref` resolution, generated payloads, source-route discovery, and complete contract validation are outside the implemented boundary.

All runtime API checks are read-only. Sentinel does not issue `POST`, `PUT`, `PATCH`, or `DELETE` requests.

## Playwright Boundary

All browser automation uses Playwright with Chromium:

- The integration boundary owns browser launch and guaranteed cleanup.
- Authentication is limited to configured storage state or headers.
- Pages and viewports are explicitly configured and same-origin by default.
- Checks cover navigation, page/console errors, failed resources, broken images, axe-based accessibility, responsive overflow, and bounded configured form flows.
- Form actions are limited to navigation, fill, check/uncheck, click, and visible-text or URL assertions.
- Sentinel never discovers and submits arbitrary forms.

Playwright objects do not escape into the scan coordinator or report module.

## AI Boundary

The required AI check performs semantic test-gap analysis by comparing a bounded selection of API contracts or route evidence with relevant tests.

The MVP uses:

- One typed, provider-neutral client exposed to checks, with private OpenAI and Claude transports.
- Mandatory provider selection when AI is enabled; Sentinel never infers a provider from available credentials.
- One explicit setup switch and one client per scan; there is no provider registry.
- An atomically reserved allowance of one paid request total and one active request at a time. Failed attempts consume the allowance.
- Vendor-native schema-constrained output generated from the same strict Zod schema used for local validation.
- Parsing only from each vendor's documented structured-output slot; no free-text, code-fence, partial-output, or multi-block recovery.
- Exact citations limited to evidence supplied in the request.
- Repository and target-secret redaction, plus input-size limits, before evidence transmission.
- Deterministic validation and mapping into Sentinel results. A valid AI finding can warn or fail but can never pass.
- Fail-closed handling: malformed, unknown, refused, truncated, oversized, schema-invalid, or otherwise unrecognized output becomes `Skipped / Info` and marks the scan incomplete.
- No multi-turn workflow, provider registry, or elaborate retry system.

The selected provider credential may be sent only as an authentication header to that provider. Real credential values must never enter prompts, request bodies, response evidence, reports, logs, tests, or documentation.

The overall report summary remains deterministic. When paid credentials are absent, all deterministic checks run and the AI check is `Skipped / Info`. The committed sample report must demonstrate a real AI-enabled run.

The current feasibility spike is intentionally synthetic: it sends only a fixed, secret-free contract-and-test fixture through the selected provider. It uses process environment variables for enablement, explicit provider selection, and provider-specific credentials. Limits are fixed at 8 KiB of evidence, 512 output tokens, a 64 KiB accepted response body, a 20-second provider timeout, and a 25-second check timeout. Real repository evidence selection and redaction remain part of the later production AI milestone.

The live OpenAI path was manually verified on July 27, 2026. One bounded
request returned a locally validated `Fail / High` finding for the synthetic
cross-account authorization-test gap, cited both supplied fixture paths, and
reported sanitized model and token provenance. The overall scan remained
complete. Claude transport behavior remains covered by deterministic offline
tests rather than a recorded live request. This verification does not complete
production evidence selection, redaction, or the final demo-target report.

## Testing Strategy

Sentinel's automated tests use Vitest. The standalone sample target uses Node's
built-in test runner so it remains independent of Sentinel's implementation.
`npm run check` is the milestone-completion gate and runs formatting
verification, linting, compilation, and both test suites.

Required unit tests focus on:

- Configuration precedence and validation.
- Concurrent level scheduling, sequential per-level order, timeouts, and failure isolation.
- Central reachability caching and sanitized unavailable observations.
- Environment-reference resolution and redaction.
- Result invariants and summary counts.
- Markdown, JSON, and terminal renderer consistency.
- Bounded file exclusion, stack detection, and repository-check heuristics.
- npm freshness output validation without live registry access.
- npm audit envelope/count validation without live registry access.
- Secret detector coverage and proof that matched values never enter results.
- Environment-file ignore hygiene, runtime header/CORS policy, and evidence-derived debug routes.
- Safe endpoint selection and shallow response expectations.
- Exclusive live/static API mode selection, bounded response handling, and per-endpoint latency.
- AI response and citation validation.

Required integration tests cover:

- Generic and Node repository scans with no target services.
- Unreachable API/UI degradation and static fallback.
- Controlled HTTP observations.
- Recorded npm audit output.
- Disabled, valid, and invalid fake-AI responses.
- Required report-field completeness.

Live paid-AI calls, live npm registry queries, live vulnerability databases,
full browser matrices, and external repositories are not part of the automated
test suite. The sample tests lock both intentional flaws and correct behavior
without invoking Sentinel, Playwright, or external services. A complete
automated CLI/Playwright smoke test is a stretch goal; the separate-process demo
sample run remains mandatory.

## Implementation Order

1. Build a vertical slice: CLI, minimal config, validated result/summary model, one repository check, and selectable report renderers.
2. Perform an early AI risk spike using one fixture, explicit OpenAI and Claude adapters, one selected-provider request, and one cited structured result.
3. Implement configuration, the isolated concurrent runner, redaction, inventory, stack detection, and generic repository checks. Configuration, the runner, inventory, detection, and repository checks are complete; production AI evidence redaction remains pending.
4. Add secret detection and npm-only vulnerability analysis. This milestone is complete.
5. Add service probes, shallow OpenAPI fallback, and safe API/security runtime checks. This milestone is complete.
6. Add the Playwright lifecycle and required browser checks.
7. Harden the synthetic AI check behind a provider-neutral, one-call, fail-closed client and preserve no-AI behavior. This milestone is complete; production evidence selection and redaction remain pending.
8. Harden tests, generate the demo report, complete the README, and assemble
   Cursor evidence. The standalone demo target and scan configuration are
   complete; the committed report and remaining submission evidence are
   pending.
9. Attempt stretch work only after all required deliverables pass.

Capture genuine Cursor evidence throughout these milestones rather than reconstructing it at the end.

## Explicitly Out of Scope

- Long-running service, dashboard, or hosted UI.
- Automatic service startup or port scanning.
- Authenticated Security requests or brute-force debug-path probing.
- Deep Python, Java, Go, pnpm, or Yarn adapters.
- Non-read-only API operations, fuzzing, exploitation, or load testing.
- Complete OpenAPI/JSON Schema validation.
- Automatic form discovery or application-specific login automation.
- Entropy-based or generic source-assignment secret heuristics, Git-history secret scanning, or full SAST/data-flow analysis.
- Visual regression or multi-browser/device matrices.
- AI providers beyond OpenAI and Claude, multi-turn agents, provider comparison, or a provider plugin system.
- Dynamic check plugins, dependency-injection frameworks, event buses, or job schedulers.
- Simultaneous multi-format output, ANSI styling, interactive terminal output, or report formats beyond Markdown, JSON, and plain text.
- Automated fixes or target-source modification.
