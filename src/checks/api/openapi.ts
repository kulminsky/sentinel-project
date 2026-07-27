import { extname, relative, sep } from "node:path";

import { parseDocument } from "yaml";

import type { RepositoryInspection } from "../../repository/inspection.js";
import { readRepositoryText } from "../../repository/inspection.js";

const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"] as const;
const SCHEMA_COMPOSITION_KEYS = [
  "allOf",
  "anyOf",
  "else",
  "if",
  "not",
  "oneOf",
  "then",
] as const;
const NESTED_SCHEMA_KEYS = [
  "$defs",
  "additionalProperties",
  "contains",
  "definitions",
  "dependentSchemas",
  "items",
  "patternProperties",
  "prefixItems",
  "properties",
  "propertyNames",
  "unevaluatedItems",
  "unevaluatedProperties",
] as const;

export type SafeApiMethod = (typeof SAFE_METHODS)[number];
export type OpenApiPrimitiveType =
  "array" | "boolean" | "integer" | "null" | "number" | "object" | "string";
type OpenApiSchemaDialect = "3.0" | "3.1";

export type OpenApiShape =
  | {
      readonly state: "absent";
    }
  | {
      readonly state: "unsupported";
    }
  | {
      readonly state: "supported";
      readonly type?: OpenApiPrimitiveType;
      readonly required: ReadonlySet<string>;
      readonly propertyTypes: ReadonlyMap<
        string,
        OpenApiPrimitiveType | "unsupported"
      >;
    };

export interface OpenApiResponseContract {
  readonly statusKey: string;
  readonly mediaTypes: ReadonlyMap<string, OpenApiShape>;
  readonly unsupported: boolean;
}

export interface OpenApiOperation {
  readonly method: SafeApiMethod;
  readonly pathTemplate: string;
  readonly responses: readonly OpenApiResponseContract[];
}

export interface OpenApiContract {
  readonly relativePath: string;
  readonly version: string;
  readonly operations: readonly OpenApiOperation[];
}

export type OpenApiLoadResult =
  | {
      readonly state: "available";
      readonly contract: OpenApiContract;
    }
  | {
      readonly state:
        | "invalid"
        | "inventory-incomplete"
        | "missing"
        | "too-large"
        | "unreadable"
        | "unsupported-version";
      readonly relativePath: string;
    };

export type OperationMatch =
  | {
      readonly state: "found";
      readonly operation: OpenApiOperation;
    }
  | {
      readonly state: "missing" | "ambiguous";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function repositoryPath(
  inspection: RepositoryInspection,
  absolutePath: string,
): string {
  return relative(inspection.root, absolutePath).split(sep).join("/");
}

function parseOpenApiSource(content: string, extension: string): unknown {
  try {
    if (extension === ".json") {
      return JSON.parse(content);
    }

    const document = parseDocument(content, {
      uniqueKeys: true,
    });

    if (document.errors.length > 0) {
      return undefined;
    }

    return document.toJS({
      maxAliasCount: 20,
    });
  } catch {
    return undefined;
  }
}

function isSupportedShallowType(
  value: unknown,
  dialect: OpenApiSchemaDialect,
): value is OpenApiPrimitiveType {
  const primitiveType =
    typeof value === "string" &&
    [
      "array",
      "boolean",
      "integer",
      "null",
      "number",
      "object",
      "string",
    ].includes(value);

  return (
    primitiveType &&
    (dialect === "3.1" || (value !== "null" && value !== "array"))
  );
}

function hasUnsupportedComposition(schema: Record<string, unknown>): boolean {
  return (
    Object.prototype.hasOwnProperty.call(schema, "$ref") ||
    SCHEMA_COMPOSITION_KEYS.some((key) => schema[key] !== undefined) ||
    Array.isArray(schema["type"])
  );
}

function hasUnsupportedNestedSchema(schema: Record<string, unknown>): boolean {
  return NESTED_SCHEMA_KEYS.some((key) => schema[key] !== undefined);
}

function hasUnsupportedTopLevelSchema(
  schema: Record<string, unknown>,
): boolean {
  return NESTED_SCHEMA_KEYS.some(
    (key) => key !== "properties" && schema[key] !== undefined,
  );
}

function hasUnsupportedNullable(schema: Record<string, unknown>): boolean {
  return schema["nullable"] !== undefined && schema["nullable"] !== false;
}

function isSupportedResponseKey(value: string): boolean {
  return (
    value === "default" || /^[1-5]\d{2}$/.test(value) || /^[1-5]XX$/.test(value)
  );
}

function isSupportedMediaTypeKey(value: string): boolean {
  const token = /^[!#$%&'+.^_`|~0-9A-Za-z-]+$/;
  const parts = value.split("/");

  if (parts.length !== 2) {
    return false;
  }

  const [type, subtype] = parts;
  if (type === undefined || subtype === undefined) {
    return false;
  }

  if (type === "*") {
    return subtype === "*";
  }

  return token.test(type) && (subtype === "*" || token.test(subtype));
}

function normalizeShape(
  value: unknown,
  dialect: OpenApiSchemaDialect,
): OpenApiShape {
  if (value === undefined) {
    return {
      state: "absent",
    };
  }

  if (
    !isRecord(value) ||
    hasUnsupportedComposition(value) ||
    hasUnsupportedTopLevelSchema(value) ||
    hasUnsupportedNullable(value)
  ) {
    return {
      state: "unsupported",
    };
  }

  const rawType = value["type"];
  const properties = value["properties"];
  const inferredType =
    rawType === undefined && isRecord(properties) ? "object" : rawType;

  if (
    inferredType !== undefined &&
    !isSupportedShallowType(inferredType, dialect)
  ) {
    return {
      state: "unsupported",
    };
  }

  const requiredValue = value["required"];
  if (
    requiredValue !== undefined &&
    (!Array.isArray(requiredValue) ||
      requiredValue.some((entry) => typeof entry !== "string"))
  ) {
    return {
      state: "unsupported",
    };
  }

  if (properties !== undefined && !isRecord(properties)) {
    return {
      state: "unsupported",
    };
  }

  const propertyTypes = new Map<string, OpenApiPrimitiveType | "unsupported">();

  for (const [name, property] of Object.entries(properties ?? {})) {
    if (
      !isRecord(property) ||
      hasUnsupportedComposition(property) ||
      hasUnsupportedNestedSchema(property) ||
      hasUnsupportedNullable(property)
    ) {
      propertyTypes.set(name, "unsupported");
      continue;
    }

    const propertyType = property["type"];
    propertyTypes.set(
      name,
      isSupportedShallowType(propertyType, dialect)
        ? propertyType
        : "unsupported",
    );
  }

  return {
    state: "supported",
    ...(inferredType === undefined ? {} : { type: inferredType }),
    required: new Set((requiredValue ?? []) as string[]),
    propertyTypes,
  };
}

function normalizeResponses(
  value: unknown,
  dialect: OpenApiSchemaDialect,
): OpenApiResponseContract[] {
  if (!isRecord(value)) {
    return [];
  }

  const responses: OpenApiResponseContract[] = [];

  for (const [statusKey, responseValue] of Object.entries(value)) {
    if (!isRecord(responseValue)) {
      responses.push({
        statusKey,
        mediaTypes: new Map(),
        unsupported: true,
      });
      continue;
    }

    const content = responseValue["content"];
    const description = responseValue["description"];
    const mediaTypes = new Map<string, OpenApiShape>();
    let unsupported =
      !isSupportedResponseKey(statusKey) ||
      responseValue["$ref"] !== undefined ||
      typeof description !== "string" ||
      description.trim().length === 0 ||
      (content !== undefined && !isRecord(content));

    if (isRecord(content)) {
      for (const [mediaType, mediaValue] of Object.entries(content)) {
        if (!isSupportedMediaTypeKey(mediaType) || !isRecord(mediaValue)) {
          unsupported = true;
          mediaTypes.set(mediaType.toLowerCase(), {
            state: "unsupported",
          });
          continue;
        }

        if (mediaValue["$ref"] !== undefined) {
          unsupported = true;
        }

        mediaTypes.set(
          mediaType.toLowerCase(),
          mediaValue["$ref"] === undefined
            ? normalizeShape(mediaValue["schema"], dialect)
            : {
                state: "unsupported",
              },
        );
      }
    }

    responses.push({
      statusKey,
      mediaTypes,
      unsupported,
    });
  }

  return responses;
}

function normalizeOperations(
  paths: unknown,
  dialect: OpenApiSchemaDialect,
): OpenApiOperation[] | undefined {
  if (!isRecord(paths)) {
    return undefined;
  }

  const operations: OpenApiOperation[] = [];

  for (const [pathTemplate, pathValue] of Object.entries(paths)) {
    if (!pathTemplate.startsWith("/") || !isRecord(pathValue)) {
      continue;
    }

    for (const method of SAFE_METHODS) {
      const operationValue = pathValue[method.toLowerCase()];
      if (operationValue === undefined) {
        continue;
      }

      if (!isRecord(operationValue)) {
        operations.push({
          method,
          pathTemplate,
          responses: [],
        });
        continue;
      }

      operations.push({
        method,
        pathTemplate,
        responses: normalizeResponses(operationValue["responses"], dialect),
      });
    }
  }

  return operations;
}

export async function loadOpenApiContract(
  inspection: RepositoryInspection,
  absolutePath: string,
): Promise<OpenApiLoadResult> {
  const relativePath = repositoryPath(inspection, absolutePath);
  const source = await readRepositoryText(inspection, relativePath);

  if (source.state === "missing" && !inspection.complete) {
    return {
      state: "inventory-incomplete",
      relativePath,
    };
  }

  if (source.state !== "ok") {
    return {
      state: source.state,
      relativePath,
    };
  }

  const parsed = parseOpenApiSource(
    source.content,
    extname(relativePath).toLowerCase(),
  );

  if (!isRecord(parsed)) {
    return {
      state: "invalid",
      relativePath,
    };
  }

  const version = parsed["openapi"];
  if (typeof version !== "string" || !/^3\.(?:0|1)(?:\.\d+)?$/.test(version)) {
    return {
      state: "unsupported-version",
      relativePath,
    };
  }

  const info = parsed["info"];
  if (
    !isRecord(info) ||
    typeof info["title"] !== "string" ||
    info["title"].trim().length === 0 ||
    typeof info["version"] !== "string" ||
    info["version"].trim().length === 0
  ) {
    return {
      state: "invalid",
      relativePath,
    };
  }

  const dialect: OpenApiSchemaDialect = version.startsWith("3.0")
    ? "3.0"
    : "3.1";
  const operations = normalizeOperations(parsed["paths"], dialect);
  if (operations === undefined) {
    return {
      state: "invalid",
      relativePath,
    };
  }

  return {
    state: "available",
    contract: {
      relativePath,
      version,
      operations,
    },
  };
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function templateMatches(pathTemplate: string, pathname: string): boolean {
  const expression = pathTemplate
    .split("/")
    .map((segment) =>
      /^\{[^{}]+\}$/.test(segment) ? "[^/]+" : escapeRegularExpression(segment),
    )
    .join("/");

  return new RegExp(`^${expression}$`).test(pathname);
}

export function matchOpenApiOperation(
  contract: OpenApiContract,
  method: SafeApiMethod,
  pathname: string,
): OperationMatch {
  const exact = contract.operations.filter(
    (operation) =>
      operation.method === method && operation.pathTemplate === pathname,
  );

  if (exact.length === 1) {
    return {
      state: "found",
      operation: exact[0]!,
    };
  }

  const matches = contract.operations.filter(
    (operation) =>
      operation.method === method &&
      templateMatches(operation.pathTemplate, pathname),
  );

  if (matches.length === 1) {
    return {
      state: "found",
      operation: matches[0]!,
    };
  }

  return {
    state: matches.length === 0 ? "missing" : "ambiguous",
  };
}

export function matchOpenApiResponse(
  operation: OpenApiOperation,
  status: number,
): OpenApiResponseContract | undefined {
  const exact = String(status);
  const range = `${Math.floor(status / 100)}XX`;

  return (
    operation.responses.find((response) => response.statusKey === exact) ??
    operation.responses.find(
      (response) => response.statusKey.toUpperCase() === range,
    ) ??
    operation.responses.find(
      (response) => response.statusKey.toLowerCase() === "default",
    )
  );
}

export function normalizeMediaType(value: string): string {
  return value.split(";", 1)[0]!.trim().toLowerCase();
}

export function matchOpenApiMediaType(
  response: OpenApiResponseContract,
  actualMediaType: string,
):
  | {
      readonly mediaType: string;
      readonly shape: OpenApiShape;
    }
  | undefined {
  const normalized = normalizeMediaType(actualMediaType);
  const actualType = normalized.split("/", 1)[0];
  const candidates = [
    normalized,
    ...(actualType === undefined ? [] : [`${actualType}/*`]),
    "*/*",
  ];

  for (const mediaType of candidates) {
    const shape = response.mediaTypes.get(mediaType);
    if (shape !== undefined) {
      return {
        mediaType,
        shape,
      };
    }
  }

  return undefined;
}

function valueMatchesType(value: unknown, type: OpenApiPrimitiveType): boolean {
  switch (type) {
    case "array":
      return Array.isArray(value);
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "null":
      return value === null;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "object":
      return isRecord(value);
    case "string":
      return typeof value === "string";
  }
}

export type ShapeValidationResult =
  | {
      readonly state: "supported";
      readonly missingFields: readonly string[];
      readonly mismatchedFields: readonly string[];
      readonly topLevelMismatch: boolean;
    }
  | {
      readonly state: "unsupported";
    };

export function validateOpenApiShape(
  shape: OpenApiShape,
  value: unknown,
  additionalRequiredFields: readonly string[],
): ShapeValidationResult {
  if (shape.state !== "supported") {
    return {
      state: "unsupported",
    };
  }

  const required = new Set([...shape.required, ...additionalRequiredFields]);
  if ([...shape.propertyTypes.values()].includes("unsupported")) {
    return {
      state: "unsupported",
    };
  }

  const topLevelMismatch =
    shape.type !== undefined && !valueMatchesType(value, shape.type);

  if (!isRecord(value)) {
    return {
      state: "supported",
      missingFields: [...required],
      mismatchedFields: [],
      topLevelMismatch,
    };
  }

  const missingFields = [...required].filter(
    (field) => !Object.prototype.hasOwnProperty.call(value, field),
  );
  const mismatchedFields: string[] = [];

  for (const [field, expectedType] of shape.propertyTypes) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      continue;
    }

    if (expectedType === "unsupported") {
      return {
        state: "unsupported",
      };
    }

    if (
      expectedType !== undefined &&
      !valueMatchesType(value[field], expectedType)
    ) {
      mismatchedFields.push(field);
    }
  }

  return {
    state: "supported",
    missingFields,
    mismatchedFields,
    topLevelMismatch,
  };
}

export function isJsonMediaType(value: string): boolean {
  const normalized = normalizeMediaType(value);
  return (
    normalized === "application/json" ||
    normalized.endsWith("+json") ||
    normalized === "text/json"
  );
}
