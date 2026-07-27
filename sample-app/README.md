# Sentinel Sample App

This standalone Express and TypeScript application is a deliberately flawed
target for Sentinel demonstrations. It keeps its data in memory and needs no
database, credentials, or external services. The native process listens on
loopback by default; the Compose demo runs it only on a private container
network.

## Setup and Run

Use the root README's
[native sample instructions](../README.md#sample-application) for npm setup,
Chromium installation, the two-terminal lifecycle, and platform-specific
commands. Use the separate
[Docker workflow](../docs/docker.md#one-command-demo) for the optional
one-command Compose demo. Sentinel itself never starts or stops a target.

### Native npm behavior

The native app listens on `http://127.0.0.1:4310` by default. The native scan
writes the ignored local file `sample-app/sentinel-report.md`. The tracked
[`docs/sample-report.md`](../docs/sample-report.md) is a reviewable example; it
is not automatically replaced by `npm run sample:scan`.

With the service running, API analysis checks each configured endpoint once:
catalog and public-feed contract checks pass, profile fails because the live
body omits OpenAPI-required `plan`, and the slow endpoint exceeds the configured
latency threshold. Static fallback is explicitly skipped. The shared
Playwright session reports successful page loads and no horizontal overflow at
the configured viewports, the deliberate console errors and broken image, the
axe-detected unlabeled input, and the successful subscription form flow.

The provided report enabled OpenAI selection without an available credential,
so it records the explicit no-key fallback and made no paid request.

If the service is stopped, the central API and UI `HEAD` reachability probes
fail safely. Sentinel then makes no configured endpoint-analysis requests and
does not launch Chromium. Live API analysis is skipped, the configured
`openapi.json` receives static contract alignment analysis, and UI browser
analysis emits an ordinary runtime-unavailable note.

Use `SENTINEL_SAMPLE_HOST` or `SENTINEL_SAMPLE_PORT` only when the default
loopback binding is unavailable. A port change, or a host change that alters
the address Sentinel must use, also requires matching Sentinel API and UI URL
overrides. Binding the native app to `0.0.0.0` alone remains reachable through
`127.0.0.1`.

### Compose behavior

Compose sets the sample host to `0.0.0.0` inside its isolated network so the
Sentinel container can reach it by service name. It does not publish port 4310
to the host. The scanner writes a temporary report inside its container and
prints that report to stdout; it does not create or replace the native ignored
report or the tracked sample report.

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
wildcard CORS, the main page has no horizontal overflow at the configured
viewports, and the client-side subscription flow succeeds.

Do not fix an intentional finding unless the fixture contract and expected
sample report are being deliberately changed.
