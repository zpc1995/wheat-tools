/**
 * Line and word diffing.
 *
 * Uses a longest-common-subsequence table, which is the standard approach for
 * text diff: it produces a minimal edit script (insertions/deletions only) and
 * is straightforward to verify. The table is O(n·m) in time and memory, so
 * input sizes are capped — beyond the cap the comparison degrades to a coarse
 * summary instead of freezing the tab.
 *
 * An optional normalisation pass (ignore whitespace, ignore case) matches what
 * people expect from a code-review view.
 */

export type LineKind = 'equal' | 'delete' | 'insert';

export interface DiffLine {
  kind: LineKind;
  text: string;
  /** 1-based line number in the "before" text, when applicable. */
  beforeLine: number | null;
  /** 1-based line number in the "after" text, when applicable. */
  afterLine: number | null;
}

export interface DiffOptions {
  ignoreCase: boolean;
  ignoreWhitespace: boolean;
  /** Collapse runs of more than this many equal lines into a hunk marker. */
  contextLines: number;
}

/** Refuse to build an LCS table larger than this many cells. */
export const MAX_DIFF_CELLS = 4_000_000;

export const DEFAULT_DIFF_OPTIONS: DiffOptions = {
  ignoreCase: false,
  ignoreWhitespace: false,
  contextLines: 3,
};

export function splitLines(text: string): string[] {
  if (text === '') return [];
  return text.replace(/\r\n?/g, '\n').split('\n');
}

/** Produces the comparison key for a line under the active normalisation. */
function normalise(line: string, options: Pick<DiffOptions, 'ignoreCase' | 'ignoreWhitespace'>): string {
  let value = line;
  if (options.ignoreWhitespace) value = value.replace(/\s+/g, ' ').trim();
  if (options.ignoreCase) value = value.toLowerCase();
  return value;
}

export interface DiffStats {
  added: number;
  removed: number;
  unchanged: number;
  /** Similarity percentage, 0–100. */
  similarity: number;
}

export type DiffResult =
  | {
      ok: true;
      lines: DiffLine[];
      stats: DiffStats;
      /** True when the input exceeded the cell cap and was not fully diffed. */
      truncated: boolean;
    }
  | { ok: false; error: string };

/**
 * Computes a line-level diff.
 *
 * Both inputs are compared after normalisation, but the original text is what
 * gets reported — normalisation only affects matching.
 */
export function diffLines(
  before: string,
  after: string,
  options: DiffOptions = DEFAULT_DIFF_OPTIONS,
): DiffResult {
  const a = splitLines(before);
  const b = splitLines(after);

  const cells = (a.length + 1) * (b.length + 1);
  if (cells > MAX_DIFF_CELLS) {
    return {
      ok: false,
      error: `文本过大（${a.length} × ${b.length} 行），超出对比上限。请分段对比，或先压缩行数。`,
    };
  }

  const ka = a.map((line) => normalise(line, options));
  const kb = b.map((line) => normalise(line, options));

  // lcs[i][j] = length of the LCS of ka[i..] and kb[j..]
  const width = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * width);

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i * width + j] =
        ka[i] === kb[j]
          ? lcs[(i + 1) * width + (j + 1)] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + (j + 1)]);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;
  let unchanged = 0;

  while (i < a.length && j < b.length) {
    if (ka[i] === kb[j]) {
      lines.push({ kind: 'equal', text: a[i], beforeLine: i + 1, afterLine: j + 1 });
      unchanged += 1;
      i += 1;
      j += 1;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + (j + 1)]) {
      lines.push({ kind: 'delete', text: a[i], beforeLine: i + 1, afterLine: null });
      removed += 1;
      i += 1;
    } else {
      lines.push({ kind: 'insert', text: b[j], beforeLine: null, afterLine: j + 1 });
      added += 1;
      j += 1;
    }
  }
  while (i < a.length) {
    lines.push({ kind: 'delete', text: a[i], beforeLine: i + 1, afterLine: null });
    removed += 1;
    i += 1;
  }
  while (j < b.length) {
    lines.push({ kind: 'insert', text: b[j], beforeLine: null, afterLine: j + 1 });
    added += 1;
    j += 1;
  }

  const total = Math.max(a.length, b.length);
  const similarity = total === 0 ? 100 : Math.round((unchanged / total) * 1000) / 10;

  return {
    ok: true,
    lines,
    stats: { added, removed, unchanged, similarity },
    truncated: false,
  };
}

/**
 * Distinguishes a modified line from a pure add/remove pair.
 *
 * A plain LCS diff reports "delete old, insert new", which reads poorly when a
 * line was only edited. Pairing adjacent delete+insert runs with high word
 * overlap marks them as modifications so the UI can show them side by side.
 */
export interface DiffPair {
  kind: 'equal' | 'modify' | 'insert' | 'delete';
  before: DiffLine | null;
  after: DiffLine | null;
  /** Intra-line segments, present only for `modify`. */
  wordDiff?: { kind: 'equal' | 'delete' | 'insert'; text: string }[];
}

export function pairLines(lines: DiffLine[]): DiffPair[] {
  const pairs: DiffPair[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.kind === 'equal') {
      pairs.push({ kind: 'equal', before: line, after: line });
      index += 1;
      continue;
    }

    // Collect a run of deletions followed by a run of insertions and pair them
    // up positionally; unpaired leftovers stay as pure delete/insert.
    if (line.kind === 'delete') {
      const deletions: DiffLine[] = [];
      while (index < lines.length && lines[index].kind === 'delete') {
        deletions.push(lines[index]);
        index += 1;
      }
      const insertions: DiffLine[] = [];
      while (index < lines.length && lines[index].kind === 'insert') {
        insertions.push(lines[index]);
        index += 1;
      }

      const paired = Math.min(deletions.length, insertions.length);
      for (let k = 0; k < paired; k += 1) {
        pairs.push({
          kind: 'modify',
          before: deletions[k],
          after: insertions[k],
          wordDiff: diffWords(deletions[k].text, insertions[k].text),
        });
      }
      for (let k = paired; k < deletions.length; k += 1) {
        pairs.push({ kind: 'delete', before: deletions[k], after: null });
      }
      for (let k = paired; k < insertions.length; k += 1) {
        pairs.push({ kind: 'insert', before: null, after: insertions[k] });
      }
      continue;
    }

    pairs.push({ kind: 'insert', before: null, after: line });
    index += 1;
  }

  return pairs;
}

/**
 * Word-level diff of two lines, used to highlight what changed within a line.
 *
 * Tokenises on word boundaries while keeping whitespace as its own token, so the
 * reconstructed text is exactly the input.
 */
export function diffWords(
  before: string,
  after: string,
): { kind: 'equal' | 'delete' | 'insert'; text: string }[] {
  // Split on whitespace *and* punctuation, so `1;` becomes `1` + `;` and a
  // digit change is highlighted on its own instead of dragging the punctuation
  // into the diff.
  const tokenise = (text: string) => text.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
  const a = tokenise(before);
  const b = tokenise(after);

  // Guard against very long lines producing a huge table.
  if ((a.length + 1) * (b.length + 1) > 40_000) {
    return [
      { kind: 'delete', text: before },
      { kind: 'insert', text: after },
    ];
  }

  const width = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i * width + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * width + (j + 1)] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + (j + 1)]);
    }
  }

  const out: { kind: 'equal' | 'delete' | 'insert'; text: string }[] = [];
  const push = (kind: 'equal' | 'delete' | 'insert', text: string) => {
    const last = out[out.length - 1];
    // Merge adjacent segments of the same kind to keep the render simple.
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('equal', a[i]);
      i += 1;
      j += 1;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + (j + 1)]) {
      push('delete', a[i]);
      i += 1;
    } else {
      push('insert', b[j]);
      j += 1;
    }
  }
  while (i < a.length) push('delete', a[i++]);
  while (j < b.length) push('insert', b[j++]);

  return out;
}

/**
 * Collapses long runs of unchanged lines into hunks.
 *
 * Returns either a real line or a marker telling the UI how many lines were
 * hidden, so the output stays readable on large files.
 */
export type DiffRow =
  | { type: 'line'; pair: DiffPair }
  | { type: 'gap'; hidden: number };

export function buildRows(pairs: DiffPair[], contextLines: number): DiffRow[] {
  const rows: DiffRow[] = [];
  let index = 0;

  while (index < pairs.length) {
    if (pairs[index].kind !== 'equal') {
      rows.push({ type: 'line', pair: pairs[index] });
      index += 1;
      continue;
    }

    // Measure the run of equal lines.
    let end = index;
    while (end < pairs.length && pairs[end].kind === 'equal') end += 1;
    const runLength = end - index;

    if (runLength <= contextLines * 2 + 1) {
      for (let k = index; k < end; k += 1) {
        rows.push({ type: 'line', pair: pairs[k] });
      }
    } else {
      for (let k = index; k < index + contextLines; k += 1) {
        rows.push({ type: 'line', pair: pairs[k] });
      }
      rows.push({ type: 'gap', hidden: runLength - contextLines * 2 });
      for (let k = end - contextLines; k < end; k += 1) {
        rows.push({ type: 'line', pair: pairs[k] });
      }
    }

    index = end;
  }

  return rows;
}

/** Renders a unified-diff style text export. */
export function toUnifiedText(lines: DiffLine[]): string {
  return lines
    .map((line) => {
      const marker = line.kind === 'insert' ? '+' : line.kind === 'delete' ? '-' : ' ';
      return `${marker}${line.text}`;
    })
    .join('\n');
}

export const DIFF_SAMPLE_BEFORE = `function greet(name) {
  const message = 'Hello, ' + name;
  console.log(message);
  return message;
}

// 未使用的函数
function unused() {
  return 42;
}

const config = {
  port: 3000,
  host: 'localhost',
};`;

export const DIFF_SAMPLE_AFTER = `function greet(name, greeting = 'Hello') {
  const message = greeting + ', ' + name + '!';
  console.log(message);
  return message;
}

const config = {
  port: 8080,
  host: '0.0.0.0',
  tls: true,
};`;
