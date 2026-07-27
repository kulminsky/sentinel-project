# Sentinel Sample App

This standalone Express and TypeScript application is a deliberately flawed
target for Sentinel demonstrations. It runs entirely on loopback, keeps its data
in memory, and needs no database, credentials, or external services.

## Setup and Run

From the Sentinel repository root, install both projects and start the target:

```sh
npm install
npx playwright install chromium
npm run sample:start
```

The app listens on `http://127.0.0.1:4310` by default. In a second terminal, run
Sentinel against the committed configuration:

```sh
npm run sample:scan
```

The scan writes the ignored local file `sample-app/sentinel-report.md`. Sentinel
does not start or stop this process. With the service running, API analysis
checks each configured endpoint once: catalog and public-feed contract checks
pass, profile fails because the live body omits OpenAPI-required `plan`, and the
slow endpoint exceeds the configured latency threshold. Static fallback is
explicitly skipped. The shared Playwright session reports successful page loads
and responsive layout, the deliberate console errors and broken image, the
axe-detected unlabeled input, and the successful subscription form flow.

If the service is stopped, the same scan performs no endpoint or browser
requests. Live API analysis is skipped, the configured `openapi.json` receives
static contract alignment analysis, and UI browser analysis emits an ordinary
runtime-unavailable note without launching Chromium.

Use `SENTINEL_SAMPLE_HOST` or `SENTINEL_SAMPLE_PORT` only when the default
loopback binding is unavailable. Matching Sentinel API and UI URL overrides are
then also required.

## Development

Run the sample package checks from the repository root:

```sh
npm run sample:check
```

The sample owns its TypeScript, ESLint, Prettier, tests, dependencies, and lock
file so Sentinel can analyze it as a root npm project.

## Intentional Findings

The target intentionally contains a stale vulnerable dependency, an exposed
debug route, missing security headers, route-scoped wildcard CORS, an OpenAPI
response drift, a slow endpoint, a broken image, a browser console error, and an
unlabeled form input. Tests preserve these behaviors as fixture requirements.

Other behavior is intentionally sound: health and catalog responses match their
contracts, no secrets are embedded or exposed, non-public API routes omit
wildcard CORS, the main page is responsive, and the client-side subscription
flow succeeds.

Do not fix an intentional finding unless the fixture contract and expected
sample report are being deliberately changed.
