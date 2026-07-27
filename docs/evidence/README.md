# Sentinel Development Evidence

This directory contains screenshots selected from genuine development sessions
used to build Sentinel. They record requirements analysis, design decisions,
milestone planning, implementation reviews, runtime validation, and
submission-readiness audits. The images were exported into this directory near
the end of the work, so their filesystem timestamps describe the export batch,
not when each underlying session occurred.

The numbered filenames preserve the session sequence. This index provides the
annotations needed to interpret each capture. Related commit hashes are
correlations based on the visible task and the corresponding Git diff; no
screenshot displays a commit hash, so those mappings are not presented as
direct proof.

## Development Workflow

Sentinel was developed as a sequence of bounded milestones:

1. Read the brief in full, separate hard requirements from design choices, and
   review the proposed architecture before writing code.
2. Record the approved scope and decisions as the implementation baseline.
3. Establish a small CLI-to-report vertical slice and de-risk the mandatory AI
   integration early.
4. Add strict configuration, isolated concurrent execution, validated reports,
   and static repository analysis.
5. Build a deliberately flawed sample target, then add Security, API, and
   Playwright checks one level at a time.
6. Repeatedly review implementations against their plans, add regression tests,
   run the demo in different runtime states, and challenge whether every Pass
   was earned.
7. Audit the finished MVP against the original brief and use the findings to
   drive submission hardening.

The Git history corroborates that progression. It is linear rather than
squashed into one final implementation commit:

| Phase                             | Commits                         | Result                                                                                                                                 |
| --------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Inception and design baseline     | `afd99e9`, `ce6a1fb`            | Seeded the repository, then documented scope, architecture, decisions, and agent rules before production code.                         |
| Executable foundation and tooling | `564eded`, `24e187f`, `e7c80d6` | Added the first CLI/report slice, the early multi-provider AI spike, and clean-machine tooling/CI.                                     |
| Platform core                     | `69d306a`, `aa9edd8`, `33c8f39` | Added strict configuration, cached reachability with concurrent level execution, and validated Markdown/JSON/terminal reporting.       |
| Static analysis and demo          | `7369a43`, `acf114b`            | Added bounded repository analysis and the standalone deliberately flawed sample application.                                           |
| Security and AI hardening         | `59f7997`, `c12552c`, `3e45588` | Added five Security checks, hardened provider-neutral fail-closed AI execution, and documented a manual synthetic OpenAI verification. |
| Runtime API and browser analysis  | `310de71`, `dc33341`            | Added exclusive live/static API analysis and the shared Playwright Chromium session.                                                   |
| Truthfulness hardening            | `06cc64a`                       | Tightened repository evidence and narrowed the UI claim from general responsiveness to observed horizontal overflow.                   |

The artifacts reviewed for this index also show a submission-hardening phase
after `06cc64a`, including target-derived AI evidence, report-summary
corrections, a sample-report candidate intended for a tracked location, and
this evidence pack. That phase is separate from the 16-commit timeline above
because it had no commit at the time of this evidence review.

## Screenshot Catalog

### Phase 1 - Requirements, scope, and architecture

| Screenshot         | Title                          | Description                                                                                                                                                                                                                 | Development phase      | Engineering goal                                                                           | Related history                                                          |
| ------------------ | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| [`1.jpg`](./1.jpg) | Brief ingestion                | Shows the assignment PDF being read in full and the request to separate hard requirements, deliverables, evaluation criteria, and genuine ambiguities before coding.                                                        | Requirements discovery | Establish the authoritative requirement set and avoid implementing from a partial reading. | Pre-implementation work leading to `ce6a1fb`; no direct commit is shown. |
| [`2.jpg`](./2.jpg) | Proposed shallow structure     | Shows an intentionally shallow proposed module tree for CLI, configuration, core, inventory, runtime, checks, reporting, and tests. The proposal differs from the final tree and is retained as historical design evidence. | Architecture design    | Define proportional module boundaries without speculative framework code.                  | Precedes the approved baseline in `ce6a1fb`.                             |
| [`3.jpg`](./3.jpg) | Staff-level design review      | Shows a no-code architecture review that approved the overall direction while identifying excessive OpenAPI scope as a High concern.                                                                                        | Architecture review    | Challenge scope, coupling, complexity, and delivery risk before implementation.            | Review input incorporated into `ce6a1fb`.                                |
| [`4.jpg`](./4.jpg) | Architecture baseline recorded | Shows creation of `docs/architecture.md`, `docs/decisions.md`, and `AGENTS.md` as the source of truth. The visible sequential-execution wording is historical and was later superseded.                                     | Baseline documentation | Preserve approved boundaries and instructions for later milestones.                        | Strongly correlates with `ce6a1fb`.                                      |

### Phase 2 - First vertical slice, AI risk spike, and tooling

| Screenshot         | Title                          | Description                                                                                                                                                                                    | Development phase         | Engineering goal                                                                            | Related history                                  |
| ------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| [`5.jpg`](./5.jpg) | First runnable vertical slice  | Shows the smallest production milestone: CLI to repository check to normalized result to Markdown report, with future capabilities explicitly excluded.                                        | Foundation implementation | Produce a compilable, runnable end-to-end path that later checks could reuse.               | Strongly correlates with `564eded`.              |
| [`6.jpg`](./6.jpg) | Early AI feasibility planning  | Shows the bounded synthetic-fixture spike used to de-risk the mandatory LLM requirement before the broader scanner existed. The screenshot is planning evidence, not proof of a provider call. | AI feasibility            | Validate structured, cited AI analysis and graceful no-credential behavior early.           | Precedes and strongly correlates with `24e187f`. |
| [`7.jpg`](./7.jpg) | Tooling and clean-machine plan | Shows the TypeScript, Commander, Zod, Vitest, ESLint, Prettier, GitHub Actions, and Playwright dependency plan, including the decision not to download browsers during `npm install`.          | Tooling and CI            | Make clone-install-run reproducible without coupling package installation to a browser CDN. | Strongly correlates with `e7c80d6`.              |

### Phase 3 - Configuration and execution core

| Screenshot           | Title                                         | Description                                                                                                                                                      | Development phase     | Engineering goal                                                                                                | Related history                                                                                                   |
| -------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [`8.jpg`](./8.jpg)   | Strict configuration design                   | Shows the plan for a recursively strict Zod schema, path-specific failures, unknown-key rejection, and configuration-owned target values.                        | Configuration design  | Prevent hardcoded target values and silent fallback from invalid configuration.                                 | Strongly correlates with `69d306a`.                                                                               |
| [`9.jpg`](./9.jpg)   | Configuration review and regression discovery | Shows a concrete review finding: BOM-prefixed `.env` input could be ignored and trailing quoted content could be accepted, plus missing reference documentation. | Review and hardening  | Find silent configuration degradation and turn the reproductions into regression tests and documentation fixes. | Correlates with the review/fix cycle completed in `69d306a`; the screenshot itself does not show the fix landing. |
| [`10.jpg`](./10.jpg) | Concurrent runner design                      | Shows the Check/CheckResult/ScanContext plan, one cached reachability probe, four concurrent analysis levels, per-check timeout, and failure isolation.          | Core execution design | Ensure unreachable services and broken checks become scoped report rows rather than scan crashes.               | Strongly correlates with `aa9edd8`.                                                                               |

`33c8f39`, the validated multi-format report milestone, has no dedicated
screenshot. Later scan captures exercise its report model, but that is indirect
evidence.

### Phase 4 - Repository analysis and the sample target

| Screenshot           | Title                           | Description                                                                                                                                           | Development phase          | Engineering goal                                                                                     | Related history                                                                                                      |
| -------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [`11.jpg`](./11.jpg) | Static repository analysis plan | Shows the eight root-focused checks, the zero-service requirement, bounded npm freshness, and honest placeholders for unfinished levels.              | Code and Repository design | Deliver useful static analysis without requiring a running target.                                   | Strongly correlates with `7369a43`.                                                                                  |
| [`12.jpg`](./12.jpg) | Early sample-target scan        | Shows a real generated report for `sample-app` with 17 results and a mix of passes, warnings, and skips before the remaining levels were implemented. | Demo integration           | Exercise the static scanner against a reproducible target and question whether its rows were earned. | Correlates with `7369a43` and the sample target in `acf114b`; it demonstrates scanning the app, not constructing it. |

The sample application's construction in `acf114b` has no dedicated capture;
`12.jpg` is the first direct visual evidence that it was being used.

### Phase 5 - Security and provider-neutral AI

| Screenshot           | Title                           | Description                                                                                                                                                                   | Development phase        | Engineering goal                                                                                      | Related history                                                                                                                                   |
| -------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`13.jpg`](./13.jpg) | Security-level design           | Shows the five-check Security plan and explicitly calls out the `npm audit --json` trap that could otherwise create a false clean result.                                     | Security design          | Add dependency, secret, environment, header, CORS, and debug checks with fail-closed audit semantics. | Strongly correlates with `59f7997`.                                                                                                               |
| [`14.jpg`](./14.jpg) | Provider-neutral AI hardening   | Shows the plan to keep vendor envelopes out of check logic, use native schema-constrained output, enforce one paid call, and treat unrecognized responses as unavailable.     | AI hardening             | Prevent free-text recovery, unbounded paid calls, and false benign AI outcomes.                       | Strongly correlates with `c12552c`.                                                                                                               |
| [`15.jpg`](./15.jpg) | Key/no-key comparison procedure | Shows the planned comparison between an explicit missing-key skip and one keyed OpenAI run. The screenshot explicitly says the paid run had not yet occurred in that session. | AI verification planning | Verify that missing credentials produce an honest note instead of a guessed result.                   | Loosely correlates with the work preceding documentation commit `3e45588`; it is not evidence of the successful provider response recorded there. |

### Phase 6 - API and Playwright runtime analysis

| Screenshot           | Title                               | Description                                                                                                                                                                  | Development phase | Engineering goal                                                                | Related history                                                                                         |
| -------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [`16.jpg`](./16.jpg) | Exclusive API mode design           | Shows the live contract/status/shape/latency plan and static OpenAPI fallback, including the decision to configure the contract path rather than guess it.                   | API design        | Guarantee that exactly one live or static mode produces real findings per scan. | Strongly correlates with `310de71`.                                                                     |
| [`17.jpg`](./17.jpg) | Composite Playwright session design | Shows the mandatory Playwright/axe scope and the decision to use one composite check so one browser launch supplies all observations and one launch failure yields one skip. | UI design         | Share browser state safely while preserving graceful degradation.               | Strongly correlates with `dc33341`. The visible responsive terminology was later narrowed in `06cc64a`. |

### Phase 7 - Integrated validation and skeptical review

| Screenshot           | Title                         | Description                                                                                                                                                                                                                                                                                                          | Development phase             | Engineering goal                                                                           | Related history                                                                                                                                       |
| -------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`18.jpg`](./18.jpg) | Demo running versus stopped   | Shows two full scans that both exited 0 without hangs or crashes, plus the change from live Security/API/UI findings to stopped-service fallback and skips. The Axe-driven incomplete status and “responsive layout” wording are historical behavior.                                                                | Integrated runtime validation | Prove graceful degradation and mode switching against the real demo target.                | Represents the integrated state after `dc33341` and before later truthfulness corrections in `06cc64a` and the subsequent submission-hardening phase. |
| [`19.jpg`](./19.jpg) | Row-by-row truthfulness audit | Shows a 32-row audit against files, endpoints, and page evidence. It identifies a misleading summary, target-local CI wording, and an independent-browser replay limitation. A later, stricter pass-only review found additional risks.                                                                              | Post-integration review       | Challenge clean and Pass results rather than accepting the generated report at face value. | The review cycle led into `06cc64a` and later report-summary work; no exact hash is visible.                                                          |
| [`20.jpg`](./20.jpg) | Submission-readiness audit    | Shows a sub-agent-assisted comparison with the assignment and a separate README claim audit. It identified the then-synthetic AI evidence and missing public deliverables as blockers. Some visible findings are now historical, including the statement that the public repository contained only the first commit. | Final requirements audit      | Find brief violations and unsupported claims before a reviewer does.                       | Occurs after the implemented levels and leads into the submission-hardening phase after `06cc64a`.                                                    |

## How the Implementation Evolved

The evidence shows a progression from decisions to executable behavior rather
than a single final-result dump. Early captures establish the brief and reduce
scope before code. The first implementation deliberately proves one complete
path, after which configuration, scheduling, reporting, and each analysis level
are added separately. Later captures shift from construction to skepticism:
they reproduce parser defects, compare live and dormant service behavior,
inspect individual report rows, and finally audit the whole project against the
brief.

Several historical claims were deliberately narrowed or replaced:

- Sequential execution became concurrent level execution with sequential checks
  inside each level.
- The AI feasibility fixture was later replaced by bounded target-derived
  evidence.
- General responsive wording became the narrower horizontal-overflow
  observation.
- Axe indeterminate evidence stopped making an otherwise completed scan
  `Incomplete`.

Those changes are evidence of review and correction, not contradictions in the
current documented architecture.

## Evidence Quality and Remaining Gaps

- All 20 images are distinct, and their numeric order is coherent. Several plan
  captures have a similar prompt/exploration/plan-card shape, but they cover
  different milestones.
- The strongest implementation-process captures are `9.jpg`, `12.jpg`,
  `18.jpg`, `19.jpg`, and `20.jpg` because they show a reproduced defect, scan
  output, runtime comparison, truthfulness review, or requirements audit.
- The set is weighted toward planning. It lacks direct screenshots of editor
  diffs, commit hashes, a clean-install run, the complete automated test output,
  the multi-format reporting implementation, sample-app construction, and the
  final target-derived AI request/result.
- Most application chrome is cropped. The images demonstrate the actual
  AI-assisted development workflow, but they do not independently identify the
  application as Cursor. A final capture or short screencast with Cursor and the
  repository workspace visibly identifiable would make the assignment's
  Cursor-specific requirement unambiguous.
- Some screenshots show intermediate behavior that has since changed. Their
  captions explicitly mark those states as historical so reviewers do not
  mistake them for current product claims.

Taken together with the progressive Git history, this annotated set
substantially demonstrates real, iterative engineering: requirements analysis,
architecture review, scoped implementation, debugging, regression work,
testing, documentation maintenance, runtime validation, and final
verification. The remaining Cursor-identification gap should be resolved before
representing the evidence as conclusive proof of the assignment's
Cursor-specific deliverable.
