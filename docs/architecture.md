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
- A Markdown report containing all required statuses, severities, findings, recommendations, and summary counts.

The design favors plain functions, fixed check registration, explicit boundaries, and sequential execution. Sentinel is not a plugin platform or a hosted service.

## Approved Architecture

The scan is coordinated by one visible pipeline:

1. Load and validate configuration.
2. Inventory the project and detect its stack.
3. Run always-on static checks.
4. Probe configured API and UI services.
5. Run API runtime checks or static API fallback.
6. Run Playwright checks when the UI is reachable.
7. Run or gracefully skip the AI check.
8. Normalize results, build the summary, and write Markdown.

Checks run sequentially for predictable behavior, logs, cleanup, and evidence. No scheduler or general concurrency framework is needed.

## Module Boundaries

| Boundary                        | Responsibility                                                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| CLI                             | Parse operational options, invoke the scan, and return the final exit code. It contains no check logic.                       |
| Configuration                   | Load JSON, `.env`, and process environment values; apply precedence; validate; normalize; and register secrets for redaction. |
| Scan coordinator                | Execute phases, evaluate prerequisites, isolate failures, and collect results for all four analysis levels.                   |
| Project inventory               | Walk the target once and retain categorized paths and metadata, not whole-repository contents.                                |
| Bounded file reader             | Apply shared exclusions and size limits when checks read file content.                                                        |
| Repository checks               | Inspect source/config inventory, manifests, lockfiles, `.gitignore`, CI, linting, and test presence.                          |
| Security checks                 | Perform secret detection, npm vulnerability analysis, security-header checks, and evidence-derived debug checks.              |
| Service probe and HTTP boundary | Determine reachability and perform bounded, read-only HTTP requests. It returns observations rather than policy decisions.    |
| API checks                      | Interpret API observations and shallow OpenAPI or route evidence.                                                             |
| Playwright boundary             | Own Chromium lifecycle, contexts, authentication state, timeouts, axe integration, and browser observations.                  |
| AI boundary                     | Select and redact bounded evidence, make one provider request, and validate cited structured output.                          |
| Result model                    | Enforce status, severity, evidence, redaction, and diagnostic invariants.                                                     |
| Report module                   | Sort results, calculate counts, describe incomplete execution, and render Markdown.                                           |

Use a fixed list of plain check functions. External capabilities are passed only to modules that need them; there is no dependency-injection container, dynamic plugin registry, or class hierarchy.

## Implemented Tooling Baseline

- The CLI uses Commander while keeping check logic outside the command boundary.
- Zod validates and normalizes the currently implemented AI environment values; the broader configuration milestone remains pending.
- TypeScript is strict, ESM, and compiled with `NodeNext` for Node.js 20.19 or later.
- Vitest runs source tests, while ESLint and Prettier enforce static quality and formatting.
- GitHub Actions runs the same aggregate `npm run check` command used locally.
- The Playwright library is installed, but its configuration, browser binaries, and automation boundary remain deferred to the browser milestone.

## Static-First Execution Flow

Static analysis always runs when the target root is readable:

- Build a bounded path and metadata inventory.
- Detect Node/TypeScript from manifests, lockfiles, and source extensions; otherwise use generic mode.
- Run repository checks, secret detection, manifest/lock checks, and static debug evidence collection.
- Discover OpenAPI documents, route candidates, schemas, and tests for API fallback and AI evidence.

After static analysis, Sentinel probes only configured API and UI targets:

- Any HTTP response means the service is reachable, including `401`, `404`, and `500`.
- Connection refusal, DNS/TLS failure, or timeout means unavailable.
- A reachable API receives safe runtime checks.
- An unavailable API receives static fallback analysis.
- A reachable UI receives Playwright checks.
- An unavailable UI produces explicit skipped results.

Sentinel never scans localhost ports and never starts, stops, or restarts target services.

## Common Check and Result Model

Each check has a stable ID, title, analysis level, phase, prerequisite rule, and plain check function.

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

- No issue produces one `Pass / Info` result.
- A missing prerequisite produces one `Skipped / Info` result with an enablement recommendation.
- Independently actionable subjects produce separate warning or failure results.
- A check does not emit a generic pass alongside issue results.
- Internal execution errors are not normal skips: they use a diagnostic code and make the report summary state that the scan was incomplete.
- All evidence and diagnostics are redacted before being stored or rendered.
- Summary counts are based on normalized results; the MVP does not add a second coverage-counting system.

## Configuration

The optional `sentinel.config.json` contains only MVP settings for:

- Target and report locations.
- API base URL, health path, safe endpoints, expectations, timeouts, latency thresholds, and authentication references.
- UI base URL, pages, two viewports, storage state or header references, and bounded form flows.
- AI enablement, provider/model settings, credential reference, timeout, and input limit.

Configuration precedence is:

1. Existing process environment.
2. `.env`.
3. `sentinel.config.json`.
4. Safe built-in defaults.

Credentials are resolved from environment-variable references and must never be written to reports or logs. Target URLs, ports, paths, credentials, endpoint parameters, and authentication values must not be hardcoded in production source.

Rule customization, custom secret-pattern languages, and per-check plugin configuration are outside the MVP.

## Graceful Degradation

Sentinel should produce the most complete report possible:

| Condition                                              | Behavior                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| No config or runtime URLs                              | Scan the current directory statically; skip affected runtime checks.                 |
| API unavailable                                        | Record availability and run static API fallback.                                     |
| UI unavailable                                         | Emit skipped browser results with a reason and recommendation.                       |
| Authentication absent                                  | Run public checks and skip only protected expectations.                              |
| OpenAPI invalid                                        | Warn and attempt best-effort route/schema fallback.                                  |
| `package-lock.json` or npm audit unavailable           | Skip vulnerability lookup; never claim the project is clean.                         |
| Playwright launch fails                                | Continue other checks and mark the scan incomplete.                                  |
| AI disabled, provider unselected, or credential absent | Skip only the AI check; the scan remains complete.                                   |
| AI provider timeout/failure or invalid response        | Skip only the AI check, continue deterministic checks, and mark the scan incomplete. |
| Individual check throws                                | Emit a redacted execution diagnostic and mark the overall scan incomplete.           |
| Target root unreadable or report cannot be written     | Treat as a fatal tool error.                                                         |

The CLI returns a nonzero exit code only for fatal tool errors. Target findings, unavailable services, and isolated check failures remain report content.

## OpenAPI and Runtime Safety

OpenAPI support is deliberately shallow:

- Parse OpenAPI 3.0/3.1 JSON or YAML documents.
- Inventory operations and select configured or safe `GET`, `HEAD`, and `OPTIONS` endpoints.
- Check expected status, content type, JSON parseability, and configured or top-level required fields.
- Treat route-source discovery as best-effort and visibly incomplete.

Deep schema composition, comprehensive `$ref` resolution, generated payloads, and complete contract validation are outside scope.

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

- One small provider boundary with explicit OpenAI and Claude adapters.
- Mandatory provider selection when AI is enabled; Sentinel never infers a provider from available credentials.
- At most one bounded request to the selected provider per scan.
- A strict structured response.
- Exact citations limited to evidence supplied in the request.
- Repository and target-secret redaction, plus input-size limits, before evidence transmission.
- Deterministic validation and mapping into Sentinel results.
- No multi-turn workflow, provider registry, or elaborate retry system.

The selected provider credential may be sent only as an authentication header to that provider. Real credential values must never enter prompts, request bodies, response evidence, reports, logs, tests, or documentation.

The overall report summary remains deterministic. When paid credentials are absent, all deterministic checks run and the AI check is `Skipped / Info`. The committed sample report must demonstrate a real AI-enabled run.

The current feasibility spike is intentionally synthetic: it sends only a fixed, secret-free contract-and-test fixture through the selected provider. It uses process environment variables for enablement, explicit provider selection, and provider-specific credentials. Real repository evidence selection and redaction remain part of the later production AI milestone.

## Testing Strategy

Automated tests use Vitest. `npm run check` is the milestone-completion gate and runs formatting verification, linting, compilation, and the test suite.

Required unit tests focus on:

- Configuration precedence and validation.
- Environment-reference resolution and redaction.
- Result invariants and summary counts.
- File exclusion and Node detection.
- Safe endpoint selection and shallow response expectations.
- AI response and citation validation.

Required integration tests cover:

- Dormant generic and Node repository scans.
- Unreachable API/UI degradation and static fallback.
- Controlled HTTP observations.
- Recorded npm audit output.
- Disabled, valid, and invalid fake-AI responses.
- Required report-field completeness.

Live paid-AI calls, live vulnerability databases, full browser matrices, and external repositories are not part of the automated test suite. A complete automated CLI/Playwright smoke test is a stretch goal; the demo sample run remains mandatory.

## Implementation Order

1. Build a vertical slice: CLI, minimal config, result model, one repository check, and Markdown report.
2. Perform an early AI risk spike using one fixture, explicit OpenAI and Claude adapters, one selected-provider request, and one cited structured result.
3. Implement configuration, redaction, inventory, stack detection, and generic repository checks.
4. Add secret detection and npm-only vulnerability analysis.
5. Add service probes, shallow OpenAPI fallback, and safe API/security runtime checks.
6. Add the Playwright lifecycle and required browser checks.
7. Complete the bounded AI check and no-AI behavior.
8. Harden tests, generate the demo report, complete the README, and assemble Cursor evidence.
9. Attempt stretch work only after all required deliverables pass.

Capture genuine Cursor evidence throughout these milestones rather than reconstructing it at the end.

## Explicitly Out of Scope

- Long-running service, dashboard, or hosted UI.
- Automatic service startup or port scanning.
- Deep Python, Java, Go, pnpm, or Yarn adapters.
- Non-read-only API operations, fuzzing, exploitation, or load testing.
- Complete OpenAPI/JSON Schema validation.
- Automatic form discovery or application-specific login automation.
- Git-history secret scanning or full SAST/data-flow analysis.
- Visual regression or multi-browser/device matrices.
- AI providers beyond OpenAI and Claude, multi-turn agents, provider comparison, or a provider plugin system.
- Dynamic check plugins, dependency-injection frameworks, event buses, or job schedulers.
- Additional report formats before the Markdown MVP is complete.
- Automated fixes or target-source modification.
