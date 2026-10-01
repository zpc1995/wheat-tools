/**
 * Infers types from JSON and emits TypeScript or Go declarations.
 *
 * The interesting part is not the happy path but the merge: given several JSON
 * samples, a field present in only some of them should become optional rather
 * than being typed from whichever sample happened to be parsed last. That is
 * what makes the output usable for real API responses instead of only for a
 * single example.
 *
 * Type inference notes:
 * - `null` alongside another type becomes `T | null` rather than collapsing to
 *   `any`, and a field that is sometimes absent becomes optional (`?`).
 * - Mixed scalar kinds become a union (`string | number`), not `any`, so the
 *   union is visible and can be narrowed deliberately.
 * - Arrays are inferred from *every* element, not just the first — a
 *   single-element array would otherwise hide later shapes.
 */

export interface InferOptions {
  /** Name of the root type. */
  rootName: string;
  /** Emit `readonly` modifiers (TypeScript only). */
  readonly: boolean;
  /** Emit `null` in unions (off → nullable fields become optional instead). */
  includeNull: boolean;
  /** How many spaces to indent. */
  indent: number;
  /** Sort object keys alphabetically rather than by first appearance. */
  sortKeys: boolean;
}

export const DEFAULT_INFER_OPTIONS: InferOptions = {
  rootName: 'Root',
  readonly: false,
  includeNull: true,
  indent: 2,
  sortKeys: false,
};

/** A structural type produced by inference. */
export type InferredType =
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'null' }
  | { kind: 'unknown' }
  | { kind: 'array'; element: InferredType }
  | { kind: 'union'; members: InferredType[] }
  | { kind: 'object'; fields: InferredField[] };

export interface InferredField {
  name: string;
  type: InferredType;
  /** True when the key was absent in at least one merged sample. */
  optional: boolean;
}

export function inferType(value: unknown): InferredType {
  if (value === null) return { kind: 'null' };

  if (Array.isArray(value)) {
    if (value.length === 0) {
      // An empty array carries no element information at all.
      return { kind: 'array', element: { kind: 'unknown' } };
    }
    // Merge every element so heterogeneous arrays surface as unions.
    const element = value
      .map(inferType)
      .reduce((acc, next) => mergeTypes(acc, next));
    return { kind: 'array', element };
  }

  switch (typeof value) {
    case 'string':
      return { kind: 'string' };
    case 'number':
      return { kind: 'number' };
    case 'boolean':
      return { kind: 'boolean' };
    case 'object': {
      const record = value as Record<string, unknown>;
      return {
        kind: 'object',
        fields: Object.entries(record).map(([name, child]) => ({
          name,
          type: inferType(child),
          optional: false,
        })),
      };
    }
    default:
      return { kind: 'unknown' };
  }
}

/** Canonical key for de-duplicating union members. */
function typeKey(type: InferredType): string {
  switch (type.kind) {
    case 'array':
      return `array<${typeKey(type.element)}>`;
    case 'object':
      return `object{${type.fields
        .map((field) => `${field.name}${field.optional ? '?' : ''}:${typeKey(field.type)}`)
        .join(',')}}`;
    case 'union':
      return type.members.map(typeKey).sort().join('|');
    default:
      return type.kind;
  }
}

/**
 * Merges two inferred types into one that accepts both.
 *
 * Used both for array elements and for merging whole samples, so a field that
 * differs between samples becomes a union rather than an arbitrary winner.
 */
export function mergeTypes(a: InferredType, b: InferredType): InferredType {
  if (typeKey(a) === typeKey(b)) return a;

  // unknown absorbs nothing; anything merged with unknown stays itself so an
  // empty array does not erase real element types.
  if (a.kind === 'unknown') return b;
  if (b.kind === 'unknown') return a;

  // Arrays merge element-wise so `[1]` and `["x"]` give `(number | string)[]`.
  if (a.kind === 'array' && b.kind === 'array') {
    return { kind: 'array', element: mergeTypes(a.element, b.element) };
  }

  // Objects merge field-wise; a key missing on either side becomes optional.
  if (a.kind === 'object' && b.kind === 'object') {
    const names: string[] = [];
    const seen = new Set<string>();
    for (const field of [...a.fields, ...b.fields]) {
      if (seen.has(field.name)) continue;
      seen.add(field.name);
      names.push(field.name);
    }

    const fields: InferredField[] = names.map((name) => {
      const inA = a.fields.find((field) => field.name === name);
      const inB = b.fields.find((field) => field.name === name);
      if (inA && inB) {
        return {
          name,
          type: mergeTypes(inA.type, inB.type),
          optional: inA.optional || inB.optional,
        };
      }
      const only = (inA ?? inB) as InferredField;
      return { name, type: only.type, optional: true };
    });

    return { kind: 'object', fields };
  }

  // Otherwise collect a union, flattening and de-duplicating members.
  const members: InferredType[] = [];
  const push = (type: InferredType) => {
    const list = type.kind === 'union' ? type.members : [type];
    for (const member of list) {
      if (!members.some((existing) => typeKey(existing) === typeKey(member))) {
        members.push(member);
      }
    }
  };
  push(a);
  push(b);

  // Keep `null` last so unions read as `string | null` rather than the reverse;
  // it is cosmetic but it is what people expect to see.
  const ordered = [
    ...members.filter((member) => member.kind !== 'null'),
    ...members.filter((member) => member.kind === 'null'),
  ];
  return { kind: 'union', members: ordered };
}

/**
 * Merges several parsed samples into one type.
 *
 * This is what turns "here are three API responses" into a type with correctly
 * optional fields.
 */
export function mergeSamples(values: unknown[]): InferredType {
  if (values.length === 0) return { kind: 'unknown' };
  return values.map(inferType).reduce((acc, next) => mergeTypes(acc, next));
}

// ---------------------------------------------------------------------------
// TypeScript emission
// ---------------------------------------------------------------------------

/**
 * Emitter state.
 *
 * Nested objects are hoisted into named interfaces. Crucially the name is
 * allocated **once**, at the moment the object is hoisted, and the rendered
 * field types are stored alongside it — deriving the name a second time in the
 * renderer is what makes such emitters drift out of sync.
 */
interface TsEmitter {
  /** Declarations in dependency order (children before parents). */
  decls: string[];
  used: Set<string>;
  options: InferOptions;
}

function pascalCase(input: string): string {
  const cleaned = input.replace(/[^a-zA-Z0-9]+/g, ' ').trim();
  if (!cleaned) return 'Item';
  return cleaned
    .split(/\s+/)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('');
}

function uniqueName(base: string, used: Set<string>): string {
  const start = pascalCase(base) || 'Item';
  if (!used.has(start)) {
    used.add(start);
    return start;
  }
  let index = 2;
  while (used.has(`${start}${index}`)) index += 1;
  const name = `${start}${index}`;
  used.add(name);
  return name;
}

const TS_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Removes `null` from a type, reporting whether anything was removed.
 *
 * Used when the caller opted out of explicit nulls: a nullable field then
 * becomes optional instead of carrying `| null`, which is usually what is
 * wanted for a field that is simply sometimes absent.
 */
function stripNull(type: InferredType): { type: InferredType; changed: boolean } {
  if (type.kind === 'null') return { type: { kind: 'unknown' }, changed: true };
  if (type.kind === 'union') {
    const kept = type.members.filter((member) => member.kind !== 'null');
    if (kept.length === type.members.length) return { type, changed: false };
    if (kept.length === 0) return { type: { kind: 'unknown' }, changed: true };
    if (kept.length === 1) return { type: kept[0], changed: true };
    return { type: { kind: 'union', members: kept }, changed: true };
  }
  return { type, changed: false };
}

/**
 * Renders a type expression, hoisting objects into named interfaces.
 *
 * Returns the type reference to use at the call site.
 */
function emitTsType(type: InferredType, nameHint: string, emitter: TsEmitter): string {
  const { options } = emitter;

  switch (type.kind) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'unknown':
      return 'unknown';

    case 'array': {
      const inner = emitTsType(type.element, `${nameHint}Item`, emitter);
      // Parenthesise unions so `(A | B)[]` is not read as `A | B[]`.
      return type.element.kind === 'union' ? `(${inner})[]` : `${inner}[]`;
    }

    case 'object': {
      if (type.fields.length === 0) return 'Record<string, never>';

      const name = uniqueName(nameHint, emitter.used);
      const pad = ' '.repeat(options.indent);
      const readonlyToken = options.readonly ? 'readonly ' : '';

      const fields = options.sortKeys
        ? [...type.fields].sort((a, b) => a.name.localeCompare(b.name))
        : type.fields;

      // Emit children first so the declaration order reads bottom-up; either
      // order is valid in TypeScript, but this keeps the root last.
      const lines: string[] = [];
      for (const field of fields) {
        const key = TS_IDENTIFIER.test(field.name)
          ? field.name
          : JSON.stringify(field.name);

        // With `includeNull` off, a nullable field becomes optional and `null`
        // is dropped from its type — handled per field, because filtering only
        // inside the union renderer would leave a pure-null field as `null`.
        let fieldType_ = field.type;
        let optional = field.optional;
        if (!options.includeNull) {
          const stripped = stripNull(fieldType_);
          if (stripped.changed) {
            fieldType_ = stripped.type;
            optional = true;
          }
        }

        const rendered = emitTsType(
          fieldType_,
          `${name}${pascalCase(field.name)}`,
          emitter,
        );
        lines.push(`${pad}${readonlyToken}${key}${optional ? '?' : ''}: ${rendered};`);
      }

      emitter.decls.push(`export interface ${name} {\n${lines.join('\n')}\n}`);
      return name;
    }

    case 'union': {
      const members = type.members
        .filter((member) => options.includeNull || member.kind !== 'null')
        .map((member) => emitTsType(member, nameHint, emitter));
      const unique = [...new Set(members)];
      if (unique.length === 0) return 'null';
      return unique.join(' | ');
    }
  }
}

export interface GeneratedType {
  name: string;
  body: string;
}

export type GenerateResult =
  | { ok: true; code: string; types: GeneratedType[]; typeCount: number; fieldCount: number }
  | { ok: false; error: string };

/**
 * Parses one or more JSON samples.
 *
 * The whole input is tried first, because a single valid document may itself
 * contain blank lines or `---` inside a string; only if that fails is the input
 * split into samples.
 */
export function parseSamples(
  input: string,
): { ok: true; values: unknown[] } | { ok: false; error: string } {
  const text = input.trim();
  if (!text) return { ok: false, error: '请输入 JSON' };

  try {
    return { ok: true, values: [JSON.parse(text) as unknown] };
  } catch {
    // Fall through to multi-sample handling.
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

/** Generates TypeScript declarations from one or more samples. */
export function toTypeScript(
  values: unknown[],
  options: InferOptions = DEFAULT_INFER_OPTIONS,
): GenerateResult {
  if (values.length === 0) return { ok: false, error: '没有可用的样本' };

  const merged = mergeSamples(values);
  if (merged.kind !== 'object' && merged.kind !== 'array') {
    const kind = merged.kind === 'null' ? 'null' : merged.kind;
    return { ok: false, error: `根值是一个 ${kind}，请提供对象或数组` };
  }

  const rootName = pascalCase(options.rootName) || 'Root';
  const emitter: TsEmitter = {
    decls: [],
    // The root name is deliberately NOT pre-reserved. `emitTsType` is called on
    // the root first, so it claims the plain name naturally; pre-reserving it
    // made the root interface come out as `Root2`.
    used: new Set<string>(),
    options,
  };

  const rootType = emitTsType(merged, rootName, emitter);

  const lines: string[] = [];
  // If the root itself was not hoisted (array or union root), alias it instead.
  if (!emitter.decls.some((decl) => decl.startsWith(`export interface ${rootName} `))) {
    lines.push(`export type ${rootName} = ${rootType};`);
    lines.push('');
  }
  lines.push(...emitter.decls);

  const body = lines.join('\n').replace(/\n+$/, '');

  const types: GeneratedType[] = emitter.decls.map((decl) => {
    const match = /^export interface (\w+) /.exec(decl);
    return { name: match ? match[1] : rootName, body: decl };
  });
  if (types.length === 0) types.push({ name: rootName, body });

  const fieldCount = countFields(merged);

  return {
    ok: true,
    code: body,
    types,
    typeCount: Math.max(types.length, 1),
    fieldCount,
  };
}

function countFields(type: InferredType): number {
  if (type.kind === 'object') {
    return (
      type.fields.length +
      type.fields.reduce((sum, field) => sum + countFields(field.type), 0)
    );
  }
  if (type.kind === 'array') return countFields(type.element);
  if (type.kind === 'union') {
    return type.members.reduce((sum, member) => sum + countFields(member), 0);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Go emission
// ---------------------------------------------------------------------------

const GO_KEYWORDS = new Set([
  'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else',
  'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface',
  'map', 'package', 'range', 'return', 'select', 'struct', 'switch', 'type', 'var',
]);

/** Exported Go field name (must start upper-case to be marshalled). */
function goFieldName(input: string): string {
  const cleaned = input.replace(/[^a-zA-Z0-9]+/g, ' ').trim();
  if (!cleaned) return 'Field';
  let name = cleaned
    .split(/\s+/)
    .map((word) => (word[0] ? word[0].toUpperCase() + word.slice(1) : ''))
    .join('');
  if (!name) name = 'Field';
  if (!/^[A-Z]/.test(name)) name = `X${name}`;
  if (GO_KEYWORDS.has(name.toLowerCase())) name = `${name}Field`;
  return name;
}

interface GoEmitter {
  decls: string[];
  used: Set<string>;
  options: InferOptions;
}

function emitGoType(type: InferredType, nameHint: string, emitter: GoEmitter): string {
  switch (type.kind) {
    case 'string':
      return 'string';
    case 'number':
      // JSON has a single number type; `float64` also accepts integers, whereas
      // emitting `int` would be wrong for values like 1.5.
      return 'float64';
    case 'boolean':
      return 'bool';
    case 'null':
      return 'interface{}';
    case 'unknown':
      return 'interface{}';

    case 'array':
      return `[]${emitGoType(type.element, `${nameHint}Item`, emitter)}`;

    case 'object': {
      if (type.fields.length === 0) return 'map[string]interface{}';

      const name = uniqueName(nameHint, emitter.used);
      const pad = '\t';

      const fields = emitter.options.sortKeys
        ? [...type.fields].sort((a, b) => a.name.localeCompare(b.name))
        : type.fields;

      const lines: string[] = [];
      for (const field of fields) {
        const goName = goFieldName(field.name);
        const fieldType = emitGoType(field.type, `${name}${goName}`, emitter);
        const tag = field.optional ? `${field.name},omitempty` : field.name;
        lines.push(`${pad}${goName} ${fieldType} \`json:"${tag}"\``);
      }

      emitter.decls.push(`type ${name} struct {\n${lines.join('\n')}\n}`);
      return name;
    }

    case 'union': {
      const members = [...new Set(type.members.map((m) => emitGoType(m, nameHint, emitter)))];
      if (members.length === 1) return members[0];
      // Go has no union type; interface{} is the honest representation rather
      // than silently picking one of the observed types.
      return 'interface{}';
    }
  }
}

/** Generates Go struct declarations with `json` tags. */
export function toGo(
  values: unknown[],
  options: InferOptions = DEFAULT_INFER_OPTIONS,
): GenerateResult {
  if (values.length === 0) return { ok: false, error: '没有可用的样本' };

  const merged = mergeSamples(values);
  if (merged.kind !== 'object' && merged.kind !== 'array') {
    const kind = merged.kind === 'null' ? 'null' : merged.kind;
    return { ok: false, error: `根值是一个 ${kind}，请提供对象或数组` };
  }

  const rootName = pascalCase(options.rootName) || 'Root';
  const emitter: GoEmitter = {
    decls: [],
    // Same reasoning as the TypeScript emitter: the root is hoisted first and
    // claims its plain name without needing a reservation.
    used: new Set<string>(),
    options,
  };

  const rootType = emitGoType(merged, rootName, emitter);

  const header = [
    'package main',
    '',
    '// 由 JSON 推断生成。',
    '// 数字统一使用 float64：JSON 只有一种数字类型，用 int 会丢失小数。',
  ];

  const lines = [...header];
  if (!emitter.decls.some((decl) => decl.startsWith(`type ${rootName} struct`))) {
    lines.push('', `type ${rootName} = ${rootType}`);
  }
  lines.push('', ...emitter.decls);

  const body = lines.join('\n').replace(/\n+$/, '');

  const types: GeneratedType[] = emitter.decls.map((decl) => {
    const match = /^type (\w+) struct/.exec(decl);
    return { name: match ? match[1] : rootName, body: decl };
  });
  if (types.length === 0) types.push({ name: rootName, body });

  return {
    ok: true,
    code: body,
    types,
    typeCount: Math.max(types.length, 1),
    fieldCount: countFields(merged),
  };
}

export const JSON_TYPE_SAMPLE = `{
  "id": "usr_8f3a",
  "name": "张伟",
  "email": "zhang@example.com",
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

/** A second sample used to demonstrate optional-field inference. */
export const JSON_TYPE_SAMPLE_2 = `{
  "id": "usr_9a1b",
  "name": "李娜",
  "email": "li@example.com",
  "age": 28,
  "verified": false,
  "deletedAt": "2026-01-01T00:00:00Z",
  "roles": [],
  "profile": {
    "avatar": null,
    "bio": "前端工程师",
    "links": {}
  },
  "nickname": "娜娜"
}`;
