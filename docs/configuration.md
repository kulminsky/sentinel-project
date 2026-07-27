# Sentinel Configuration

Sentinel accepts an optional `sentinel.config.json` and `.env` in the invocation directory. Use `sentinel --config <path>` to select another JSON file; explicitly configured relative filesystem paths and the adjacent `.env` then resolve from that file's directory.

Configuration precedence is:

1. Existing process environment.
2. `.env`.
3. `sentinel.config.json`.
4. The clean-run target and Markdown report defaults.

The clean run defaults to the invocation directory as `target.root`, `markdown` as `report.format`, and `sentinel-report.md` in the invocation directory as `report.path`. Missing API and UI sections are valid. Any supplied invalid, incomplete, conflicting, or unknown value is a fatal configuration error with a property path.

## JSON Shape

All objects are strict: unknown keys are rejected, including inside endpoints, authentication, and form steps.

```json
{
  "target": {
    "root": "./demo-project"
  },
  "report": {
    "format": "markdown",
    "path": "./sentinel-report.md"
  },
  "api": {
    "baseUrl": "https://api.example.test:8443",
    "healthPath": "/health",
    "openApiPath": "./demo-project/openapi.yaml",
    "timeoutMs": 3000,
    "latencyThresholdMs": 750,
    "authentication": {
      "kind": "headers",
      "headers": {
        "Authorization": {
          "env": "TARGET_API_AUTHORIZATION"
        }
      }
    },
    "endpoints": [
      {
        "name": "account",
        "method": "GET",
        "path": "/api/account",
        "expectedStatus": 200,
        "expectedContentType": "application/json",
        "requiredJsonFields": ["id"],
        "useAuthentication": true
      }
    ]
  },
  "ui": {
    "baseUrl": "https://app.example.test",
    "timeoutMs": 5000,
    "pages": [
      {
        "name": "home",
        "path": "/",
        "useAuthentication": false
      }
    ],
    "viewports": [
      {
        "name": "mobile",
        "width": 390,
        "height": 844
      },
      {
        "name": "desktop",
        "width": 1440,
        "height": 900
      }
    ],
    "authentication": {
      "kind": "storageState",
      "path": "./auth/storage-state.json"
    },
    "formFlows": [
      {
        "name": "contact",
        "startPath": "/contact",
        "useAuthentication": false,
        "steps": [
          {
            "type": "fill",
            "selector": "[name=email]",
            "value": {
              "source": "environment",
              "env": "TARGET_TEST_EMAIL"
            }
          },
          {
            "type": "click",
            "selector": "button[type=submit]"
          },
          {
            "type": "assertUrl",
            "path": "/contact/sent"
          }
        ]
      }
    ]
  },
  "ai": {
    "enabled": false
  }
}
```

## Validation Rules

- Filesystem paths must be nonempty and cannot contain NUL bytes. Explicit relative target, report, OpenAPI, and storage-state paths resolve from the selected configuration directory; omitted clean-run target and Markdown report values remain anchored to the invocation directory.
- A supplied API section requires `openApiPath`. It must end in `.json`, `.yaml`, or `.yml`, remain inside `target.root`, and resolve to an inventoried regular file before analysis can read it.
- Report format is `markdown`, `json`, or `terminal`. Markdown may omit its path and use the clean-run default, JSON requires an explicit path, and terminal forbids a path because it writes only to stdout.
- API and UI base URLs must use HTTP or HTTPS. Explicit ports are allowed; embedded credentials and fragments are not.
- API health paths, endpoint paths, UI page paths, form start paths, `goto` paths, and `assertUrl` paths must be same-origin paths beginning with exactly one `/`. Absolute URLs, backslashes, control characters, and fragments are rejected.
- Timeouts, latency thresholds, and viewport dimensions must be positive integers. The API latency threshold cannot exceed its timeout.
- Endpoint status expectations must be integers from 100 through 599. Runtime methods are limited to `GET`, `HEAD`, and `OPTIONS`.
- Names must be unique within each endpoint, page, viewport, and form-flow collection.
- UI configuration requires exactly two distinctly named viewports.
- UI analysis accepts at most 10 pages and five form flows. Every form flow requires one through 20 steps.
- An endpoint, page, or form flow with `useAuthentication: true` requires the corresponding API or UI authentication block.

API/UI base targets and timeouts drive one central, read-only reachability probe per configured service. Cached API reachability selects either live endpoint assertions or static OpenAPI fallback for the full scan. Live API checks may resolve configured header-authentication references for protected endpoints; missing values skip only those endpoints. Unauthenticated API endpoints and UI pages are also eligible for bounded Security header/CORS checks, while configured debug-like paths can contribute static debug-route evidence. Sentinel never resolves target authentication for Security requests.

When the cached UI probe is reachable, one Playwright Chromium session consumes
the configured pages, two viewports, optional authentication, and optional form
flows. Header authentication is applied only to same-origin browser requests;
storage-state files are handled by Playwright. Missing authentication or
environment-backed form values skip only the affected protected target or flow.
Each Playwright operation is bounded by `ui.timeoutMs` and the remaining
browser-analysis budget.
Chromium binaries remain an explicit `npx playwright install chromium` step and
are not downloaded during `npm install`.

## Report Formats

| Format     | Configuration                                     | Destination                                                      |
| ---------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| `markdown` | `{ "format": "markdown", "path": "./report.md" }` | Writes the configured path; omit it to use `sentinel-report.md`. |
| `json`     | `{ "format": "json", "path": "./report.json" }`   | Writes the required configured path.                             |
| `terminal` | `{ "format": "terminal" }`                        | Writes the complete plain-text report to stdout.                 |

Sentinel renders exactly one format per scan. A terminal report cannot include `path`, and JSON never derives or substitutes one.

## Authentication Shapes

| Location | Supported shape                                                           | Notes                                                     |
| -------- | ------------------------------------------------------------------------- | --------------------------------------------------------- |
| API      | `{ "kind": "headers", "headers": { "<name>": { "env": "<variable>" } } }` | At least one valid HTTP header name is required.          |
| UI       | `{ "kind": "headers", "headers": { "<name>": { "env": "<variable>" } } }` | Uses the same environment-reference shape as API headers. |
| UI       | `{ "kind": "storageState", "path": "<filesystem-path>" }`                 | The path follows the filesystem normalization rules.      |

Authentication blocks store environment-variable names only. They never contain raw credential values.

## Form Steps

| `type`              | Required fields                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `goto`              | `path`                                                                                                         |
| `fill`              | `selector` and either `{ "source": "literal", "value": "..." }` or `{ "source": "environment", "env": "..." }` |
| `check`             | `selector`                                                                                                     |
| `uncheck`           | `selector`                                                                                                     |
| `click`             | `selector`                                                                                                     |
| `assertVisibleText` | `text`                                                                                                         |
| `assertUrl`         | `path`                                                                                                         |

## Environment Mapping

Scalar variables:

| Variable                            | Configuration path       |
| ----------------------------------- | ------------------------ |
| `SENTINEL_TARGET_ROOT`              | `target.root`            |
| `SENTINEL_REPORT_FORMAT`            | `report.format`          |
| `SENTINEL_REPORT_PATH`              | `report.path`            |
| `SENTINEL_API_BASE_URL`             | `api.baseUrl`            |
| `SENTINEL_API_HEALTH_PATH`          | `api.healthPath`         |
| `SENTINEL_API_OPENAPI_PATH`         | `api.openApiPath`        |
| `SENTINEL_API_TIMEOUT_MS`           | `api.timeoutMs`          |
| `SENTINEL_API_LATENCY_THRESHOLD_MS` | `api.latencyThresholdMs` |
| `SENTINEL_UI_BASE_URL`              | `ui.baseUrl`             |
| `SENTINEL_UI_TIMEOUT_MS`            | `ui.timeoutMs`           |
| `SENTINEL_AI_ENABLED`               | `ai.enabled`             |
| `SENTINEL_AI_PROVIDER`              | `ai.provider`            |

Structured variables contain JSON:

| Variable                      | Configuration path   |
| ----------------------------- | -------------------- |
| `SENTINEL_API_ENDPOINTS`      | `api.endpoints`      |
| `SENTINEL_API_AUTHENTICATION` | `api.authentication` |
| `SENTINEL_UI_PAGES`           | `ui.pages`           |
| `SENTINEL_UI_VIEWPORTS`       | `ui.viewports`       |
| `SENTINEL_UI_AUTHENTICATION`  | `ui.authentication`  |
| `SENTINEL_UI_FORM_FLOWS`      | `ui.formFlows`       |

Booleans must be exactly `true` or `false`. Unknown `SENTINEL_*` variables are errors unless they are explicitly referenced by an authentication or form value. Unrelated project and system variables are ignored.

Report format and path follow the same precedence as other values. A higher-precedence format does not silently discard a lower-precedence conflicting path; for example, terminal format combined with any supplied report path is a fatal `report.path` error.

## Credentials

Configuration stores environment-variable references, never target credential values. Live API checks resolve referenced header values only for endpoints that request authentication and never render them; missing values skip only the affected endpoint. AI continues to read only `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` for the selected provider. Missing optional provider credentials skip only the AI check.

Never commit real credentials to JSON, `.env`, tests, or documentation.
