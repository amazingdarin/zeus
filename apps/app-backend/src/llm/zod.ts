import { z } from "zod";

// zod@v4 (classic) no longer exports `AnyZodObject`; keep a local alias so
// the rest of the app can depend on a stable name.
export type AnyZodObject = z.ZodObject;

export type OpenAIParameterProperty = {
  type: string;
  description: string;
  enum?: string[];
};

export type OpenAIParametersSchema = {
  type: "object";
  properties: Record<string, OpenAIParameterProperty>;
  required: string[];
};

export type JsonSchemaPropertyLike = {
  type: string;
  description: string;
  enum?: string[];
  optional?: boolean;
};

export type JsonSchemaObjectLike = {
  type: "object";
  properties: Record<string, JsonSchemaPropertyLike>;
  required: string[];
};

function unwrap(schema: z.ZodType): z.ZodType {
  let current: z.ZodType = schema;
  // Handle the wrappers we use (optional/default/nullable). Keep it small and explicit.
  for (let i = 0; i < 8; i += 1) {
    if (
      current instanceof z.ZodOptional
      || current instanceof z.ZodDefault
      || current instanceof z.ZodNullable
    ) {
      // zod v4 types model `.unwrap()` as returning a low-level core type.
      // Runtime instances are still proper Zod schemas, so an explicit cast is ok here.
      current = (current as unknown as { unwrap(): unknown }).unwrap() as z.ZodType;
      continue;
    }
    break;
  }
  return current;
}

function zodTypeToOpenAIProperty(schema: z.ZodType, fallbackDesc: string): OpenAIParameterProperty {
  const inner = unwrap(schema);
  const description = (typeof inner.description === "string" && inner.description.trim())
    ? inner.description.trim()
    : fallbackDesc;

  if (inner instanceof z.ZodString) {
    return { type: "string", description };
  }
  if (inner instanceof z.ZodNumber) {
    return { type: "number", description };
  }
  if (inner instanceof z.ZodBoolean) {
    return { type: "boolean", description };
  }
  if (inner instanceof z.ZodEnum) {
    const options = inner.options;
    const strings = options.filter((value): value is string => typeof value === "string");
    const enumValues = (strings.length > 0 ? strings : options.map((value) => String(value)));
    return { type: "string", description, enum: Array.from(new Set(enumValues)) };
  }
  if (inner instanceof z.ZodLiteral) {
    const values = Array.from(inner.values);
    const strings = values.filter((value): value is string => typeof value === "string");
    if (strings.length > 0) {
      return { type: "string", description, enum: Array.from(new Set(strings)) };
    }
    const [only] = values;
    if (typeof only === "number") {
      return { type: "number", description };
    }
    if (typeof only === "boolean") {
      return { type: "boolean", description };
    }
    return { type: "string", description };
  }
  if (inner instanceof z.ZodArray) {
    return { type: "array", description };
  }
  if (inner instanceof z.ZodObject) {
    return { type: "object", description };
  }
  if (inner instanceof z.ZodRecord) {
    return { type: "object", description };
  }
  return { type: "string", description };
}

export function zodObjectToOpenAIParameters(schema: AnyZodObject): OpenAIParametersSchema {
  const shape = schema.shape as Record<string, z.ZodType>;
  const properties: Record<string, OpenAIParameterProperty> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    properties[key] = zodTypeToOpenAIProperty(value, key);
    if (!value.isOptional()) {
      required.push(key);
    }
  }

  return {
    type: "object",
    properties,
    required,
  };
}

export function zodObjectToJsonSchema(schema: AnyZodObject): JsonSchemaObjectLike {
  const openai = zodObjectToOpenAIParameters(schema);
  const optional = new Set(Object.keys(openai.properties).filter((k) => !openai.required.includes(k)));

  const properties: Record<string, JsonSchemaPropertyLike> = {};
  for (const [key, value] of Object.entries(openai.properties)) {
    properties[key] = {
      ...value,
      ...(optional.has(key) ? { optional: true } : {}),
    };
  }

  return {
    type: "object",
    properties,
    required: openai.required,
  };
}

export function zodObjectHasRequiredKey(schema: AnyZodObject, key: string): boolean {
  const shape = schema.shape as Record<string, z.ZodType>;
  const field = shape[key];
  return Boolean(field && !field.isOptional());
}

function jsonPropToZod(prop: JsonSchemaPropertyLike): z.ZodType {
  let schema: z.ZodType;

  // NOTE: Keep the mapping intentionally small. These schemas are used as
  // "tool-call arguments" contracts, not for deep data validation.
  switch (prop.type) {
    case "string": {
      if (Array.isArray(prop.enum) && prop.enum.length > 0) {
        // z.enum requires a non-empty tuple.
        schema = z.enum(prop.enum as [string, ...string[]]);
      } else {
        schema = z.string();
      }
      break;
    }
    case "number":
      schema = z.number();
      break;
    case "boolean":
      schema = z.boolean();
      break;
    case "array":
      schema = z.array(z.any());
      break;
    case "object":
      schema = z.record(z.string(), z.any());
      break;
    default:
      schema = z.any();
      break;
  }

  if (typeof prop.description === "string" && prop.description.trim()) {
    schema = schema.describe(prop.description.trim());
  }

  return schema;
}

export function jsonSchemaToZodObject(schema: JsonSchemaObjectLike): AnyZodObject {
  const required = new Set(schema.required || []);
  const shape: Record<string, z.ZodType> = {};

  for (const [key, prop] of Object.entries(schema.properties || {})) {
    let field = jsonPropToZod(prop);
    const isRequired = required.has(key) && prop.optional !== true;
    if (!isRequired) {
      field = field.optional();
    }
    shape[key] = field;
  }

  return z.object(shape);
}
