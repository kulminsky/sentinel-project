# Sentinel Quality Report

- **Target:** sample-app
- **Generated:** 2026-07-27T16:17:21.921Z

## Overall Summary

- **Scan status:** Complete
- **Results:** 32
- **Status counts:** Pass 15, Warn 10, Fail 5, Skipped 2
- **Severity counts:** Critical 0, High 4, Medium 5, Low 6, Info 17

Sentinel produced 32 results: 15 passed, 10 warnings, 5 failed, and 2 skipped. All available checks completed without internal execution errors.

## Code & Repository

### Gitignore coverage

- **Status:** Pass
- **Severity:** Info
- **Phase:** static
- **Subject:** .gitignore
- **Duration:** 20 ms
- **Finding:** The root .gitignore covers the applicable environment, platform, dependency, and generated-output paths.
- **Recommendation:** Keep ignore rules synchronized with generated files and build outputs.
- **Evidence:**
  - Covered: environment files
  - Covered: macOS metadata
  - Covered: Node dependencies
  - Covered: TypeScript output

### Linter and formatter configuration

- **Status:** Pass
- **Severity:** Info
- **Phase:** static
- **Duration:** 5 ms
- **Finding:** Readable, nonempty linter and formatter configuration with supporting package or relevant npm-script evidence was detected at the repository root.
- **Recommendation:** Keep the detected configuration and supporting tooling synchronized with the development workflow.
- **Evidence:**
  - Readable linter config: eslint.config.mjs
  - Readable formatter config: .prettierrc.json
  - Supporting linter declaration: eslint
  - Supporting formatter declaration: prettier

### Repository tests

- **Status:** Pass
- **Severity:** Info
- **Phase:** static
- **Duration:** 2 ms
- **Finding:** Test artifacts detected: readable, nonempty files and a non-placeholder npm test script are present.
- **Recommendation:** Run the detected test workflow regularly and keep its artifacts aligned with implemented behavior.
- **Evidence:**
  - tests/app.test.ts

### Continuous integration configuration

- **Status:** Warn
- **Severity:** Low
- **Phase:** static
- **Duration:** 0 ms
- **Finding:** No recognized CI configuration was found.
- **Recommendation:** Add a CI pipeline that installs dependencies and runs the repository quality checks.

### TypeScript strictness

- **Status:** Pass
- **Severity:** Info
- **Phase:** static
- **Subject:** tsconfig.json
- **Duration:** 5 ms
- **Finding:** The resolved root TypeScript configuration enables strict mode without disabling a strict-family option.
- **Recommendation:** Keep strict TypeScript compiler checks enabled as the project evolves.

### Dependency freshness

- **Status:** Warn
- **Severity:** Low
- **Phase:** static
- **Subject:** @types/lodash
- **Duration:** 915 ms
- **Finding:** @types/lodash has a newer release outside its declared range.
- **Recommendation:** Review the newer @types/lodash release and compatibility before changing the declared range.
- **Evidence:**
  - Current: 4.17.20
  - Wanted: 4.17.20
  - Latest: 4.17.24

### Dependency freshness

- **Status:** Warn
- **Severity:** Low
- **Phase:** static
- **Subject:** @types/node
- **Duration:** 915 ms
- **Finding:** @types/node has a newer release outside its declared range.
- **Recommendation:** Review the newer @types/node release and compatibility before changing the declared range.
- **Evidence:**
  - Current: 20.19.43
  - Wanted: 20.19.43
  - Latest: 26.1.1

### Dependency freshness

- **Status:** Warn
- **Severity:** Low
- **Phase:** static
- **Subject:** lodash
- **Duration:** 915 ms
- **Finding:** lodash has a newer release outside its declared range.
- **Recommendation:** Review the newer lodash release and compatibility before changing the declared range.
- **Evidence:**
  - Current: 4.17.20
  - Wanted: 4.17.20
  - Latest: 4.18.1

### Dependency freshness

- **Status:** Warn
- **Severity:** Low
- **Phase:** static
- **Subject:** typescript
- **Duration:** 915 ms
- **Finding:** typescript has a newer release outside its declared range.
- **Recommendation:** Review the newer typescript release and compatibility before changing the declared range.
- **Evidence:**
  - Current: 6.0.3
  - Wanted: 6.0.3
  - Latest: 7.0.2

### Dependency lockfile

- **Status:** Pass
- **Severity:** Info
- **Phase:** static
- **Subject:** package-lock.json
- **Duration:** 2 ms
- **Finding:** The npm lockfile is valid and its available root dependency declarations match package.json.
- **Recommendation:** Keep the npm lockfile committed and synchronized with package.json.
- **Evidence:**
  - Lockfile version: 3

### Repository README quality

- **Status:** Pass
- **Severity:** Info
- **Phase:** static
- **Subject:** README.md
- **Duration:** 1 ms
- **Finding:** README.md contains meaningful purpose, setup, and usage guidance.
- **Recommendation:** Keep README guidance synchronized with the verified implementation and workflow.
- **Evidence:**
  - Present: meaningful content
  - Present: project purpose
  - Present: setup or development guidance
  - Present: usage guidance

## Security

### npm dependency vulnerability audit

- **Status:** Fail
- **Severity:** High
- **Phase:** static
- **Subject:** lodash
- **Duration:** 1006 ms
- **Finding:** npm audit reported a high severity vulnerability for lodash.
- **Recommendation:** Review the advisory and update or replace the affected dependency without bypassing compatibility checks.
- **Evidence:**
  - Package: lodash
  - Dependency: direct
  - Affected range: <=4.17.23
  - Fix available: yes

### High-confidence secret scan

- **Status:** Pass
- **Severity:** Info
- **Phase:** static
- **Duration:** 8 ms
- **Finding:** No high-confidence credential or private-key signatures were detected in the bounded non-ignored files.
- **Recommendation:** Continue using ignored environment files and an approved secret store.
- **Evidence:**
  - Files scanned: 15
  - Content scanned: 27596 bytes

### Environment file hygiene

- **Status:** Pass
- **Severity:** Info
- **Phase:** static
- **Duration:** 0 ms
- **Finding:** No problematic environment-file ignore state was detected.
- **Recommendation:** Keep real environment files ignored and templates limited to placeholders.
- **Evidence:**
  - Real environment files reviewed: 0
  - Environment templates reviewed: 0

### Runtime security headers and CORS

- **Status:** Warn
- **Severity:** Low
- **Phase:** runtime
- **Subject:** API response headers
- **Duration:** 760 ms
- **Finding:** Observed API responses are missing baseline headers or use policies whose strength Sentinel could not verify.
- **Recommendation:** Set restrictive header policies centrally and verify them on every public response.
- **Evidence:**
  - Missing X-Content-Type-Options: nosniff: GET /api/catalog, GET /api/profile, GET /api/public-feed, GET /api/slow

### Runtime security headers and CORS

- **Status:** Warn
- **Severity:** Medium
- **Phase:** runtime
- **Subject:** API CORS policy
- **Duration:** 760 ms
- **Finding:** Wildcard cross-origin access was observed on one or more API responses.
- **Recommendation:** Replace wildcard CORS with an explicit origin allowlist unless public cross-origin access is intentional.
- **Evidence:**
  - Wildcard origin: GET /api/public-feed

### Runtime security headers and CORS

- **Status:** Warn
- **Severity:** Medium
- **Phase:** runtime
- **Subject:** UI response headers
- **Duration:** 760 ms
- **Finding:** Observed UI responses are missing baseline headers or use policies whose strength Sentinel could not verify.
- **Recommendation:** Set restrictive header policies centrally and verify them on every public response.
- **Evidence:**
  - Missing Content-Security-Policy: GET /
  - Missing frame protection: GET /
  - Missing X-Content-Type-Options: nosniff: GET /
  - Missing Referrer-Policy: GET /
  - Missing Permissions-Policy: GET /

### Evidence-derived debug endpoints

- **Status:** Fail
- **Severity:** High
- **Phase:** runtime
- **Subject:** API /debug/config
- **Duration:** 6 ms
- **Finding:** A discovered debug-like endpoint was publicly reachable without authentication.
- **Recommendation:** Remove the endpoint from production or require explicit authorization and network restrictions.
- **Evidence:**
  - Method: GET
  - Path: /debug/config
  - Source: src/app.ts:68
  - HTTP status: 200

## API / Backend

### API service availability

- **Status:** Pass
- **Severity:** Info
- **Phase:** runtime
- **Duration:** 12 ms
- **Finding:** The configured API service responded to the central reachability probe.
- **Recommendation:** Keep the configured API service available for runtime verification.
- **Evidence:**
  - HTTP status: 200
  - Probe duration: 12 ms

### Live API contract and latency

- **Status:** Pass
- **Severity:** Info
- **Phase:** runtime
- **Subject:** GET /api/catalog
- **Duration:** 11 ms
- **Finding:** The endpoint matched its configured status, supported OpenAPI response contract, and latency threshold.
- **Recommendation:** Keep this endpoint contract and latency expectation covered by Sentinel.
- **Evidence:**
  - Observed status: 200
  - Response latency: 11 ms
  - Latency threshold: 250 ms

### Live API contract and latency

- **Status:** Fail
- **Severity:** High
- **Phase:** runtime
- **Subject:** GET /api/profile
- **Duration:** 3 ms
- **Finding:** The live endpoint violated its contract: the JSON body did not match the shallow OpenAPI shape.
- **Recommendation:** Align the endpoint response with its configured and OpenAPI contract, then rerun the live check.
- **Evidence:**
  - Observed status: 200
  - Response latency: 3 ms
  - Latency threshold: 250 ms

### Live API contract and latency

- **Status:** Pass
- **Severity:** Info
- **Phase:** runtime
- **Subject:** GET /api/public-feed
- **Duration:** 2 ms
- **Finding:** The endpoint matched its configured status, supported OpenAPI response contract, and latency threshold.
- **Recommendation:** Keep this endpoint contract and latency expectation covered by Sentinel.
- **Evidence:**
  - Observed status: 200
  - Response latency: 2 ms
  - Latency threshold: 250 ms

### Live API contract and latency

- **Status:** Warn
- **Severity:** Medium
- **Phase:** runtime
- **Subject:** GET /api/slow
- **Duration:** 752 ms
- **Finding:** The endpoint could not earn a full live contract pass: the latency threshold was exceeded.
- **Recommendation:** Resolve the contract limitation or latency regression, then rerun the live check.
- **Evidence:**
  - Observed status: 200
  - Response latency: 752 ms
  - Latency threshold: 250 ms

### Static OpenAPI fallback

- **Status:** Skipped
- **Severity:** Info
- **Phase:** static
- **Duration:** 0 ms
- **Finding:** The cached API reachability result selected live contract analysis, so static fallback did not produce findings.
- **Recommendation:** Use the live results for this scan; static fallback runs only when the next central API probe is unavailable.
- **Diagnostic:** API_FALLBACK_NOT_SELECTED

### AI API test-gap analysis

- **Status:** Skipped
- **Severity:** Info
- **Phase:** AI
- **Subject:** Target API contract and test evidence
- **Duration:** 0 ms
- **Finding:** AI analysis is enabled for OpenAI, but its credential is unavailable.
- **Recommendation:** Set OPENAI_API_KEY in the process environment and retry.
- **Diagnostic:** AI_CREDENTIAL_MISSING

## UI / Browser

### UI service availability

- **Status:** Pass
- **Severity:** Info
- **Phase:** runtime
- **Duration:** 13 ms
- **Finding:** The configured UI service responded to the central reachability probe.
- **Recommendation:** Keep the configured UI service available for runtime verification.
- **Evidence:**
  - HTTP status: 200
  - Probe duration: 13 ms

### Playwright browser analysis

- **Status:** Pass
- **Severity:** Info
- **Phase:** runtime
- **Subject:** Page load: home
- **Duration:** 1133 ms
- **Finding:** The configured page loaded successfully at both configured viewports.
- **Recommendation:** Keep the page available with successful same-origin responses.
- **Evidence:**
  - mobile: HTTP 200
  - desktop: HTTP 200

### Playwright browser analysis

- **Status:** Warn
- **Severity:** Medium
- **Phase:** runtime
- **Subject:** Console: home
- **Duration:** 1133 ms
- **Finding:** The page produced 4 console error event(s).
- **Recommendation:** Remove unexpected console errors or handle the underlying client-side failures.
- **Evidence:**
  - Console error events: 4

### Playwright browser analysis

- **Status:** Fail
- **Severity:** Medium
- **Phase:** runtime
- **Subject:** Images: home
- **Duration:** 1133 ms
- **Finding:** The page contains 1 broken image resource(s).
- **Recommendation:** Restore the missing image resources or correct their source paths.
- **Evidence:**
  - Image path: /assets/missing-product.png

### Playwright browser analysis

- **Status:** Fail
- **Severity:** High
- **Phase:** runtime
- **Subject:** Accessibility: home
- **Duration:** 1133 ms
- **Finding:** The axe WCAG A/AA scan detected 1 accessibility rule violation(s), while 1 additional rule(s) remained indeterminate.
- **Recommendation:** Correct the reported axe rules and verify the page with assistive-technology-focused testing.
- **Diagnostic:** UI_ACCESSIBILITY_PARTIAL
- **Evidence:**
  - Rule: label; impact: critical; affected nodes: 1
  - Indeterminate rule: color-contrast; affected nodes: 12

### Playwright browser analysis

- **Status:** Pass
- **Severity:** Info
- **Phase:** runtime
- **Subject:** Horizontal overflow: home
- **Duration:** 1133 ms
- **Finding:** The page has no horizontal document overflow at either configured viewport.
- **Recommendation:** Keep horizontal-overflow observations active for both configured viewport sizes; use explicit configured assertions for other layout behavior.

### Playwright browser analysis

- **Status:** Pass
- **Severity:** Info
- **Phase:** runtime
- **Subject:** Form flow: subscription
- **Duration:** 1133 ms
- **Finding:** The configured form flow completed all actions and assertions.
- **Recommendation:** Keep this bounded flow synchronized with the user journey it verifies.
