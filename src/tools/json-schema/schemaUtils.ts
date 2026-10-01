/**
 * JSON → JSON Schema (draft 2020-12).
 *
 * The inferred type model is shared in spirit with the JSON-to-TypeScript tool,
 * but the output is a *validation* document, so the details that matter change:
 *
 * - **`required` comes from presence across all samples.** A field seen in only
 *   some samples is not required. This is the difference between a schema that
 *   validates the data you have and one that rejects data you will get.
 * - **Mixed types become `anyOf`, not a widened `type` array**, because each
 *   branch may need its own constraints (`format`, `items`, …) and `anyOf` keeps
 *   them distinct.
 * - **`additionalProperties` defaults to true.** Emitting `false` from a small
 *   sample set produces a schema that fails on the next extra field an API adds,
 *   which is the opposite of useful; it is offered as an explicit opt-in.
 * - **`format` is emitted as an annotation.** Draft 2020-12 treats `format` as
 *   non-asserting by default, so a schema with `"format": "email"` does not
 *   reject a malformed address unless the validator is configured to check it.
 *   That is stated rather than implied.
 */

export interface SchemaOptions {
  title: string;
  /** Emit `additionalProperties: false` on objects. */
  strictAdditionalProperties: boolean;
  /** Add `format` annotations for recognisable strings. */
  detectFormats: boolean;
  /** Include `examples` taken from the samples. */
  includeExamples: boolean;
  /** Include `$schema` and (when known) `description`. */
  includeSchemaKeyword: boolean;
}

export const DEFAULT_SCHEMA_OPTIONS: SchemaOptions = {
  title: 'Root',
  strictAdditionalProperties: false,
  detectFormats: true,
  includeExamples: true,
  includeSchemaKeyword: true,
};

/** JSON Schema type names. */
type JsonType = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';

interface Node {
  types: Set<JsonType>;
  /** Merged object properties, when `object` is among the types. */
  properties: Map<string, { node: Node; seenCount: number }>;
  /** Total object samples merged at this node. */
  objectSamples: number;
  /** Merged element schema, when `array` is among the types. */
  items: Node | null;
  /** A few example values, for `examples`. */
  examples: unknown[];
}

function emptyNode(): Node {
  return {
    types: new Set(),
    properties: new Map(),
    objectSamples: 0,
    items: null,
    examples: [],
  };
}

/** Merges one value into an accumulated node. */
function absorb(node: Node, value: unknown, maxExamples: number): void {
  if (node.examples.length < maxExamples && !node.examples.some((e) => sameValue(e, value))) {
    node.examples.push(value);
  }

  if (value === null) {
    node.types.add('null');
    return;
  }
  if (Array.isArray(value)) {
    node.types.add('array');
    if (!node.items) node.items = emptyNode();
    // Every element contributes; using only the first would hide later shapes.
    for (const item of value) absorb(node.items, item, maxExamples);
    return;
  }
  switch (typeof value) {
    case 'string':
      node.types.add('string');
      return;
    case 'number':
      // JSON has one number type; integers are a subset, reported via `type`.
      node.types.add('number');
      return;
    case 'boolean':
      node.types.add('boolean');
      return;
    case 'object': {
      node.types.add('object');
      node.objectSamples += 1;
      const record = value as Record<string, unknown>;
      for (const [key, child] of Object.entries(record)) {
        let entry = node.properties.get(key);
        if (!entry) {
          entry = { node: emptyNode(), seenCount: 0 };
          node.properties.set(key, entry);
        }
        entry.seenCount += 1;
        absorb(entry.node, child, maxExamples);
      }
      return;
    }
    default:
      // `undefined` / function / symbol cannot appear in parsed JSON.
      return;
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** Order of type keywords in the output, for stable diffs. */
const TYPE_ORDER: JsonType[] = ['object', 'array', 'string', 'number', 'boolean', 'null'];

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URI = /^https?:\/\/[^\s]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

/**
 * Guesses a `format` annotation from the observed strings.
 *
 * Only reported when **every** observed string matches, because a format that
 * holds for one sample but not another is worse than none: it documents a
 * constraint the data does not actually satisfy.
 */
function detectFormat(node: Node): string | null {
  const strings = node.examples.filter((value): value is string => typeof value === 'string');
  if (strings.length === 0) return null;

  const candidates: Array<[string, RegExp]> = [
    ['date-time', DATE_TIME],
    ['date', DATE_ONLY],
    ['email', EMAIL],
    ['uuid', UUID],
    ['ipv4', IPV4],
    ['uri', URI],
  ];

  for (const [format, pattern] of candidates) {
    if (strings.every((value) => pattern.test(value))) return format;
  }
  return null;
}

/** Converts an accumulated node into a schema object. */
function toSchema(node: Node, options: SchemaOptions, depth = 0): Record<string, unknown> {
  const types = TYPE_ORDER.filter((type) => node.types.has(type));
  const schema: Record<string, unknown> = {};

  // A single type is stated directly; several become `anyOf` so each branch can
  // carry its own keywords.
  if (types.length === 1) {
    schema.type = types[0];
  } else if (types.length > 1) {
    schema.anyOf = types.map((type) =>
      toSchema(
        {
          ...node,
          types: new Set([type]),
          // Keep only the structure relevant to this branch.
          properties: type === 'object' ? node.properties : new Map(),
          items: type === 'array' ? node.items : null,
          objectSamples: type === 'object' ? node.objectSamples : 0,
        },
        options,
        depth,
      ),
    );
  }

  // Nullability is more useful expressed as a union with null; `types` already
  // handles that, so nothing extra is needed here.

  if (node.types.has('object') && node.properties.size > 0) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, entry] of node.properties) {
      properties[key] = toSchema(entry.node, options, depth + 1);
      // Required only when present in every object sample merged here.
      if (entry.seenCount === node.objectSamples) required.push(key);
    }

    schema.properties = properties;
    if (required.length > 0) schema.required = required;
    if (options.strictAdditionalProperties) schema.additionalProperties = false;
  }

  if (node.types.has('array') && node.items) {
    // An array with no observed elements gets a permissive `items`.
    schema.items =
      node.items.types.size === 0 ? {} : toSchema(node.items, options, depth + 1);
  }

  if (
    options.detectFormats &&
    node.types.has('string') &&
    types.length === 1
  ) {
    const format = detectFormat(node);
    if (format) schema.format = format;
  }

  return schema;
}

export type InferResult =
  | {
      ok: true;
      schema: Record<string, unknown>;
      json: string;
      stats: {
        /** Number of `properties` maps emitted. */
        objects: number;
        properties: number;
        required: number;
        arrays: number;
        unions: number;
        formats: number;
        maxDepth: number;
      };
    }
  | { ok: false; error: string };

/** Counts the emitted keywords, for the summary panel. */
function countSchema(schema: unknown, depth = 1): {
  objects: number;
  properties: number;
  required: number;
  arrays: number;
  unions: number;
  formats: number;
  maxDepth: number;
} {
  const totals = {
    objects: 0,
    properties: 0,
    required: 0,
    arrays: 0,
    unions: 0,
    formats: 0,
    maxDepth: 0,
  };

  const walk = (value: unknown, level: number) => {
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;

    if (Array.isArray(record.anyOf)) {
      totals.unions += 1;
      for (const branch of record.anyOf) walk(branch, level);
    }
    if (record.properties && typeof record.properties === 'object') {
      totals.objects += 1;
      const props = record.properties as Record<string, unknown>;
      totals.properties += Object.keys(props).length;
      for (const child of Object.values(props)) walk(child, level + 1);
    }
    if (Array.isArray(record.required)) totals.required += record.required.length;
    if (record.items) {
      totals.arrays += 1;
      walk(record.items, level + 1);
    }
    if (typeof record.format === 'string') totals.formats += 1;
    totals.maxDepth = Math.max(totals.maxDepth, level);
  };

  walk(schema, depth);
  return totals;
}

/**
 * Parses one or more JSON samples.
 *
 * The whole input is attempted first: a single document may legitimately
 * contain blank lines. Only if that fails is the input split, so a multi-sample
 * paste still works while a pretty-printed single sample is never mangled.
 */
export function parseSamples(
  input: string,
): { ok: true; values: unknown[] } | { ok: false; error: string } {
  const text = input.trim();
  if (!text) return { ok: false, error: '请输入 JSON 样本' };

  try {
    return { ok: true, values: [JSON.parse(text) as unknown] };
  } catch {
    // Fall through to splitting.
  }

  const chunks = text
    .split(/\n\s*---\s*\n|\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  if (chunks.length > 1) {
    const values: unknown[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      try {
        values.push(JSON.parse(chunks[index]) as unknown);
      } catch (error) {
        return {
          ok: false,
          error: `第 ${index + 1} 个样本不是合法 JSON：${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    }
    return { ok: true, values };
  }

  try {
    return { ok: true, values: [JSON.parse(text) as unknown] };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'JSON 解析失败',
    };
  }
}

/** Builds a JSON Schema from one or more samples. */
export function toJsonSchema(
  values: unknown[],
  options: SchemaOptions = DEFAULT_SCHEMA_OPTIONS,
): InferResult {
  if (values.length === 0) return { ok: false, error: '没有可用的样本' };

  const root = emptyNode();
  for (const value of values) absorb(root, value, options.includeExamples ? 3 : 0);

  if (root.types.size === 0) {
    return { ok: false, error: '样本中没有可推断的值' };
  }

  const body = toSchema(root, options);

  const schema: Record<string, unknown> = {};
  if (options.includeSchemaKeyword) {
    schema.$schema = 'https://json-schema.org/draft/2020-12/schema';
  }
  if (options.title.trim()) schema.title = options.title.trim();
  Object.assign(schema, body);

  if (options.includeExamples && root.examples.length > 0 && values.length === 1) {
    // `examples` on the root is only meaningful for a single sample; with several
    // merged samples there is no single value to show.
    schema.examples = root.examples;
  }

  if (!('type' in schema) && !('anyOf' in schema)) {
    return {
      ok: false,
      error: '无法推断根类型（样本可能只有 null）',
    };
  }

  return {
    ok: true,
    schema,
    json: JSON.stringify(schema, null, 2),
    stats: countSchema(body),
  };
}

export const SCHEMA_SAMPLE = `{
  "id": "usr_8f3a",
  "name": "张伟",
  "email": "zhang@example.com",
  "createdAt": "2026-01-15T08:30:00Z",
  "age": 32,
  "verified": true,
  "score": 98.5,
  "deletedAt": null,
  "roles": ["admin", "editor"],
  "profile": {
    "avatar": "https://cdn.example.com/a.png",
    "bio": null,
    "links": { "github": "zpc1995" }
  },
  "loginCount": 128
}`;

/** A second sample that differs, to demonstrate `required` inference. */
export const SCHEMA_SAMPLE_2 = `{
  "id": "usr_9a1b",
  "name": "李娜",
  "email": "li@example.com",
  "createdAt": "2026-02-20T11:05:00Z",
  "verified": false,
  "deletedAt": "2026-03-01T00:00:00Z",
  "roles": [],
  "profile": {
    "avatar": null,
    "links": {}
  },
  "nickname": "娜娜"
}`;

/** Notes worth showing next to the output. */
export const SCHEMA_NOTES: string[] = [
  '`required` 只包含在所有样本中都出现的字段——只出现过一次的字段不会被标记为必填，否则下一份数据就会被误判为无效。',
  '`format` 在 draft 2020-12 中默认只是注解，并不会真正校验。要让它生效，需要在校验器上显式开启（例如 ajv 的 `validateFormats: true`）。',
  '默认不输出 `additionalProperties: false`：由少量样本推断出的封闭结构，会在接口新增字段时立刻失败。需要严格校验时请手动开启。',
  '推断出的类型来自你给的样本。样本没覆盖到的取值、以及「字符串里其实是日期」这类语义，Schema 无法自动得知。',
];
