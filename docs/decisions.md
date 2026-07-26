# Sentinel Decisions

This file records the implementation decisions approved before development. `docs/architecture.md` provides the operating detail. Changes to these decisions should be deliberate and documented here before expanding implementation scope.

| Decision | Agreed direction | Practical consequence |
|---|---|---|
| Product shape | Build a CLI, not a lightweight service. | One documented command runs a scan; there is no daemon, API server, or persistent state. |
| Report format | Markdown only for the MVP. | The committed sample report is readable on GitHub. JSON is stretch work only. |
| Supported stacks | Provide deep Node/npm support plus useful generic repository behavior. | Unknown stacks still receive static repository/security checks. Python, Java, Go, pnpm, and Yarn depth is deferred. |
| Stack detection | Detect Node/TypeScript from repository evidence; otherwise select generic mode. | Detection must change behavior meaningfully rather than only adding a label. |
| Execution model | Run static checks first, then conditionally activate runtime checks. | Dormant projects remain valid scan targets and all four levels appear in the report. |
| Service discovery | Probe only configured API/UI targets. | Do not scan ports or guess local services. Any HTTP response counts as reachable. |
| Service lifecycle | Never start, stop, or restart target services. | Missing services produce fallback or skipped results, not process execution. |
| Runtime safety | Runtime API checks are read-only. | Only configured or safe `GET`, `HEAD`, and `OPTIONS` operations are eligible. |
| Execution scheduling | Run phases and checks sequentially. | Prefer predictable behavior and cleanup over a concurrency framework. |
| Configuration | Use optional `sentinel.config.json` plus `.env` and process environment overrides. | Precedence is process environment, `.env`, JSON, then defaults. Target-specific values are never hardcoded. |
| Missing configuration | Continue every independently runnable check. | Missing runtime or AI settings produce skipped results; unreadable roots and unwritable reports remain fatal. |
| Dependency audit | Implement npm audit only for `package-lock.json`. | Other lockfiles are detected but vulnerability lookup is marked unsupported/skipped. Audit failure never means clean. |
| OpenAPI | Support shallow OpenAPI 3.0/3.1 JSON/YAML analysis. | Inventory operations and perform safe status/content/top-level shape checks; do not build a full schema engine. |
| Route fallback | Treat source-derived routes as best-effort candidates. | Never claim complete API coverage without an authoritative contract. |
| Browser automation | Use Playwright with Chromium for all browser checks. | No alternate browser automation framework or full cross-browser matrix. |
| Form checks | Run only explicitly configured, bounded form flows. | Never discover and submit arbitrary forms. |
| AI use case | Perform semantic API test-gap analysis. | Compare bounded route/contract evidence with relevant tests; do not use AI merely to summarize the report. |
| AI request model | Use one bounded request through one OpenAI-compatible boundary. | No multi-turn workflow, provider registry, or complex retry logic. |
| AI fallback | Disable the AI check gracefully when credentials are absent or the provider fails. | Deterministic checks continue and AI reports `Skipped / Info`; the sample report still demonstrates a real AI run. |
| Secret handling | Redact before storage, logging, reporting, or AI transmission. | Credentials and detected secret values must never appear in output or provider payloads. |
| Check results | Use one normalized result per stable check-and-subject pair. | Results use only the required status/severity enums and aggregate directly into the report. |
| Execution errors | Distinguish internal check errors from normal prerequisite skips. | Isolated errors remain nonfatal but produce diagnostic codes and a prominent incomplete-scan summary. |
| Exit codes | Return nonzero only for fatal tool errors. | Findings, unreachable services, and isolated check errors remain report content rather than CI policy. |
| Testing | Focus automation on risky pure logic and core degradation paths. | Full CLI/Playwright lifecycle automation is stretch work; live paid/network dependencies are excluded from normal tests. |
| Scope control | Prefer KISS and finish required deliverables before stretch work. | Do not introduce plugins, DI containers, schedulers, databases, deep multi-stack adapters, or additional report formats during the MVP. |

## Fatal Tool Errors

The agreed fatal cases are deliberately narrow:

- The target root cannot be read.
- Configuration syntax cannot be interpreted safely.
- The final report cannot be written.

All other unavailable capabilities or isolated check failures should be represented transparently in the report.
