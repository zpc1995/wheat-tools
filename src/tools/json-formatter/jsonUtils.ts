import type { JsonValue } from './JsonTree';

export interface JsonIssue {
  message: string;
  line?: number;
  column?: number;
  /** The offending source line, for a quick visual hint. */
  snippet?: string;
}

export interface JsonStats {
  kind: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  /** Total number of values, including the root. */
  nodes: number;
  /** Object members encountered at any depth. */
  keys: number;
  /** Deepest nesting level; a primitive root is depth 1. */
  depth: number;
  /** Size of the parsed data when serialized with the current indent. */
  bytes: number;
}

export type ParseResult =
  | { ok: true; value: JsonValue }
  | { ok: false; issue: JsonIssue };

/**
 * Parses JSON text and turns `JSON.parse`'s engine-specific message into a
 * structured issue with a line/column whenever the engine reports a position.
 */
export function parseJson(text: string): ParseResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, issue: { message: '请输入 JSON 内容' } };
  }

  try {
    return { ok: true, value: JSON.parse(trimmed) as JsonValue };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const issue: JsonIssue = { message: raw };

    // V8: "Unexpected token } in JSON at position 42"
    // Also handles: "... at line 3 column 5" (newer V8 builds).
    const positionMatch = /at position (\d+)/.exec(raw);
    const lineColMatch = /at line (\d+) column (\d+)/.exec(raw);

    if (lineColMatch) {
      issue.line = Number(lineColMatch[1]);
      issue.column = Number(lineColMatch[2]);
    } else if (positionMatch) {
      const position = Number(positionMatch[1]);
      const lines = trimmed.split('\n');
      let consumed = 0;
      for (let index = 0; index < lines.length; index += 1) {
        const lineLength = lines[index].length + 1; // + newline
        if (position < consumed + lineLength) {
          issue.line = index + 1;
          issue.column = position - consumed + 1;
          break;
        }
        consumed += lineLength;
      }
    }

    if (issue.line !== undefined) {
      issue.snippet = trimmed.split('\n')[issue.line - 1] ?? '';
    }
    return { ok: false, issue };
  }
}

function kindOf(value: JsonValue): JsonStats['kind'] {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const type = typeof value;
  if (type === 'object') return 'object';
  return type as JsonStats['kind'];
}

/** Walks the parsed value once to collect display statistics. */
export function collectStats(value: JsonValue, indent: number): JsonStats {
  let nodes = 0;
  let keys = 0;
  let depth = 0;

  const walk = (current: JsonValue, level: number): void => {
    nodes += 1;
    if (level > depth) depth = level;

    if (Array.isArray(current)) {
      for (const item of current) walk(item, level + 1);
      return;
    }
    if (current !== null && typeof current === 'object') {
      const entries = Object.entries(current);
      keys += entries.length;
      for (const [, item] of entries) walk(item, level + 1);
    }
  };

  walk(value, 1);

  const serialized = JSON.stringify(value, null, indent);
  return {
    kind: kindOf(value),
    nodes,
    keys,
    depth,
    bytes: new Blob([serialized ?? '']).size,
  };
}

/** Human-readable byte size, e.g. `1.2 KB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const KIND_LABELS: Record<JsonStats['kind'], string> = {
  object: '对象',
  array: '数组',
  string: '字符串',
  number: '数字',
  boolean: '布尔值',
  null: 'null',
};

export function describeKind(kind: JsonStats['kind']): string {
  return KIND_LABELS[kind];
}

/** Copies text, falling back to a hidden textarea on non-secure origins. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}
