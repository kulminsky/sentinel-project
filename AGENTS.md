# Sentinel Agent Instructions

These instructions apply to the entire repository.

- Treat `docs/architecture.md` as the current implemented architecture and `docs/decisions.md` as its approved constraints. Use `docs/configuration.md` for the configuration contract, `README.md` for the reviewer runbook, and the codebase as the authority for executable behavior.
- Keep each change limited to the current requested milestone and stop when that milestone is complete.
- Prefer KISS, plain functions, fixed check registration, and small explicit boundaries.
- Avoid speculative abstractions, class hierarchies, plugin systems, dependency-injection containers, and unrequested flexibility.
- Do not expand supported stacks, the approved Markdown/JSON/terminal report formats, providers, browsers, or runtime behavior without explicit approval.
- Never hardcode target URLs, ports, filesystem paths, endpoint parameters, credentials, or authentication values.
- Preserve centralized setup, cached reachability, concurrent analysis-level execution, and graceful degradation. Checks remain sequential within each level; missing services or optional credentials must not crash a scan.
- Preserve exclusive API mode selection: cached API reachability enables either live contract checks or static OpenAPI fallback, never both in one scan.
- Keep all browser automation in Playwright.
- Keep runtime API checks read-only and never start target services.
- Never include repository or target secrets in prompts, request bodies, response evidence, reports, logs, or persisted evidence without redaction.
- Provider credentials may be sent only as authentication headers to the explicitly selected provider. Never place real credential values in prompts, request bodies, response evidence, reports, logs, tests, or documentation.
- Distinguish internal execution errors from normal skipped checks and preserve the approved exit-code behavior.
- Preserve the runtime-validated report model. Every result, including a skipped result, must contain a nonempty status, finding, severity, and recommendation.
- Run the smallest relevant test set after each change; run `npm run check` before milestone completion.
- At handoff, summarize changed files, tests run, documentation review, and remaining limitations.
- Do not begin the next milestone or add stretch work unless explicitly requested.

## Documentation Maintenance

Documentation is part of implementation, not final cleanup.

- Keep documentation synchronized continuously and review affected documentation before completing every task or milestone.
- Update only documentation affected by the current change; never describe functionality that is not implemented.
- Remove obsolete or conflicting guidance instead of retaining parallel versions.
- Keep `README.md`, `docs/architecture.md`, `docs/decisions.md`, and implementation instructions consistent with the codebase.
- Treat documentation review as part of the Definition of Done and explicitly state when it was reviewed but no update was required.
