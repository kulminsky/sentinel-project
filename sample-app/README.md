# Sentinel Sample App

This standalone Express and TypeScript application is a deliberately flawed
target for Sentinel demonstrations. It runs entirely on loopback, keeps its data
in memory, and needs no database, credentials, or external services.

## Setup and Run

Use Node.js 20.19 or later and npm. The root install also installs this
standalone package from its lockfile; it does not download Chromium. Sentinel
never starts or stops the sample process.

### Linux or WSL (Bash)

From the Sentinel repository root, prepare and start the target in terminal 1:

```bash
npm install
npx playwright install --with-deps chromium
npm run sample:start
```

On Playwright-supported Linux distributions, installing system dependencies
may require administrator privileges. If those packages are already managed,
use `npx playwright install chromium` instead.

In terminal 2:

```bash
curl --fail http://127.0.0.1:4310/health
npm run sample:scan
```

### Native Windows (PowerShell)

From the Sentinel repository root, prepare and start the target in terminal 1:

```powershell
npm install
npx playwright install chromium
npm run sample:start
```

In terminal 2:

```powershell
Invoke-RestMethod http://127.0.0.1:4310/health
npm run sample:scan
```

The app listens on `http://127.0.0.1:4310` by default. Stop it with `Ctrl+C` in
terminal 1 after the scan. WSL follows the Linux instructions; native Windows
uses PowerShell.

### Optional one-command Docker demo

From the Sentinel repository root, Docker users can build the images, start this
sample on a private Compose network, wait for health, run Sentinel with the
scanner image's Chromium installation, print the report, and stop the sample:

```text
docker compose up --build --exit-code-from sentinel --attach sentinel --no-log-prefix
```

Compose builds separate `sentinel:local` and `sentinel-sample-app:local`
images. The sample's deliberately vulnerable dependency remains confined to
the sample image; the scanner image owns Chromium and contains no sample
package. This optional path requires Docker with Compose but not host Node.js,
sample-app dependencies, or a host Chromium installation. It does not publish
the sample port or create a host report. Remove stopped containers afterward
with `docker compose down --remove-orphans`. The npm workflow remains the
primary development path.

The scan writes the ignored local file `sample-app/sentinel-report.md`; the
reviewable generated artifact is
[`docs/sample-report.md`](../docs/sample-report.md). Sentinel does not start or
stop this process. With the service running, API analysis checks each configured
endpoint once: catalog and public-feed contract checks pass, profile fails
because the live body omits OpenAPI-required `plan`, and the slow endpoint
exceeds the configured latency threshold. Static fallback is explicitly
skipped. The shared Playwright session reports successful page loads and no
horizontal overflow at the configured viewports, the deliberate console errors
and broken image, the axe-detected unlabeled input, and the successful
subscription form flow.

The provided report enabled OpenAI selection without an available credential,
so it records the explicit no-key fallback and made no paid request.

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
wildcard CORS, the main page has no horizontal overflow at the configured
viewports, and the client-side subscription flow succeeds.

Do not fix an intentional finding unless the fixture contract and expected
sample report are being deliberately changed.
