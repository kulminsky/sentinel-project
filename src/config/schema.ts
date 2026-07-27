import { extname, isAbsolute, relative, resolve, sep } from "node:path";

import { z } from "zod";

const DEFAULT_TARGET_ROOT = ".";
const DEFAULT_REPORT_PATH = "sentinel-report.md";
export const REPORT_FORMATS = ["markdown", "json", "terminal"] as const;

const nonEmptyStringSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "Expected a non-empty string.");

function containsAsciiControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

const positiveIntegerSchema = z
  .number()
  .int("Expected an integer.")
  .positive("Expected a positive integer.");

const environmentVariableNameSchema = z
  .string()
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]*$/,
    "Expected a valid environment variable name.",
  );

const environmentReferenceSchema = z.strictObject({
  env: environmentVariableNameSchema,
});

const headerNameSchema = z
  .string()
  .regex(
    /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/,
    "Expected a valid HTTP header name.",
  );

const headersSchema = z
  .record(headerNameSchema, environmentReferenceSchema)
  .refine(
    (headers) => Object.keys(headers).length > 0,
    "Expected at least one header.",
  );

const headerAuthenticationSchema = z.strictObject({
  kind: z.literal("headers"),
  headers: headersSchema,
});

const originRelativePathSchema = nonEmptyStringSchema.superRefine(
  (value, context) => {
    if (!value.startsWith("/") || value.startsWith("//")) {
      context.addIssue({
        code: "custom",
        message: "Expected an origin-relative path beginning with one '/'.",
      });
      return;
    }

    if (value.includes("\\")) {
      context.addIssue({
        code: "custom",
        message: "Backslashes are not allowed in URL paths.",
      });
      return;
    }

    if (containsAsciiControlCharacter(value)) {
      context.addIssue({
        code: "custom",
        message: "Control characters are not allowed in URL paths.",
      });
      return;
    }

    if (value.includes("#")) {
      context.addIssue({
        code: "custom",
        message: "URL fragments are not allowed in relative paths.",
      });
    }
  },
);

const httpUrlSchema = nonEmptyStringSchema.superRefine((value, context) => {
  if (containsAsciiControlCharacter(value)) {
    context.addIssue({
      code: "custom",
      message: "Control characters are not allowed in URLs.",
    });
    return;
  }

  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    context.addIssue({
      code: "custom",
      message: "Expected a valid HTTP(S) URL.",
    });
    return;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    context.addIssue({
      code: "custom",
      message: "Expected an HTTP(S) URL.",
    });
  }

  if (parsed.username.length > 0 || parsed.password.length > 0) {
    context.addIssue({
      code: "custom",
      message: "Embedded URL credentials are not allowed.",
    });
  }

  if (parsed.hash.length > 0) {
    context.addIssue({
      code: "custom",
      message: "URL fragments are not allowed.",
    });
  }
});

function createFilesystemPathSchema(baseDirectory: string) {
  return nonEmptyStringSchema
    .refine((value) => !value.includes("\0"), "NUL bytes are not allowed.")
    .transform((value) => resolve(baseDirectory, value));
}

function isPathInside(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);

  return (
    relativePath.length === 0 ||
    (!isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`))
  );
}

function addDuplicateNameIssues(
  items: readonly { name: string }[],
  path: string,
  context: z.RefinementCtx,
): void {
  const indexesByName = new Map<string, number>();

  items.forEach((item, index) => {
    const previousIndex = indexesByName.get(item.name);
    if (previousIndex === undefined) {
      indexesByName.set(item.name, index);
      return;
    }

    context.addIssue({
      code: "custom",
      path: [path, index, "name"],
      message: `Expected a unique name; it duplicates item ${previousIndex}.`,
    });
  });
}

const endpointSchema = z.strictObject({
  name: nonEmptyStringSchema,
  method: z.enum(["GET", "HEAD", "OPTIONS"]),
  path: originRelativePathSchema,
  expectedStatus: z
    .number()
    .int("Expected an integer HTTP status.")
    .min(100, "Expected an HTTP status from 100 to 599.")
    .max(599, "Expected an HTTP status from 100 to 599."),
  expectedContentType: nonEmptyStringSchema.optional(),
  requiredJsonFields: z.array(nonEmptyStringSchema).optional(),
  useAuthentication: z.boolean(),
});

const pageSchema = z.strictObject({
  name: nonEmptyStringSchema,
  path: originRelativePathSchema,
  useAuthentication: z.boolean(),
});

const viewportSchema = z.strictObject({
  name: nonEmptyStringSchema,
  width: positiveIntegerSchema,
  height: positiveIntegerSchema,
});

const literalFormValueSchema = z.strictObject({
  source: z.literal("literal"),
  value: z.string(),
});

const environmentFormValueSchema = z.strictObject({
  source: z.literal("environment"),
  env: environmentVariableNameSchema,
});

const formStepSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("goto"),
    path: originRelativePathSchema,
  }),
  z.strictObject({
    type: z.literal("fill"),
    selector: nonEmptyStringSchema,
    value: z.discriminatedUnion("source", [
      literalFormValueSchema,
      environmentFormValueSchema,
    ]),
  }),
  z.strictObject({
    type: z.literal("check"),
    selector: nonEmptyStringSchema,
  }),
  z.strictObject({
    type: z.literal("uncheck"),
    selector: nonEmptyStringSchema,
  }),
  z.strictObject({
    type: z.literal("click"),
    selector: nonEmptyStringSchema,
  }),
  z.strictObject({
    type: z.literal("assertVisibleText"),
    text: nonEmptyStringSchema,
  }),
  z.strictObject({
    type: z.literal("assertUrl"),
    path: originRelativePathSchema,
  }),
]);

const formFlowSchema = z.strictObject({
  name: nonEmptyStringSchema,
  startPath: originRelativePathSchema,
  useAuthentication: z.boolean(),
  steps: z.array(formStepSchema),
});

const disabledAiSchema = z.strictObject({
  enabled: z.literal(false).default(false),
  provider: z.enum(["openai", "claude"]).optional(),
});

const enabledAiSchema = z.strictObject({
  enabled: z.literal(true),
  provider: z.enum(["openai", "claude"]),
});

export function createSentinelConfigSchema(
  baseDirectory: string,
  invocationDirectory = baseDirectory,
) {
  const filesystemPathSchema = createFilesystemPathSchema(baseDirectory);
  const openApiPathSchema = filesystemPathSchema.refine(
    (path) => [".json", ".yaml", ".yml"].includes(extname(path).toLowerCase()),
    "Expected a .json, .yaml, or .yml OpenAPI file.",
  );
  const defaultTargetRoot = resolve(invocationDirectory, DEFAULT_TARGET_ROOT);
  const defaultReportPath = resolve(invocationDirectory, DEFAULT_REPORT_PATH);
  const reportSchema = z
    .strictObject({
      format: z.enum(REPORT_FORMATS).default("markdown"),
      path: filesystemPathSchema.optional(),
    })
    .superRefine((report, context) => {
      if (report.format === "json" && report.path === undefined) {
        context.addIssue({
          code: "custom",
          path: ["path"],
          message: "JSON reports require an explicit output path.",
        });
      }

      if (report.format === "terminal" && report.path !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["path"],
          message: "Terminal reports write to stdout and cannot use a path.",
        });
      }
    })
    .transform((report) => {
      if (report.format === "terminal") {
        return {
          format: "terminal",
        } as const;
      }

      if (report.format === "json") {
        if (report.path === undefined) {
          return z.NEVER;
        }

        return {
          format: "json",
          path: report.path,
        } as const;
      }

      return {
        format: "markdown",
        path: report.path ?? defaultReportPath,
      } as const;
    });

  const apiSchema = z
    .strictObject({
      baseUrl: httpUrlSchema,
      healthPath: originRelativePathSchema,
      openApiPath: openApiPathSchema,
      timeoutMs: positiveIntegerSchema,
      latencyThresholdMs: positiveIntegerSchema,
      authentication: headerAuthenticationSchema.optional(),
      endpoints: z.array(endpointSchema),
    })
    .superRefine((api, context) => {
      addDuplicateNameIssues(api.endpoints, "endpoints", context);

      if (api.latencyThresholdMs > api.timeoutMs) {
        context.addIssue({
          code: "custom",
          path: ["latencyThresholdMs"],
          message: "Latency threshold cannot exceed the API timeout.",
        });
      }

      api.endpoints.forEach((endpoint, index) => {
        if (endpoint.useAuthentication && api.authentication === undefined) {
          context.addIssue({
            code: "custom",
            path: ["endpoints", index, "useAuthentication"],
            message:
              "Authenticated endpoints require API authentication configuration.",
          });
        }
      });
    });

  const storageStateAuthenticationSchema = z.strictObject({
    kind: z.literal("storageState"),
    path: filesystemPathSchema,
  });

  const uiSchema = z
    .strictObject({
      baseUrl: httpUrlSchema,
      timeoutMs: positiveIntegerSchema,
      pages: z.array(pageSchema),
      viewports: z.tuple([viewportSchema, viewportSchema]),
      authentication: z
        .discriminatedUnion("kind", [
          headerAuthenticationSchema,
          storageStateAuthenticationSchema,
        ])
        .optional(),
      formFlows: z.array(formFlowSchema).optional(),
    })
    .superRefine((ui, context) => {
      addDuplicateNameIssues(ui.pages, "pages", context);
      addDuplicateNameIssues(ui.viewports, "viewports", context);
      addDuplicateNameIssues(ui.formFlows ?? [], "formFlows", context);

      ui.pages.forEach((page, index) => {
        if (page.useAuthentication && ui.authentication === undefined) {
          context.addIssue({
            code: "custom",
            path: ["pages", index, "useAuthentication"],
            message:
              "Authenticated pages require UI authentication configuration.",
          });
        }
      });

      ui.formFlows?.forEach((flow, index) => {
        if (flow.useAuthentication && ui.authentication === undefined) {
          context.addIssue({
            code: "custom",
            path: ["formFlows", index, "useAuthentication"],
            message:
              "Authenticated form flows require UI authentication configuration.",
          });
        }
      });
    });

  return z
    .strictObject({
      target: z
        .strictObject({
          root: filesystemPathSchema.default(defaultTargetRoot),
        })
        .default({
          root: defaultTargetRoot,
        }),
      report: reportSchema.default({
        format: "markdown",
        path: defaultReportPath,
      }),
      api: apiSchema.optional(),
      ui: uiSchema.optional(),
      ai: z
        .discriminatedUnion("enabled", [disabledAiSchema, enabledAiSchema])
        .default({
          enabled: false,
        }),
    })
    .superRefine((config, context) => {
      if (
        config.api !== undefined &&
        !isPathInside(config.target.root, config.api.openApiPath)
      ) {
        context.addIssue({
          code: "custom",
          path: ["api", "openApiPath"],
          message: "OpenAPI path must remain inside the target root.",
        });
      }
    });
}

export type SentinelConfig = z.output<
  ReturnType<typeof createSentinelConfigSchema>
>;
