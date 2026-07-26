# Sentinel Configuration

Sentinel accepts an optional `sentinel.config.json` and `.env` in the invocation directory. Use `sentinel --config <path>` to select another JSON file; explicitly configured relative filesystem paths and the adjacent `.env` then resolve from that file's directory.

Configuration precedence is:

1. Existing process environment.
2. `.env`.
3. `sentinel.config.json`.
4. The clean-run target and report defaults.

The only defaults are the invocation directory as `target.root` and `sentinel-report.md` in that directory as `report.path`. These defaults remain anchored to the invocation directory when `--config` selects a file elsewhere. Missing API and UI sections are valid. Any supplied invalid, incomplete, or unknown value is a fatal configuration error with a property path.

## JSON Shape

All objects are strict: unknown keys are rejected, including inside endpoints, authentication, and form steps.

```json
{
  "target": {
    "root": "./demo-project"
  },
  "report": {
    "path": "./sentinel-report.md"
  },
  "api": {
    "baseUrl": "https://api.example.test:8443",
    "healthPath": "/health",
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

- Filesystem paths must be nonempty and cannot contain NUL bytes. Explicit relative target, report, and storage-state paths resolve from the selected configuration directory; omitted target and report values remain anchored to the invocation directory.
- API and UI base URLs must use HTTP or HTTPS. Explicit ports are allowed; embedded credentials and fragments are not.
- API health paths, endpoint paths, UI page paths, form start paths, `goto` paths, and `assertUrl` paths must be same-origin paths beginning with exactly one `/`. Absolute URLs, backslashes, control characters, and fragments are rejected.
- Timeouts, latency thresholds, and viewport dimensions must be positive integers. The API latency threshold cannot exceed its timeout.
- Endpoint status expectations must be integers from 100 through 599. Runtime methods are limited to `GET`, `HEAD`, and `OPTIONS`.
- Names must be unique within each endpoint, page, viewport, and form-flow collection.
- UI configuration requires exactly two distinctly named viewports.
- An endpoint, page, or form flow with `useAuthentication: true` requires the corresponding API or UI authentication block.

API/UI base targets and timeouts currently drive one central, read-only reachability probe per configured service. Endpoint expectations, authentication, pages, viewports, and form flows are validated but remain dormant until their runtime and Playwright milestones.

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
| `SENTINEL_REPORT_PATH`              | `report.path`            |
| `SENTINEL_API_BASE_URL`             | `api.baseUrl`            |
| `SENTINEL_API_HEALTH_PATH`          | `api.healthPath`         |
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

## Credentials

Configuration stores environment-variable references, never target credential values. AI continues to read only `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` for the selected provider. Missing optional credentials skip only the affected check.

Never commit real credentials to JSON, `.env`, tests, or documentation.
