# Sentinel Docker Guide

[Back to the README](../README.md) ·
[Configuration reference](configuration.md)

Docker is an optional reviewer convenience. The npm workflow remains the
authoritative development path, and Sentinel itself never starts or stops a
target service.

## Prerequisites

- Docker Desktop, or Docker Engine with the Compose plugin.
- Linux-container mode on Docker Desktop.
- Network access during the first build for base images, locked npm packages,
  Chromium, and its Linux dependencies.

Verify the installation:

```text
docker version
docker compose version
```

## Images

One multi-stage `Dockerfile` produces two isolated local images:

- `sentinel:local` contains Sentinel, its locked root dependencies, and
  Chromium. It contains no sample package or deliberately vulnerable `lodash`.
- `sentinel-sample-app:local` contains only the compiled sample, its static
  assets, and production dependencies. It contains no Sentinel or browser
  installation.

The sample image runs as the non-root `node` user. The Sentinel image currently
runs as root because its Playwright runtime has not been hardened for hostile
targets. Use it only with trusted repositories and sites. A read-only source
mount prevents normal target writes; it is not a security sandbox.

## One-Command Demo

Run from the Sentinel repository root in Bash or Windows Command Prompt:

```text
docker compose up --build --exit-code-from sentinel --attach sentinel --no-log-prefix
```

Compose builds both images, starts the sample on a private network, waits for
its health check, runs Sentinel, prints the Markdown report, propagates
Sentinel's fatal-error exit code, and stops the sample. It does not publish the
sample port or create a host report.

Remove the stopped containers and private network afterward:

```text
docker compose down --remove-orphans
```

## Scan Another Repository

Build the scanner once from the Sentinel repository:

```text
docker build --target sentinel --tag sentinel:local .
```

Then change to the target repository. This basic form performs a
zero-configuration scan, mounts the target read-only, and writes the report to
stdout.

macOS, Linux, or WSL Bash:

```bash
docker run --rm --init --ipc=host \
  --mount "type=bind,src=${PWD},dst=/workspace,readonly" \
  -e SENTINEL_TARGET_ROOT=/workspace \
  -e SENTINEL_REPORT_FORMAT=terminal \
  sentinel:local
```

Windows Command Prompt:

```bat
docker run --rm --init --ipc=host ^
  --mount "type=bind,src=%CD%,dst=/workspace,readonly" ^
  -e SENTINEL_TARGET_ROOT=/workspace ^
  -e SENTINEL_REPORT_FORMAT=terminal ^
  sentinel:local
```

The container starts in `/scan`, so it does not automatically load a
conventional configuration from the mounted target.

For a configured scan with a persisted Markdown report, create a dedicated
output directory. The source remains read-only; only that output directory is
writable.

macOS, Linux, or WSL Bash:

```bash
mkdir -p sentinel-output
docker run --rm --init --ipc=host \
  --mount "type=bind,src=${PWD},dst=/workspace,readonly" \
  --mount "type=bind,src=${PWD}/sentinel-output,dst=/output" \
  -e SENTINEL_TARGET_ROOT=/workspace \
  -e SENTINEL_REPORT_FORMAT=markdown \
  -e SENTINEL_REPORT_PATH=/output/sentinel-report.md \
  sentinel:local --config /workspace/sentinel.config.json
```

Windows Command Prompt:

```bat
if not exist sentinel-output mkdir sentinel-output
docker run --rm --init --ipc=host ^
  --mount "type=bind,src=%CD%,dst=/workspace,readonly" ^
  --mount "type=bind,src=%CD%/sentinel-output,dst=/output" ^
  -e SENTINEL_TARGET_ROOT=/workspace ^
  -e SENTINEL_REPORT_FORMAT=markdown ^
  -e SENTINEL_REPORT_PATH=/output/sentinel-report.md ^
  sentinel:local --config /workspace/sentinel.config.json
```

Environment overrides intentionally replace the target and report values from
the selected configuration. API and UI service URLs must also be reachable
from the container. Configuration precedence otherwise remains unchanged.

Docker Desktop exposes host services through `host.docker.internal`. Native
Linux additionally requires:

```text
--add-host host.docker.internal:host-gateway
```

A service bound only to host loopback may still be unreachable from native
Linux containers. Prefer Compose service networking for the bundled sample.

## Optional AI

Compose passes provider variables only when they are explicitly present in the
host environment. Never put credentials in the Dockerfile, build arguments,
`compose.yaml`, committed `.env` files, or literal command-line values.

OpenAI on macOS, Linux, or WSL Bash:

```bash
read -rsp "OpenAI API key: " OPENAI_API_KEY
printf '\n'
export OPENAI_API_KEY
export SENTINEL_AI_ENABLED=true
export SENTINEL_AI_PROVIDER=openai
docker compose up --build --exit-code-from sentinel --attach sentinel --no-log-prefix
unset OPENAI_API_KEY SENTINEL_AI_ENABLED SENTINEL_AI_PROVIDER
```

Windows Command Prompt cannot mask interactive input. Prefer loading
`OPENAI_API_KEY` from an approved secret manager. The fallback below keeps the
value out of command history, but displays it while typed:

```bat
set "OPENAI_API_KEY="
set /p "OPENAI_API_KEY=OpenAI API key (input is visible): "
set "SENTINEL_AI_ENABLED=true"
set "SENTINEL_AI_PROVIDER=openai"
docker compose up --build --exit-code-from sentinel --attach sentinel --no-log-prefix
set "OPENAI_API_KEY="
set "SENTINEL_AI_ENABLED="
set "SENTINEL_AI_PROVIDER="
```

For Claude, substitute `ANTHROPIC_API_KEY` and provider `claude`. If execution
is interrupted before the CMD cleanup lines, clear the variables manually or
close that Command Prompt.

Runtime environment pass-through prevents credentials from entering image
layers or repository files, but Docker administrators can inspect container
environments. Sentinel's normal one-request, redaction, cost, and privacy
limits still apply.

## Boundaries

- Docker remains local and optional; images are not published.
- Compose orchestrates only the trusted bundled sample.
- Sentinel does not gain service discovery or lifecycle management.
- Direct target mounts are read-only by default.
- Docker CI, multi-architecture publishing, hot reload, and hardened hostile
  browser isolation are not implemented.
