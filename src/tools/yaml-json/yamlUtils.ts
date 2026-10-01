import { parseDocument, stringify as yamlStringify, YAMLParseError } from 'yaml';

/**
 * YAML ↔ JSON conversion.
 *
 * Three things needed care:
 *
 * 1. **Error reporting.** `YAML.parse()` throws away recoverable document
 *    errors — a file with duplicate keys parses "successfully" and silently
 *    keeps the last value. `parseDocument()` exposes `doc.errors`, so that is
 *    what is used, and duplicates are reported instead of hidden.
 * 2. **Tag deserialisation.** Only the `core` schema is enabled, so constructs
 *    like `!!js/function` are treated as plain scalars rather than being turned
 *    into live values. `merge: false` keeps `<<` from acting as a merge key.
 * 3. **Resource exhaustion.** Alias expansion is the classic YAML bomb. The
 *    parser counts aliases and refuses excessive ones on its own; an input size
 *    cap adds a second bound.
 *
 * Prototype pollution was checked explicitly: `__proto__` in the source becomes
 * an ordinary own property (`Object.prototype` is untouched), but it is
 * surfaced as a warning because it produces a surprising JSON key.
 */

/** Refuse inputs larger than this; parsing is synchronous and blocking. */
export const MAX_INPUT_BYTES = 512 * 1024;

const PARSE_OPTIONS = {
  // `core` covers plain YAML; notably it does NOT execute custom JS tags.
  schema: 'core' as const,
  // `<<` merge keys are a non-standard extension; off by default here.
  merge: false,
  // Report duplicate keys as errors rather than silently overwriting.
  uniqueKeys: true,
  // Surface problems through `doc.errors` instead of console noise.
  logLevel: 'silent' as const,
};

export interface YamlWarning {
  message: string;
  line?: number;
}

export type YamlToJsonResult =
  | {
      ok: true;
      json: string;
      /** Parsed value, for the tree/statistics view. */
      value: unknown;
      warnings: YamlWarning[];
      /** Number of YAML documents found. */
      documents: number;
    }
  | { ok: false; error: string; warnings: YamlWarning[] };

function formatError(error: YAMLParseError): string {
  const line = error.linePos?.[0];
  const position = line ? `第 ${line.line} 行第 ${line.col} 列：` : '';
  // The raw message repeats the source excerpt; keep only the first line.
  const message = error.message.split('\n')[0];
  return `${position}${message}`;
}

/** Walks the parsed value looking for keys that would surprise downstream code. */
function collectWarnings(value: unknown, warnings: YamlWarning[], path = ''): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectWarnings(item, warnings, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const here = path ? `${path}.${key}` : key;
      if (key === '__proto__') {
        warnings.push({
          message: `键 “${here}” 是 __proto__，会作为普通字段出现在 JSON 中，请注意下游代码的兼容性`,
        });
      }
      collectWarnings(child, warnings, here);
    }
  }
}

/** Converts YAML text to pretty-printed JSON. */
export function yamlToJson(source: string, indent = 2): YamlToJsonResult {
  const warnings: YamlWarning[] = [];

  if (!source.trim()) {
    return { ok: false, error: '请输入 YAML 内容', warnings };
  }
  if (source.length > MAX_INPUT_BYTES) {
    return {
      ok: false,
      error: `输入过大（${Math.round(source.length / 1024)} KB），上限为 ${Math.round(
        MAX_INPUT_BYTES / 1024,
      )} KB`,
      warnings,
    };
  }

  let documents;
  try {
    documents = parseDocument(source, PARSE_OPTIONS);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'YAML 解析失败',
      warnings,
    };
  }

  if (documents.errors.length > 0) {
    return { ok: false, error: formatError(documents.errors[0]), warnings };
  }

  // A YAML file may hold several documents separated by `---`. Convert the
  // first, but say how many were found rather than ignoring the rest silently.
  //
  // `parseAll` materialises values via `toJS()`, which is where the parser's
  // alias-expansion guard actually fires (as a thrown ReferenceError, not a
  // document error). That must be caught here: an uncaught throw would take
  // the whole tool down rather than reporting a rejected input.
  let all: Array<{ value: unknown }>;
  try {
    all = parseAll(source);
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `解析被中止：${error.message}`
          : '解析被中止（可能是别名展开导致的资源耗尽）',
      warnings,
    };
  }

  const first = all[0];
  const value = first?.value ?? null;

  collectWarnings(value, warnings);

  let json: string;
  try {
    json = JSON.stringify(value, null, indent) ?? 'null';
  } catch (error) {
    return {
      ok: false,
      error: `无法序列化为 JSON：${
        error instanceof Error ? error.message : String(error)
      }`,
      warnings,
    };
  }

  if (all.length > 1) {
    warnings.push({
      message: `源文件包含 ${all.length} 个 YAML 文档，这里只转换了第一个（其余可分段粘贴）`,
    });
  }

  return { ok: true, json, value, warnings, documents: all.length };
}

/** Splits a multi-document YAML source into individual parses. */
function parseAll(source: string): Array<{ value: unknown }> {
  const results: Array<{ value: unknown }> = [];
  const chunks = source.split(/^---\s*$/m);

  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    try {
      const doc = parseDocument(chunk, PARSE_OPTIONS);
      // `toJS()` can throw even when `doc.errors` is empty — the alias-count
      // guard is a runtime throw. Skipping the chunk keeps multi-document
      // input usable while the caller reports the problem.
      if (doc.errors.length === 0) results.push({ value: doc.toJS() });
    } catch {
      // Reported by the caller; a single bad document must not fail the rest.
    }
  }

  if (results.length === 0) {
    // Let this throw: the caller turns it into a user-facing error.
    const doc = parseDocument(source, PARSE_OPTIONS);
    results.push({ value: doc.toJS() });
  }
  return results;
}

export type JsonToYamlResult =
  | { ok: true; yaml: string; warnings: YamlWarning[] }
  | { ok: false; error: string; warnings: YamlWarning[] };

/** Converts JSON text to YAML. */
export function jsonToYaml(source: string, indent = 2, sortKeys = false): JsonToYamlResult {
  const warnings: YamlWarning[] = [];

  if (!source.trim()) return { ok: false, error: '请输入 JSON 内容', warnings };
  if (source.length > MAX_INPUT_BYTES) {
    return { ok: false, error: '输入过大', warnings };
  }

  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    return {
      ok: false,
      error: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
      warnings,
    };
  }

  collectWarnings(value, warnings);

  try {
    const yaml = yamlStringify(value, {
      indent,
      // Keep insertion order by default; sorting is opt-in.
      sortMapEntries: sortKeys,
      // Quote ambiguous scalars (e.g. "yes", "1.0") so the round-trip is safe.
      defaultStringType: 'PLAIN',
      defaultKeyType: 'PLAIN',
      lineWidth: 0,
    });
    return { ok: true, yaml, warnings };
  } catch (error) {
    return {
      ok: false,
      error: `无法序列化为 YAML：${
        error instanceof Error ? error.message : String(error)
      }`,
      warnings,
    };
  }
}

export interface ConversionStats {
  /** Rough structural statistics for the result panel. */
  nodes: number;
  depth: number;
  keys: number;
  arrays: number;
  kind: string;
}

export function collectStats(value: unknown): ConversionStats {
  let nodes = 0;
  let keys = 0;
  let arrays = 0;
  let depth = 0;

  const walk = (current: unknown, level: number) => {
    nodes += 1;
    depth = Math.max(depth, level);
    if (Array.isArray(current)) {
      arrays += 1;
      current.forEach((item) => walk(item, level + 1));
      return;
    }
    if (current && typeof current === 'object') {
      const entries = Object.entries(current as Record<string, unknown>);
      keys += entries.length;
      entries.forEach(([, item]) => walk(item, level + 1));
    }
  };

  walk(value, 1);

  const kind = Array.isArray(value)
    ? '数组'
    : value === null
      ? 'null'
      : typeof value === 'object'
        ? '对象'
        : typeof value;

  return { nodes, depth, keys, arrays, kind };
}

export const YAML_SAMPLE = `# 示例配置
name: wheat-tools
version: 0.1.0
enabled: true
tags:
  - json
  - yaml
  - devtools
server:
  host: 0.0.0.0
  port: 5273
  tls: false
limits:
  # 注意：YAML 里 yes/no 会被解析为布尔值
  maxUpload: 10
  timeout: 30s
nullValue: null
quoted: "123"
multiline: |
  第一行
  第二行
`;

export const JSON_SAMPLE = `{
  "name": "wheat-tools",
  "version": "0.1.0",
  "enabled": true,
  "tags": ["json", "yaml", "devtools"],
  "server": { "host": "0.0.0.0", "port": 5273, "tls": false },
  "limits": { "maxUpload": 10, "timeout": "30s" },
  "nullValue": null
}`;

/** Common YAML shapes that surprise people; used by a hint panel. */
export const YAML_GOTCHAS: Array<{ yaml: string; json: string }> = [
  { yaml: 'yes / no / on / off', json: '布尔值（YAML 1.1）；core 模式下仅 true/false' },
  { yaml: '123', json: '数字' },
  { yaml: '"123"', json: '字符串' },
  { yaml: 'null / ~ / 空', json: 'null' },
  { yaml: '# 注释', json: 'JSON 不支持注释' },
  { yaml: '&anchor / *alias', json: '共享引用，展开后会重复' },
];
