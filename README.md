# Sentinel

Sentinel is a TypeScript CLI under active development for reviewing the quality of local software projects.

## Project Goal

Deliver a polished, reviewable MVP that demonstrates deliberate quality-engineering decisions within a 2-3 business-day implementation window. The project favors useful, explainable findings and graceful degradation over broad but shallow coverage.

## Current Status

**Foundation, AI feasibility, and tooling scaffold milestones complete.**

Sentinel currently:

- Compiles to a runnable Node.js CLI.
- Uses Commander for CLI behavior and Zod for the implemented AI environment boundary.
- Scans the current working directory.
- Checks whether a recognized README exists at the repository root.
- Runs or gracefully skips one synthetic semantic API test-gap check.
- Supports explicit OpenAI or Claude selection for that synthetic check.
- Validates structured AI findings and rejects unsupported evidence citations.
- Produces a structured Markdown report with summary, status, severity, finding, and recommendation fields.
- Returns a nonzero exit code only when the scan cannot run or the report cannot be written.

General configuration, stack detection, broader repository/security checks, runtime checks, Playwright browser automation, and production repository evidence selection are not implemented yet. The Playwright library is installed for the planned browser milestone, but browser binaries are intentionally not installed.

## Development Setup

Prerequisites:

- Node.js 20.19 or later.
- npm.

From a clean clone, install dependencies:

```sh
npm install
```

Then run the current scan against the repository in the current working directory:

```sh
npm start
```

`npm start` builds the project automatically and writes `sentinel-report.md` in the current working directory. No environment configuration is required for this default, AI-disabled path.

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
npm run check        # Run formatting, linting, build, and tests
```

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

When AI is enabled, `SENTINEL_AI_PROVIDER` is required. Missing selection or credentials produces a normal `Skipped / Info` result. Provider or invalid-response failures affect only the AI check, mark the report incomplete, and do not produce a nonzero exit code.

The spike uses fixed models (`gpt-5.6-luna` and `claude-haiku-4-5`), one request, an 8 KiB evidence limit, a 512-token output limit, and a 20-second timeout. A request against the synthetic fixture is expected to cost well under USD $0.01 at current list prices; Sentinel does not embed provider pricing.

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
- Redact repository and target secrets before logging, reporting, persistence, or AI evidence transmission; use provider credentials only as authentication headers.
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
- One selected-provider, bounded LLM-based semantic test-gap analysis using OpenAI or Claude.
- Graceful behavior when services, configuration, tools, or optional AI credentials are unavailable.
- Focused automated tests, a reproducible demo target, a sample report, and genuine development-process evidence.

This list describes the approved implementation target, not functionality currently available.

## Planned Milestones

1. **Complete:** Establish the CLI-to-report vertical slice.
2. **Complete:** Validate the bounded multi-provider AI approach with an early synthetic risk spike.
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
├── .github/
│   └── workflows/
│       └── ci.yml
├── src/
│   ├── ai/
│   │   ├── check.ts
│   │   ├── claude.ts
│   │   ├── config.ts
│   │   ├── fixture.ts
│   │   ├── openai.ts
│   │   └── provider.ts
│   ├── checks/
│   │   └── repository-readme.ts
│   ├── core/
│   │   └── result.ts
│   ├── report/
│   │   └── markdown.ts
│   ├── cli.ts
│   └── scan.ts
├── tests/
│   ├── support/
│   │   └── fake-ai-provider.ts
│   ├── ai-check.test.ts
│   ├── ai-config.test.ts
│   ├── ai-provider.test.ts
│   ├── cli.test.ts
│   ├── result.test.ts
│   └── scan-report.test.ts
├── .prettierignore
├── .prettierrc.json
├── AGENTS.md
├── README.md
├── docs/
│   ├── architecture.md
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

- **Foundation — complete:** executable project skeleton, common result model, one repository check, and Markdown reporting.
- **Tooling — complete:** reproducible npm setup, CLI/config libraries, Vitest, linting, formatting, and CI checks; Playwright browser installation remains deferred.
- **Static analysis:** configuration, repository inventory, Node detection, repository checks, and security checks.
- **Runtime analysis:** service detection, API fallback/runtime checks, and Playwright checks.
- **AI analysis:** synthetic multi-provider feasibility is complete; production evidence selection and redaction remain planned.
- **Submission readiness:** tests, demo target, sample report, documentation, and process evidence.

## README Maintenance by Milestone

This README should grow with implemented behavior rather than describe planned functionality as complete:

| Milestone                         | README sections to complete or update                                                                                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundation                        | Completed: Current Status, Development Setup, Project Structure, and the first verified command now reflect the implementation.                                   |
| Configuration and static analysis | Update Current Status and MVP Scope; add configuration and supported-check documentation based on implemented behavior.                                           |
| API runtime and fallback          | Update MVP Scope and Project Structure; document verified runtime prerequisites and degradation behavior.                                                         |
| Playwright                        | Update MVP Scope; document supported browser checks and any verified limitations.                                                                                 |
| AI feasibility spike              | Completed: Current Status, Development Setup, Project Structure, provider behavior, synthetic data handling, limits, and fallback now reflect the implementation. |
| Production AI integration         | Replace synthetic-only guidance with verified evidence selection, redaction, configuration, and sample-report behavior.                                           |
| Submission readiness              | Replace planning-oriented status text; add verified usage, sample-report, testing, known-gap, and process-evidence sections.                                      |

Planned items should be removed or marked complete only after their implementation and tests are verified.
