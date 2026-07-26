# Sentinel

Sentinel is a TypeScript CLI under active development for reviewing the quality of local software projects.

## Project Goal

Deliver a polished, reviewable MVP that demonstrates deliberate quality-engineering decisions within a 2-3 business-day implementation window. The project favors useful, explainable findings and graceful degradation over broad but shallow coverage.

## Current Status

**Foundation milestone complete.**

Sentinel currently:

- Compiles to a runnable Node.js CLI.
- Scans the current working directory.
- Checks whether a recognized README exists at the repository root.
- Produces a structured Markdown report with summary, status, severity, finding, and recommendation fields.
- Returns a nonzero exit code only when the scan cannot run or the report cannot be written.

Configuration, stack detection, broader repository/security checks, runtime checks, Playwright, and AI are not implemented yet.

## Development Setup

Prerequisites:

- Node.js 20 or later.
- npm.

Install dependencies and build the project:

```sh
npm install
npm run build
```

Run the current scan against the repository in the current working directory:

```sh
npm start
```

The command writes `sentinel-report.md` in the current working directory.

Run the implemented validation checks:

```sh
npm test
```

## Architecture Documents

- [`docs/architecture.md`](docs/architecture.md) defines the approved scope, module boundaries, execution flow, result model, integration boundaries, testing strategy, and implementation order.
- [`docs/decisions.md`](docs/decisions.md) records the key scope and engineering decisions that must remain stable during the MVP.
- [`AGENTS.md`](AGENTS.md) contains repository-wide instructions for AI coding agents contributing to the project.

These documents are the source of truth until an approved decision is deliberately changed.

## Implementation Principles

- Implement only the current milestone.
- Prefer KISS, plain functions, composition, and small explicit boundaries.
- Avoid speculative abstractions and unrequested flexibility.
- Keep target-specific URLs, ports, paths, parameters, and credentials outside production source.
- Preserve static-first execution and graceful degradation.
- Keep runtime checks read-only and never start target services.
- Use Playwright for all browser automation.
- Redact secrets before logging, reporting, persistence, or AI transmission.
- Keep the project compiling and run relevant tests after each change.
- Complete required deliverables before beginning stretch work.

## Current MVP Scope

The approved MVP is scoped to:

- A TypeScript CLI with a Markdown report.
- Generic static repository and security analysis for readable local projects.
- Deeper Node.js/npm analysis when a Node project is detected.
- Static-first execution with conditional API and browser checks.
- Shallow OpenAPI analysis and read-only runtime API requests.
- Playwright-based Chromium checks for explicitly configured pages and flows.
- One bounded LLM-based semantic test-gap analysis.
- Graceful behavior when services, configuration, tools, or optional AI credentials are unavailable.
- Focused automated tests, a reproducible demo target, a sample report, and genuine development-process evidence.

This list describes the approved implementation target, not functionality currently available.

## Planned Milestones

1. **Complete:** Establish the CLI-to-report vertical slice.
2. Validate the bounded AI approach with an early risk spike.
3. Add configuration, redaction, project inventory, stack detection, and generic repository checks.
4. Add secret detection and npm-only vulnerability analysis.
5. Add service probing, shallow API fallback, and safe API/security runtime checks.
6. Add the Playwright lifecycle and required browser checks.
7. Complete AI integration and no-AI fallback behavior.
8. Harden tests and complete the demo, sample report, documentation, and process evidence.

Stretch work begins only after all required milestones and submission artifacts are complete.

## Project Structure

The repository currently contains the foundation implementation and its documentation:

```text
.
├── src/
│   ├── checks/
│   │   └── repository-readme.ts
│   ├── core/
│   │   └── result.ts
│   ├── report/
│   │   └── markdown.ts
│   ├── cli.ts
│   └── scan.ts
├── tests/
│   ├── result.test.ts
│   └── scan-report.test.ts
├── AGENTS.md
├── README.md
├── docs/
│   ├── architecture.md
│   └── decisions.md
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
5. Run the smallest relevant test set, then the broader milestone checks.
6. Update documentation only where implemented behavior or an approved decision changed.
7. Capture genuine development-process evidence.
8. Summarize changed files, tests run, and remaining limitations before stopping.

## Roadmap

- **Foundation — complete:** executable project skeleton, common result model, one repository check, and Markdown reporting.
- **Static analysis:** configuration, repository inventory, Node detection, repository checks, and security checks.
- **Runtime analysis:** service detection, API fallback/runtime checks, and Playwright checks.
- **AI analysis:** bounded semantic test-gap analysis with safe fallback behavior.
- **Submission readiness:** tests, demo target, sample report, documentation, and process evidence.

## README Maintenance by Milestone

This README should grow with implemented behavior rather than describe planned functionality as complete:

| Milestone | README sections to complete or update |
|---|---|
| Foundation | Completed: Current Status, Development Setup, Project Structure, and the first verified command now reflect the implementation. |
| Configuration and static analysis | Update Current Status and MVP Scope; add configuration and supported-check documentation based on implemented behavior. |
| API runtime and fallback | Update MVP Scope and Project Structure; document verified runtime prerequisites and degradation behavior. |
| Playwright | Update MVP Scope; document supported browser checks and any verified limitations. |
| AI integration | Update MVP Scope; document the implemented AI rationale, provider behavior, data handling, costs, and fallback. |
| Submission readiness | Replace planning-oriented status text; add verified usage, sample-report, testing, known-gap, and process-evidence sections. |

Planned items should be removed or marked complete only after their implementation and tests are verified.
