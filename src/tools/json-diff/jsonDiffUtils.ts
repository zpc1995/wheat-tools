/**
 * Structural comparison of two JSON documents.
 *
 * This is the piece `text-diff` cannot do. A line diff of two JSON files
 * reports a whole line as changed when one digit changes, cannot tell a moved
 * array element from a rewritten one, and has no idea that reordering the keys
 * of an object means nothing. Working on the parsed structure instead yields a
 * list of key-level changes addressed by JSON Pointer, and lets arrays be
 * matched by an identity field so a reordered list produces no changes at all.
 *
 * Everything here is a pure function over plain data: no DOM, no clock, no
 * React, no I/O. The caller parses the text and supplies the options.
 *
 * ## The invariant the whole design hangs on
 *
 * For any two JSON documents `a` and `b`, `applyChanges(a, diff(a, b).changes)`
 * must be deeply equal to `b`. That single property is what makes the output
 * meaningfully correct rather than merely plausible: it forces array traversal
 * to emit the indices of the *target* document for insertions (otherwise the
 * patch lands in the wrong place), it forces moved elements to carry both their
 * old and new positions, and it forces a changed type to be recorded as a
 * modification carrying the new value. The check script round-trips hundreds of
 * randomly generated pairs through this exact pair of functions.
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** A JSON object seen through a type that allows arbitrary key access. */
export interface JsonObject {
  [key: string]: JsonValue;
}

/**
 * What happened at one pointer.
 *
 * `typeChanged` is kept separate from `modified` because a number that became a
 * string is a different kind of event: no numeric tolerance applies, and a
 * downstream consumer (a schema, a typed client) usually breaks on it while a
 * value tweak is harmless. Both are still modifications; only `added`, `removed`
 * and `moved` change the shape or the order of the document.
 *
 * `moved` exists because a reordered array element has to be recorded somewhere:
 * a change list that is silent about it cannot be applied back, and the
 * round-trip property would be lost. Recording it as one `moved` entry rather
 * than as content changes is also the honest description — the element is the
 * same value, in a different place.
 *
 * `matched` is not a difference at all. It is the position record of an element
 * that identity matching paired and found identical in every respect; it exists
 * only so the array can be rebuilt. Callers that show the changes must filter it
 * out — `changesToText` and the UI do — and that is also why it does not appear
 * in the statistics.
 */
export type ChangeKind = 'added' | 'removed' | 'modified' | 'typeChanged' | 'moved' | 'matched';

export interface JsonChange {
  /** JSON Pointer (RFC 6901) to the affected location. */
  path: string;
  /** Kind of change at `path`. */
  kind: ChangeKind;
  /** Path tokens, so callers can re-address without re-parsing the pointer. */
  tokens: string[];
  /** Value before the change, or `undefined` when the key did not exist. */
  before?: JsonValue;
  /** Value after the change, or `undefined` when the key no longer exists. */
  after?: JsonValue;
  /**
   * For an element-level record of a keyed array: where the element sat in the
   * old array. `-1` marks an element that was not there at all (an insertion).
   */
  baseIndex?: number;
  /**
   * For an element-level record of a keyed array: the slot the element occupies
   * in the new array. Absent on a removal, which has no slot to claim.
   */
  targetIndex?: number;
  /**
   * `key` on the element-level record of a keyed array, absent everywhere else.
   *
   * The distinction cannot be derived from the pointer or from `origin`: a change
   * at `/2` is an element-level record when it says "element 2 paired with element
   * 0", and a nested change when it says "the member at key 2 changed". A nested
   * change twice as deep looks identical in shape. This marker is set only by
   * keyed matching's element-level output, so `applyChanges` can tell the two
   * apart without guessing.
   */
  group?: 'key';
  /**
   * What kind of place this change sits in, which is what `applyChanges`
   * dispatches on.
   *
   * A pointer such as `/0` is syntactically identical whether it means "element 0"
   * or "the member named 0", and the two are applied completely differently:
   * removing a whole element means filtering the array, while removing a member
   * means rebuilding the object at that path. The target node's type is not
   * enough to decide — an array can hold an object that has a key `"0"` — so the
   * producer records what it meant. `keyed-element` additionally says the array
   * was matched by identity, which is what selects the rebuild path.
   */
  origin?: 'object' | 'array-element' | 'keyed-element';
}

export interface DiffStats {
  added: number;
  removed: number;
  modified: number;
  typeChanged: number;
  /** Elements matched by key whose position changed. */
  moved: number;
  /**
   * Sum of the five kinds above.
   *
   * `matched` records are excluded: they exist to rebuild the array, not to
   * report a difference, and a total that counted them would disagree with the
   * list of differences a reader sees.
   */
  total: number;
}

/** How arrays are matched when comparing them. */
export type ArrayMode = 'index' | 'key';

export interface DiffOptions {
  /** `index` pairs element 0 with element 0; `key` pairs by identity field. */
  mode: ArrayMode;
  /**
   * Field name used as the identity when `mode` is `key`, e.g. `id`.
   *
   * An array switches to keyed matching only when *every* element is an object
   * carrying this field and no two values collide. Anything else — a primitive
   * sneaked in, a missing field, a duplicate id — falls back to index matching,
   * because pairing on a non-unique key would silently compare the wrong
   * elements. The result reports which happened, so the UI can say so instead
   * of leaving the user to wonder why a reorder looked noisy.
   */
  keyField: string;
  /**
   * Absolute tolerance for numeric comparisons.
   *
   * JSON cannot distinguish `0.1 + 0.2` from `0.30000000000000004`, so two
   * documents produced by different programs routinely differ in the last bits.
   * `0` (the default) compares exactly; a positive value treats numbers within
   * that distance as equal. Non-numbers are never affected: a number and a
   * string stay different however close they look.
   */
  numberTolerance: number;
}

export interface DiffResult {
  changes: JsonChange[];
  stats: DiffStats;
  /** How many arrays were matched by key, and how many fell back to index. */
  keyedArrays: { byKey: number; byIndex: number };
}

/** Upper bound on nesting depth, applied to both sides before comparing. */
export const MAX_DEPTH = 256;

/** Upper bound on collected changes; past it the diff is refused, not truncated. */
export const MAX_CHANGES = 200_000;

/** Upper bound on JSON nodes visited, to keep a pathological input from hanging. */
export const MAX_NODES = 2_000_000;

export class JsonInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonInputError';
  }
}

export class JsonDepthError extends Error {
  constructor(depth: number) {
    super(
      `JSON 嵌套深度超过上限 ${MAX_DEPTH}（已到达第 ${depth} 层）。` +
        '过深的文档无法安全递归比较，请先拍平结构。',
    );
    this.name = 'JsonDepthError';
  }
}

export class JsonSizeError extends Error {
  constructor(nodes: number) {
    super(`JSON 节点数超过上限 ${MAX_NODES}（已数到 ${nodes} 个）。请先拆分文档再比较。`);
    this.name = 'JsonSizeError';
  }
}

export class DiffLimitError extends Error {
  constructor() {
    super(`差异数量超过上限 ${MAX_CHANGES} 条，无法一次性列出。请缩小比较范围。`);
    this.name = 'DiffLimitError';
  }
}

export class DiffApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiffApplyError';
  }
}

export const DEFAULT_DIFF_OPTIONS: DiffOptions = {
  mode: 'index',
  keyField: 'id',
  numberTolerance: 0,
};

/* ------------------------------------------------------------------ *
 * JSON Pointer, RFC 6901
 * ------------------------------------------------------------------ */

/**
 * Escapes one reference token.
 *
 * RFC 6901 §3: the escape for `~` must be written first. Doing it the other way
 * round turns a literal `~1` in a key into `/` plus a stray digit, so the order
 * is a specification requirement rather than a style choice.
 */
export function escapePointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Reverses `escapePointerToken`.
 *
 * Again order matters: `~01` must decode back to the two characters `~1`, so
 * the `~1` pass has to run before the `~0` pass. Swapping them turns `~01` into
 * `/` — a real bug that the check script pins down with the RFC's own examples.
 */
export function unescapePointerToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** Builds an RFC 6901 pointer from decoded tokens; the root is the empty string. */
export function pointerOf(tokens: string[]): string {
  if (tokens.length === 0) return '';
  return `/${tokens.map(escapePointerToken).join('/')}`;
}

/** Splits an RFC 6901 pointer back into decoded tokens. */
export function pointerTokens(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) {
    throw new JsonInputError(`JSON Pointer 必须以 / 开头或为空串：${pointer}`);
  }
  return pointer.slice(1).split('/').map(unescapePointerToken);
}

/* ------------------------------------------------------------------ *
 * Input validation
 * ------------------------------------------------------------------ */

/**
 * Whether a value is a plain JSON object.
 *
 * `typeof x === 'object'` alone would accept a `Date`, a `Map` or a class
 * instance, none of which has a JSON representation matching its in-memory
 * shape — stringifying a `Date` yields a string, so a comparison between two
 * different `Date`s would claim they are structurally equal. The prototype
 * check rejects all of those.
 */
export function isPlainObject(value: unknown): value is JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

/**
 * Whether a value is exactly representable in JSON.
 *
 * `undefined`, functions, symbols, bigints, `NaN`, the infinities and every
 * non-plain object are excluded. None of them survives `JSON.stringify`, so
 * accepting one would mean comparing documents that could not have come from a
 * JSON file in the first place.
 */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (isPlainObject(value)) return Object.values(value).every(isJsonValue);
  return false;
}

/**
 * Validates a document, its depth and its size before any comparison happens.
 *
 * This walks with an explicit work queue rather than by recursion: the case it
 * exists to catch is a 100 000-level-deep document, and a recursive validator
 * would blow the stack while trying to report that the document is too deep.
 *
 * The node budget is deliberately finite. The change list is rendered in a
 * browser tab, so "compare these two 50 MB exports" has to fail with an
 * explanation instead of freezing the page.
 */
export function assertJsonValue(value: unknown, label = '输入'): asserts value is JsonValue {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new JsonInputError(`${label}含非法数字（NaN 或 Infinity），JSON 不允许。`);
  }
  if (value === undefined) {
    throw new JsonInputError(`${label}是 undefined，JSON 里不存在这个值。`);
  }
  if (typeof value === 'bigint') {
    throw new JsonInputError(`${label}含 BigInt，JSON 无法表示。`);
  }
  if (typeof value === 'function' || typeof value === 'symbol') {
    throw new JsonInputError(`${label}含函数或 Symbol，JSON 无法表示。`);
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && !isPlainObject(value)) {
    throw new JsonInputError(`${label}含非普通对象（如 Date、Map 或类实例），JSON 无法表示。`);
  }

  const queue: { node: unknown; depth: number }[] = [{ node: value, depth: 0 }];
  let visited = 0;

  while (queue.length > 0) {
    const current = queue.pop() as { node: unknown; depth: number };
    visited += 1;
    if (visited > MAX_NODES) throw new JsonSizeError(visited);
    if (current.depth > MAX_DEPTH) throw new JsonDepthError(current.depth);

    const node = current.node;
    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index += 1) {
        // A sparse array has holes; they read as `undefined`, which JSON cannot
        // express, so they are pushed through and rejected by the number/type
        // checks on the next round instead of being skipped silently.
        queue.push({ node: node[index], depth: current.depth + 1 });
      }
    } else if (isPlainObject(node)) {
      for (const key of Object.keys(node)) queue.push({ node: node[key], depth: current.depth + 1 });
    } else if (typeof node === 'number') {
      if (!Number.isFinite(node)) {
        throw new JsonInputError(`${label}含非法数字（NaN 或 Infinity），JSON 不允许。`);
      }
    } else if (node === undefined) {
      throw new JsonInputError(`${label}是 undefined，JSON 里不存在这个值。`);
    } else if (typeof node === 'bigint') {
      throw new JsonInputError(`${label}含 BigInt，JSON 无法表示。`);
    } else if (typeof node === 'function' || typeof node === 'symbol') {
      throw new JsonInputError(`${label}含函数或 Symbol，JSON 无法表示。`);
    } else if (node !== null && typeof node !== 'boolean' && typeof node !== 'string') {
      // Anything left is an object that `isPlainObject` already refused: a Date, a
      // Map, a class instance. Saying which one it is beats "object", which would
      // send the reader looking for a nested `{}` that is not there.
      throw new JsonInputError(
        `${label}含非普通对象（如 Date、Map 或类实例），JSON 无法表示：${Object.prototype.toString.call(node)}`,
      );
    }
  }
}

/* ------------------------------------------------------------------ *
 * Canonical form and deep equality
 * ------------------------------------------------------------------ */

/**
 * Writes a value in a canonical form: object keys sorted, no insignificant
 * whitespace, `undefined` object members dropped.
 *
 * Two values are deeply equal exactly when their canonical strings match, which
 * makes `deepEqual` a one-liner and gives the check script an *independent*
 * oracle — it can compare round trips with `JSON.stringify`, with a hand-written
 * comparator and with this, and require all three to agree. Dropping
 * `undefined` members mirrors `JSON.stringify`, which omits them, so
 * `{a: 1, b: undefined}` compares equal to `{a: 1}`: that is what a JSON
 * document can actually express.
 *
 * Recursion depth is safe here because callers run `assertJsonValue` first.
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return JSON.stringify(value) as string;
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    // Array holes read as `undefined`; JSON.stringify turns them into `null`,
    // so the canonical form does the same and the two agree on sparse arrays.
    return `[${value.map((item) => (item === undefined ? 'null' : canonicalJson(item))).join(',')}]`;
  }
  const parts: string[] = [];
  for (const key of Object.keys(value).sort()) {
    const member = value[key];
    if (member === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalJson(member)}`);
  }
  return `{${parts.join(',')}}`;
}

/** Deep equality of two JSON values, key order insensitive. */
export function deepEqual(left: JsonValue, right: JsonValue): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

/**
 * Whether two values should be reported as equal under the numeric tolerance.
 *
 * The tolerance applies to numbers only, and only when both sides are numbers:
 * a `number` versus a numeric-looking `string` is a type change whatever the
 * tolerance says. That distinction is the whole reason this is not simply
 * `Math.abs(a - b) <= t`.
 */
export function valuesEqual(left: JsonValue, right: JsonValue, tolerance: number): boolean {
  if (typeof left === 'number' && typeof right === 'number') {
    if (left === right) return true;
    if (tolerance > 0 && Number.isFinite(left) && Number.isFinite(right)) {
      return Math.abs(left - right) <= tolerance;
    }
    return false;
  }
  return canonicalJson(left) === canonicalJson(right);
}

/** JSON type name as it appears in a type-change report. */
export function jsonTypeOf(value: JsonValue): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** A compact, single-line rendering of a value for the change list. */
export function abbreviate(value: JsonValue | undefined, limit = 60): string {
  if (value === undefined) return '（无）';
  const text = canonicalJson(value);
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/* ------------------------------------------------------------------ *
 * The diff itself
 * ------------------------------------------------------------------ */

interface ArrayTally {
  byKey: number;
  byIndex: number;
  /**
   * Changes produced so far.
   *
   * The cap is enforced while the list is being built rather than afterwards:
   * building an unbounded list and then rejecting it would let a pathological
   * input allocate until the tab dies, which is the failure the cap exists to
   * prevent.
   */
  collected: number;
}

/**
 * Stable string for one identity-field value.
 *
 * Built from the canonical form, so `1` and `"1"` do not collide, and prefixed
 * with the token count so that no two distinct values can flatten to the same
 * string. A missing field yields `null`, which disqualifies keyed matching for
 * the whole array rather than quietly pairing elements by `undefined`.
 */
function keyString(element: JsonObject, field: string): string | null {
  const raw = element[field];
  if (raw === undefined) return null;
  const parts = canonicalJson(raw).split('/');
  return `${parts.length}:${parts.join('/')}`;
}

/**
 * Pairs two arrays by identity field.
 *
 * Returns `null` when keyed matching is not safe — an element that is not an
 * object, a missing field, or a duplicate value — and the caller then compares
 * by index. Refusing is the important part: pairing on a non-unique key would
 * compare the wrong elements and report differences that do not exist.
 *
 * The returned list is ordered removals first, then matched elements in their
 * new order, then pure insertions at their new indices. That order is both what
 * a reader expects (deletions, then edits in document order, then additions) and
 * what `applyChanges` needs: it writes matched elements back at their old
 * indices and rebuilds the final order from `targetIndex` in one step.
 */
function diffKeyedArray(
  base: JsonValue[],
  target: JsonValue[],
  tokens: string[],
  keyField: string,
  options: DiffOptions,
  tally: ArrayTally,
  depth: number,
): JsonChange[] | null {
  const baseIndex = new Map<string, number>();
  for (let index = 0; index < base.length; index += 1) {
    const element = base[index];
    if (!isPlainObject(element)) return null;
    const key = keyString(element, keyField);
    if (key === null || baseIndex.has(key)) return null;
    baseIndex.set(key, index);
  }

  const targetIndex = new Map<string, number>();
  for (let index = 0; index < target.length; index += 1) {
    const element = target[index];
    if (!isPlainObject(element)) return null;
    const key = keyString(element, keyField);
    if (key === null || targetIndex.has(key)) return null;
    targetIndex.set(key, index);
  }

  const changes: JsonChange[] = [];

  // Removed identities, in the order they appear in the source document.
  for (let index = 0; index < base.length; index += 1) {
    const element = base[index] as JsonObject;
    const key = keyString(element, keyField) as string;
    if (!targetIndex.has(key)) {
      pushChange(changes, tally, {
        path: pointerOf([...tokens, String(index)]),
        kind: 'removed',
        tokens: [...tokens, String(index)],
        before: element,
        // Where the element sat in the old array, recorded for the same reason the
        // matched elements record their slots: rebuilding needs to know which base
        // positions are gone, not just which identities are.
        baseIndex: index,
        origin: 'keyed-element',
        group: 'key',
      });
    }
  }

  for (let index = 0; index < target.length; index += 1) {
    const element = target[index] as JsonObject;
    const key = keyString(element, keyField) as string;
    const oldIndex = baseIndex.get(key);
    if (oldIndex === undefined) {
      // A new element is addressed by where it belongs in the new array: the
      // consumer is being told how to turn the old document into the new one, so
      // the old numbering is meaningless for a value the old document never had.
      pushChange(changes, tally, {
        path: pointerOf([...tokens, String(index)]),
        kind: 'added',
        tokens: [...tokens, String(index)],
        after: element,
        // The negative base index marks "this key was not in the old document".
        // The array still needs that fact: rebuilding the order uses the complete
        // set of matches and insertions, so an element that is both new and
        // sitting in the middle cannot be inferred from the others.
        baseIndex: -1,
        targetIndex: index,
        origin: 'keyed-element',
        group: 'key',
      });
      continue;
    }

    // Matched elements are always addressed by their *old* index: the value
    // being replaced still lives there, and `applyChanges` writes it back before
    // the reorder step moves it into place.
    const childTokens = [...tokens, String(oldIndex)];
    const childChanges = walk(base[oldIndex], target[index], childTokens, depth + 1, options, tally);
    const moved = oldIndex !== index;

    // Exactly one position record per matched element, in every case. This is not
    // an optimisation decision — `applyChanges` rebuilds the array from these
    // records, so an element missing from the set leaves its slot to be guessed,
    // and there is no correct guess. The record takes whichever form describes the
    // element:
    //
    //  - it changed content and stayed put: its own member/scalar changes;
    //  - it moved, with or without content changes: one `moved` entry, because a
    //    reorder is one event and reporting it as edits to every key the element
    //    "used to" have is exactly the false-positive noise identity matching
    //    exists to remove;
    //  - nothing about it differs: a record that only carries the two slots, which
    //    is invisible in the diff list (it is not a difference) but tells the
    //    rebuild where the element belongs.
    if (moved) {
      pushChange(changes, tally, {
        path: pointerOf(childTokens),
        kind: 'moved',
        tokens: childTokens,
        before: base[oldIndex],
        after: element,
        baseIndex: oldIndex,
        targetIndex: index,
        origin: 'keyed-element',
        group: 'key',
      });
      // The element moved *and* changed content. Both facts have to be recorded:
      // the position record places it, and the member changes say what it now
      // contains. They share a pointer, which is why the rebuild must not treat a
      // position record as a whole-element replacement — it would overwrite the
      // edits with the un-edited copy. The member changes deliberately carry no
      // positions of their own: an inherited pair would look like a second
      // decision about the array, and a nested array inside the element would then
      // be rebuilt with its parent's slots.
      for (const child of childChanges) pushChange(changes, tally, child);
    } else {
      // The element stayed in its slot, whether or not its content changed. Its
      // element-level record is the same in both cases, and the content changes
      // are pushed on top of it. One record per element is what lets the rebuild
      // read the array's shape from the records alone: a member change is not a
      // statement about where the array starts and ends.
      pushChange(changes, tally, {
        path: pointerOf(childTokens),
        kind: 'matched',
        tokens: childTokens,
        before: element,
        after: element,
        baseIndex: oldIndex,
        targetIndex: index,
        origin: 'keyed-element',
        group: 'key',
      });
      // Member changes stay exactly as the recursive comparison produced them:
      // `origin` says they are a member change or a scalar rewrite, and they carry
      // no array positions. Overwriting either was a real bug — an inherited
      // `origin` made a nested edit look like an element-level record, so applying
      // the change list spliced an array where it should have rebuilt an object,
      // and an inherited position pair made a nested array rebuild itself with its
      // parent's slots.
      for (const child of childChanges) pushChange(changes, tally, child);
    }
  }

  tally.byKey += 1;
  return changes;
}

/** Appends one change, refusing the comparison once the cap is reached. */
function pushChange(changes: JsonChange[], tally: ArrayTally, change: JsonChange): void {
  tally.collected += 1;
  if (tally.collected > MAX_CHANGES) throw new DiffLimitError();
  changes.push(change);
}

function diffArray(
  base: JsonValue[],
  target: JsonValue[],
  tokens: string[],
  depth: number,
  options: DiffOptions,
  tally: ArrayTally,
): JsonChange[] {
  if (options.mode === 'key') {
    const keyed = diffKeyedArray(base, target, tokens, options.keyField, options, tally, depth);
    if (keyed) return keyed;
  }
  tally.byIndex += 1;

  const changes: JsonChange[] = [];
  const shared = Math.min(base.length, target.length);
  for (let index = 0; index < shared; index += 1) {
    // Splicing in place keeps the per-element cost constant; the list can reach
    // the change limit, and copying the accumulated array once per element would
    // make a wide array quadratic.
    for (const child of walk(base[index], target[index], [...tokens, String(index)], depth + 1, options, tally)) {
      pushChange(changes, tally, child);
    }
  }
  for (let index = shared; index < base.length; index += 1) {
    pushChange(changes, tally, {
      path: pointerOf([...tokens, String(index)]),
      kind: 'removed',
      tokens: [...tokens, String(index)],
      before: base[index],
      origin: 'array-element',
    });
  }
  for (let index = shared; index < target.length; index += 1) {
    pushChange(changes, tally, {
      path: pointerOf([...tokens, String(index)]),
      kind: 'added',
      tokens: [...tokens, String(index)],
      after: target[index],
      origin: 'array-element',
    });
  }
  return changes;
}

function diffObject(
  base: JsonObject,
  target: JsonObject,
  tokens: string[],
  depth: number,
  options: DiffOptions,
  tally: ArrayTally,
): JsonChange[] {
  // Sorted, so the change list does not depend on the order the keys happened to
  // appear in either document. Two objects that differ only in key order are the
  // same object, and the output has to say so.
  const keys = [...new Set([...Object.keys(base), ...Object.keys(target)])].sort();
  const changes: JsonChange[] = [];

  for (const key of keys) {
    const before = base[key];
    const after = target[key];
    if (before === undefined && after === undefined) continue;

    // A member present on one side only is not a "modification from undefined":
    // the key genuinely does not exist there. One-sided presence is checked
    // before the type comparison, because otherwise every addition would be a
    // change of type from "undefined" and `applyChanges` could not tell an
    // added member from a replaced one.
    if (before === undefined) {
      pushChange(changes, tally, {
        path: pointerOf([...tokens, key]),
        kind: 'added',
        tokens: [...tokens, key],
        after,
        origin: 'object',
      });
      continue;
    }
    if (after === undefined) {
      pushChange(changes, tally, {
        path: pointerOf([...tokens, key]),
        kind: 'removed',
        tokens: [...tokens, key],
        before,
        origin: 'object',
      });
      continue;
    }

    for (const child of walk(before, after, [...tokens, key], depth + 1, options, tally)) {
      pushChange(changes, tally, child);
    }
  }

  return changes;
}

/**
 * Compares two values and returns the differences below `tokens`.
 *
 * Returning a list rather than pushing into a shared collector is what makes the
 * keyed-array path work: a matched element's subtree has to be inspected on its
 * own, its changes tagged with the element's old and new positions, and then
 * spliced into the array's list. A shared collector cannot express that.
 */
function walk(
  base: JsonValue,
  target: JsonValue,
  tokens: string[],
  depth: number,
  options: DiffOptions,
  tally: ArrayTally,
): JsonChange[] {
  if (depth > MAX_DEPTH) throw new JsonDepthError(depth);

  // Reference equality first: identical primitives (and the same object) are the
  // overwhelmingly common case, and answering immediately costs nothing.
  if (base === target) return [];

  if (isPlainObject(base) && isPlainObject(target)) {
    return diffObject(base, target, tokens, depth, options, tally);
  }

  if (Array.isArray(base) && Array.isArray(target)) {
    return diffArray(base, target, tokens, depth, options, tally);
  }

  if (valuesEqual(base, target, options.numberTolerance)) return [];

  const beforeType = jsonTypeOf(base);
  const afterType = jsonTypeOf(target);
  const changes: JsonChange[] = [];
  pushChange(changes, tally, {
    path: pointerOf(tokens),
    kind: beforeType === afterType ? 'modified' : 'typeChanged',
    tokens,
    before: base,
    after: target,
    // The position in the tree decides nothing here; what matters is that this is
    // a member-or-element replacement rather than a whole-element removal, so
    // `applyChanges` writes the value in place instead of splicing.
    origin: 'object',
  });
  return changes;
}

/**
 * Counts changes by kind.
 *
 * `matched` records are excluded from every count including the total: they are
 * bookkeeping for the array rebuild, not differences, and a total that included
 * them would disagree with the list of differences the user sees.
 */
export function summarise(changes: JsonChange[]): DiffStats {
  const stats: DiffStats = {
    added: 0,
    removed: 0,
    modified: 0,
    typeChanged: 0,
    moved: 0,
    total: 0,
  };
  for (const change of changes) {
    if (change.kind === 'added') stats.added += 1;
    else if (change.kind === 'removed') stats.removed += 1;
    else if (change.kind === 'typeChanged') stats.typeChanged += 1;
    else if (change.kind === 'moved') stats.moved += 1;
    else if (change.kind === 'modified') stats.modified += 1;
    else continue;
    stats.total += 1;
  }
  return stats;
}

/**
 * Whether anything other than ordering changed.
 *
 * A document whose elements were merely reordered is "different" and has to be
 * reported as such, but the answer a reader wants first is whether any content
 * actually differs. This keeps those two questions apart.
 */
export function hasContentChanges(changes: JsonChange[]): boolean {
  return changes.some((change) => change.kind !== 'moved' && change.kind !== 'matched');
}

/** The changes worth showing: everything except pure bookkeeping. */
export function visibleChanges(changes: JsonChange[]): JsonChange[] {
  return changes.filter((change) => change.kind !== 'matched');
}

/**
 * Compares two JSON documents.
 *
 * Throws `JsonInputError`, `JsonDepthError`, `JsonSizeError` or `DiffLimitError`
 * for input this tool refuses to handle, so the caller can show the reason
 * instead of a wrong answer.
 */
export function diff(base: unknown, target: unknown, options: Partial<DiffOptions> = {}): DiffResult {
  const resolved: DiffOptions = { ...DEFAULT_DIFF_OPTIONS, ...options };
  assertJsonValue(base, '左侧 JSON');
  assertJsonValue(target, '右侧 JSON');

  const tally: ArrayTally = { byKey: 0, byIndex: 0, collected: 0 };
  const changes = walk(base, target, [], 0, resolved, tally);

  return {
    changes,
    stats: summarise(changes),
    keyedArrays: { byKey: tally.byKey, byIndex: tally.byIndex },
  };
}

/* ------------------------------------------------------------------ *
 * Applying the changes back
 * ------------------------------------------------------------------ */

function childPath(path: string, token: string): string {
  return `${path}/${escapePointerToken(token)}`;
}

/**
 * Applies a change list to the document it was computed from.
 *
 * This is the inverse of `diff` and the basis of the round-trip property. It is
 * also a user-facing feature: it is what proves a reported change list really
 * reconstructs the other document rather than merely approximating it.
 *
 * The change list is read as a description of the target document, not as a
 * sequence of edits to run in order. That distinction matters most for arrays:
 * a reordered element is recorded as "this identity moved from slot 2 to slot
 * 0", and replaying that as a splice would mean re-deriving every index that
 * shifted. Instead the array is rebuilt outright: each element-level record names
 * the slot its element belongs in, insertions name theirs, and an element whose
 * slot is unchanged keeps its place among them. There are no ordering rules to
 * get wrong, and the rebuild is complete — every element of the new array is
 * accounted for by exactly one record.
 *
 * Consequently the base document is only ever read at the indices the diff
 * recorded against it, and the result is a fresh value. The caller's documents
 * are never touched.
 */
export function applyChanges(root: JsonValue, changes: JsonChange[]): JsonValue {
  const writes = new Map<string, JsonChange[]>();
  /** Removals and insertions of whole array elements, grouped by array path. */
  const splices = new Map<string, { removals: JsonChange[]; insertions: JsonChange[] }>();
  /** Position records of matched array elements, grouped by array path. */
  const positions = new Map<string, JsonChange[]>();
  /** Array paths whose elements were matched by identity rather than by index. */
  const keyedPaths = new Set<string>();

  for (const change of changes) {
    const isElementRecord = change.origin === 'array-element' || change.group === 'key';

    // A whole element leaving or joining an array. The pointer cannot say
    // whether "/0" is an element or a member named "0" — that is what `origin`
    // is for — and only the element case is applied by splicing.
    if (isElementRecord && change.tokens.length > 0 && (change.kind === 'removed' || change.kind === 'added')) {
      const parent = pointerOf(change.tokens.slice(0, -1));
      const entry = splices.get(parent) ?? { removals: [], insertions: [] };
      if (change.kind === 'removed') entry.removals.push(change);
      else entry.insertions.push(change);
      splices.set(parent, entry);
    }

    // The write table holds exactly "a value that replaces whatever is at this
    // pointer". Element-level records of a keyed array are excluded: a removal
    // there is applied by dropping the element, and a match is applied by
    // recursing into the base document at `baseIndex`, so writing the record as
    // well would either delete a member or overwrite the element with its
    // un-edited copy. Everything else — a changed member, a retyped scalar, an
    // element appended to an index-matched array — is a write at its own pointer.
    if (change.group !== 'key' && change.kind !== 'moved' && change.kind !== 'matched') {
      const path = pointerOf(change.tokens);
      const list = writes.get(path);
      if (list) list.push(change);
      else writes.set(path, [change]);
    }

    // Position records describe the shape of a keyed array: one per element of
    // the old array, whether it survived, moved, or was dropped. Both positions
    // are set only by identity matching, so an index-mode array never reaches
    // here and is never rebuilt by identity — doing so would drop the elements
    // index pairing cannot account for.
    if (change.group === 'key' && change.tokens.length > 0) {
      const arrayPath = pointerOf(change.tokens.slice(0, -1));
      const list2 = positions.get(arrayPath);
      if (list2) list2.push(change);
      else positions.set(arrayPath, [change]);
      keyedPaths.add(arrayPath);
    }
  }

  for (const entry of splices.values()) {
    // Higher indices first for removals, so each one removes the slot it was
    // reported for. Insertions are placed by position, so their order in the
    // list does not matter and they are left as emitted.
    entry.removals.sort(
      (left, right) => Number(right.tokens[right.tokens.length - 1]) - Number(left.tokens[left.tokens.length - 1]),
    );
  }

  /**
   * Whether the change list writes anything at this pointer.
   *
   * "No write" and "a write whose value is undefined" have to be told apart, and
   * a change record alone cannot do it: a removal legitimately has no `after`
   * value. Reading that as "no change" would leave the member in place, while
   * treating every write as a replacement would insert `undefined`. Hence two
   * questions, asked separately.
   */
  function hasWrite(path: string): boolean {
    const list = writes.get(path);
    return list !== undefined && list.length > 0;
  }

  /** The value the change list writes at one pointer. */
  function writeValue(path: string): JsonValue | undefined {
    const list = writes.get(path);
    if (!list || list.length === 0) return undefined;
    // Replacing a scalar with a container is the normal shape of a type change,
    // and applying in order means the last one wins. A removal has no `after`
    // value; its effect is the absence of the member, produced by the rebuild.
    return list[list.length - 1].after as JsonValue;
  }

  /** The distinct child tokens of every change that is *strictly* below `path`. */
  function childrenOf(path: string, depth: number): Set<string> {
    const tokens = new Set<string>();
    for (const change of changes) {
      if (change.tokens.length <= depth) continue;
      if (pointerOf(change.tokens.slice(0, depth)) !== path) continue;
      tokens.add(change.tokens[depth]);
    }
    return tokens;
  }

  function applyAt(baseNode: JsonValue, path: string, depth: number): JsonValue {
    if (depth > MAX_DEPTH + 1) throw new DiffApplyError('应用差异时超出嵌套深度上限，差异列表可能已被篡改。');

    // A whole-node replacement changes what the children are applied to. A change
    // list produced by this module never has both at one path; if a hand-edited
    // one does, the replacement wins and the children are dropped.
    const written = hasWrite(path);
    const replaced = written ? writeValue(path) : undefined;

    // Identity matching wins over everything: a keyed array is rebuilt from its
    // position records, and its element subtrees are completed from the base
    // document. Its own slot records are not writes, so `hasWrite` is false here
    // unless a hand-edited list replaced the array outright.
    // A keyed array is rebuilt from its position records even when it has none
    // yet: an array that was empty and received an insertion has no records at
    // all, and reading that as "nothing to do" would drop the insertion.
    if (Array.isArray(baseNode) && keyedPaths.has(path)) {
      return written ? (replaced as JsonValue) : buildKeyedArray(baseNode, path, depth);
    }

    // An array can need work with no child changes at all: removing every element,
    // or inserting into an empty one, produces splices and nothing else. The
    // "nothing below this pointer" shortcut must therefore not swallow those.
    const spliceEntry = splices.get(path);
    const hasSplices =
      (spliceEntry?.removals.length ?? 0) > 0 || (spliceEntry?.insertions.length ?? 0) > 0;

    const baseChildren = childrenOf(path, depth);
    if (baseChildren.size === 0 && !(Array.isArray(baseNode) && hasSplices)) {
      return written ? (replaced as JsonValue) : baseNode;
    }

    if (isPlainObject(baseNode)) {
      // Rebuilt rather than spread: a member the diff reports as removed is still
      // present in the base document, so copying it would carry it along. A member
      // the rebuild left without a value is one the change list removed, and it
      // must stay absent rather than being restored from the base below.
      const rebuilt: JsonObject = {};
      for (const token of baseChildren) {
        const value = applyAt(baseNode[token], childPath(path, token), depth + 1);
        if (value !== undefined) rebuilt[token] = value;
      }
      // Members the change list never mentions are unchanged. Index pairing can
      // pair two unrelated objects, though, and then a key it reports as added is
      // not in the base at all while the key it reports as removed *is* — so a
      // base key that the rebuild dropped must not come back from here.
      const mentioned = new Set<string>();
      for (const change of changes) {
        if (change.tokens.length > depth && pointerOf(change.tokens.slice(0, depth)) === path) {
          mentioned.add(change.tokens[depth]);
        }
      }
      for (const token of Object.keys(baseNode)) {
        if (!(token in rebuilt) && !mentioned.has(token)) rebuilt[token] = baseNode[token];
      }
      return written ? (replaced as JsonValue) : rebuilt;
    }

    if (Array.isArray(baseNode)) {
      const removals = spliceEntry?.removals ?? [];
      const insertions = spliceEntry?.insertions ?? [];
      const removedBaseIndices = new Set(removals.map((change) => Number(parentToken(change))));

      // Every index has to be checked explicitly. Rebuilding by filtering would
      // happily ignore a removal that names a slot past the end — the count would
      // come out wrong, but nothing would say so, and a wrong array that looks
      // plausible is the worst outcome for a tool whose whole point is being
      // trustworthy about what changed.
      const total = baseNode.length - removedBaseIndices.size + insertions.length;
      for (const change of removals) {
        const index = Number(parentToken(change));
        if (!Number.isInteger(index) || index < 0 || index >= baseNode.length) {
          throw new DiffApplyError('删除操作的数组下标超出范围，差异列表与文档不匹配。');
        }
      }
      for (const change of insertions) {
        const index = Number(parentToken(change));
        if (!Number.isInteger(index) || index < 0 || index > total) {
          throw new DiffApplyError('新增操作的数组下标超出范围，差异列表与文档不匹配。');
        }
      }
      if (removedBaseIndices.size !== removals.length) {
        throw new DiffApplyError('删除操作的下标重复，差异列表与文档不匹配。');
      }
      const insertedSlots = new Set(insertions.map((change) => pointerOf(change.tokens)));
      const editsAt = new Map<string, JsonValue>();

      // Changes inside surviving elements are collected first. They are addressed
      // by their index in the *base* array, which is still valid here: nothing has
      // been spliced yet. Edits that fall inside a removed element are dropped,
      // because that element is not part of the finished array.
      for (const token of baseChildren) {
        const index = Number(token);
        if (Number.isInteger(index) && removedBaseIndices.has(index)) continue;
        // An inserted element is already complete in its change record; it has no
        // base slot to recurse into, and its pointer sits at an index the base
        // array does not reach.
        if (insertedSlots.has(childPath(path, token))) continue;
        if (!(token in editsAt)) {
          if (!Number.isInteger(index) || index < 0 || index >= baseNode.length) {
            throw new DiffApplyError('差异列表引用了不存在的数组下标，无法应用。');
          }
          editsAt.set(token, applyAt(baseNode[index], childPath(path, token), depth + 1));
        }
      }

      const rebuilt: JsonValue[] = [];
      for (let index = 0; index < baseNode.length; index += 1) {
        if (removedBaseIndices.has(index)) continue;
        const token = String(index);
        rebuilt.push(editsAt.has(token) ? (editsAt.get(token) as JsonValue) : baseNode[index]);
      }
      for (const change of insertions) {
        const index = Number(parentToken(change));
        if (!Number.isInteger(index) || index < 0 || index > rebuilt.length) {
          throw new DiffApplyError('新增操作的数组下标超出范围，差异列表与文档不匹配。');
        }
        rebuilt.splice(index, 0, change.after as JsonValue);
      }
      return written ? (replaced as JsonValue) : rebuilt;
    }

    // Children remain but the node is neither an object nor an array: the change
    // list pointed inside a scalar, so it was not produced from this document.
    throw new DiffApplyError('差异列表指向了标量节点的内部，差异列表与文档不匹配。');
  }

  /**
   * Rebuilds one keyed array from its position records.
   *
   * Every element of the old array is either a survivor (a record with a base
   * index) or a removal, and every element of the new array is either a survivor
   * or an insertion. Checking those two statements is what turns a corrupt or
   * mismatched change list into an error instead of a plausible-looking array
   * with elements silently missing.
   */
  function buildKeyedArray(baseNode: JsonValue[], path: string, depth: number): JsonValue[] {
    const records = positions.get(path) ?? [];
    const spliceEntry = splices.get(path);
    const removals = spliceEntry?.removals ?? [];
    const insertions = spliceEntry?.insertions ?? [];
    const removedBaseIndices = new Set(removals.map((change) => Number(parentToken(change))));

    // One element-level record per matched element is the contract the diff
    // maintains, so the records alone describe the array: each says which base
    // index it came from and which slot it belongs in. Member changes inside an
    // element repeat those positions, so they are collected separately and only
    // consulted when an element has no element-level record of its own.
    const elementRecords = new Map<number, JsonChange>();
    const memberRecords: JsonChange[] = [];
    for (const change of records) {
      if (change.kind === 'added') continue;
      // A record for an element that was dropped has no target slot: it is here to
      // say what left the array, not where anything goes. It has to be recognised
      // by the missing slot rather than by `kind`, because a member change inside a
      // removed element looks the same, and because a record for the *last* element
      // being removed still has a base index that is now past the end of the array.
      const slot = change.targetIndex as number;
      if (change.group === 'key' && slot !== undefined) {
        if (elementRecords.has(slot)) {
          throw new DiffApplyError('按键配对的数组顺序信息有冲突，差异列表与文档不匹配。');
        }
        elementRecords.set(slot, change);
      } else {
        memberRecords.push(change);
      }
    }

    const slots = new Map<number, JsonValue>();
    const decided = new Set<number>();
    const survivors: number[] = [];
    const untouchedSlots: number[] = [];

    for (const [slot, change] of elementRecords) {
      const baseIndex = change.baseIndex as number;
      // A record for an element that is gone says nothing about the new array; it
      // is here only because it was a matched element once. Checking this before
      // the base-index bounds is what keeps removing the last element from looking
      // like a reference past the end of an empty array.
      if (removedBaseIndices.has(baseIndex)) continue;
      if (!Number.isInteger(baseIndex) || baseIndex < 0 || baseIndex >= baseNode.length) {
        throw new DiffApplyError('差异列表引用了不存在的数组下标，无法应用。');
      }
      survivors.push(baseIndex);
      if (baseIndex !== slot) {
        if (slots.has(slot)) throw new DiffApplyError('按键配对的数组顺序信息不完整，差异列表与文档不匹配。');
        decided.add(baseIndex);
        slots.set(slot, completeElement(baseIndex));
        continue;
      }
      untouchedSlots.push(slot);
    }

    // Member changes can vouch for an element whose element-level record is not in
    // the list, but they never contradict one: an element that moved has a `moved`
    // record saying so.
    for (const change of memberRecords) {
      const baseIndex = change.baseIndex as number;
      const slot = change.targetIndex as number;
      if (removedBaseIndices.has(baseIndex) || baseIndex === slot || decided.has(baseIndex)) continue;
      completionsOf(slot, baseIndex);
    }

    function completionsOf(slot: number, baseIndex: number): void {
      if (slots.has(slot)) throw new DiffApplyError('按键配对的数组顺序信息不完整，差异列表与文档不匹配。');
      if (decided.has(baseIndex)) return;
      decided.add(baseIndex);
      slots.set(slot, completeElement(baseIndex));
    }

    // The finished length: the elements of the old array that survive, plus the new
    // ones. Counting it from the document rather than from the number of records is
    // deliberate — a removed element still has a record (it was matched once), and
    // counting that would leave the last slot to be filled by nothing.
    const total = baseNode.length - removedBaseIndices.size + insertions.length;

    // Insertions claim their slots first, so the fill below can see every slot that
    // is genuinely free. Doing it the other way round would make an insertion look
    // like a gap and pull an untouched element into a slot the new element owns.
    for (const change of insertions) {
      const slot = change.targetIndex as number;
      if (!Number.isInteger(slot) || slot < 0 || slot >= total || slots.has(slot)) {
        throw new DiffApplyError('按键配对的数组顺序信息不完整，差异列表与文档不匹配。');
      }
      slots.set(slot, change.after as JsonValue);
    }

    // Every surviving element is either decided (it has a slot of its own) or
    // untouched. The untouched ones fill the slots that are left, in base order —
    // the order the diff compared them in, and therefore the order they keep.
    let next = 0;
    for (let slot = 0; slot < total; slot += 1) {
      if (slots.has(slot)) continue;
      let baseIndex: number | undefined;
      while (next < untouchedSlots.length) {
        const candidate = untouchedSlots[next];
        next += 1;
        if (decided.has(candidate)) continue;
        baseIndex = candidate;
        break;
      }
      if (baseIndex === undefined) throw new DiffApplyError('按键配对的数组顺序信息不完整，差异列表与文档不匹配。');
      slots.set(slot, completeElement(baseIndex));
    }

    // Every element of the old array is either removed or matched; anything else
    // means the change list and the document disagree about the old array.
    if (survivors.length + removedBaseIndices.size !== baseNode.length) {
      throw new DiffApplyError('按键配对的数组顺序信息不完整，差异列表与文档不匹配。');
    }

    const rebuilt: JsonValue[] = [];
    for (let slot = 0; slot < total; slot += 1) {
      if (!slots.has(slot)) throw new DiffApplyError('按键配对的数组顺序信息不完整，差异列表与文档不匹配。');
      rebuilt.push(slots.get(slot) as JsonValue);
    }
    return rebuilt;

    /**
     * Completes one element from the base document.
     *
     * Always recursed at the element's *base* index, including for an element that
     * moved: its content changes are addressed there. The slot is the caller's
     * business.
     */
    function completeElement(baseIndex: number): JsonValue {
      if (!Number.isInteger(baseIndex) || baseIndex < 0 || baseIndex >= baseNode.length) {
        throw new DiffApplyError('差异列表引用了不存在的数组下标，无法应用。');
      }
      return applyAt(baseNode[baseIndex], childPath(path, String(baseIndex)), depth + 1);
    }
  }

  const parentToken = (change: JsonChange) => change.tokens[change.tokens.length - 1];

  return applyAt(root, '', 0);
}

/* ------------------------------------------------------------------ *
 * Presentation helpers
 * ------------------------------------------------------------------ */

const KIND_LABEL: Record<ChangeKind, string> = {
  added: '新增',
  removed: '删除',
  modified: '修改',
  typeChanged: '类型变化',
  moved: '位置移动',
  matched: '未变化',
};

export function changeKindLabel(kind: ChangeKind): string {
  return KIND_LABEL[kind];
}

/** One change as a human-readable line, in the style of a unified diff. */
export function formatChange(change: JsonChange): string {
  const pointer = change.path === '' ? '/' : change.path;
  if (change.kind === 'added') return `+ ${pointer}  ${abbreviate(change.after)}`;
  if (change.kind === 'removed') return `- ${pointer}  ${abbreviate(change.before)}`;
  if (change.kind === 'moved') {
    return `> ${pointer} → 第 ${change.targetIndex} 项  ${abbreviate(change.after)}`;
  }
  if (change.kind === 'typeChanged') {
    return `~ ${pointer}  ${jsonTypeOf(change.before as JsonValue)} → ${jsonTypeOf(
      change.after as JsonValue,
    )}  ${abbreviate(change.before)} → ${abbreviate(change.after)}`;
  }
  return `~ ${pointer}  ${abbreviate(change.before)} → ${abbreviate(change.after)}`;
}

/** The whole change list as plain text, for the clipboard. */
export function changesToText(changes: JsonChange[]): string {
  const visible = visibleChanges(changes);
  if (visible.length === 0) return '两份 JSON 结构相同，没有差异。';
  return visible.map(formatChange).join('\n');
}

/** The whole change list as JSON, for pasting into a script or a report. */
export function changesToJson(changes: JsonChange[]): string {
  return JSON.stringify(
    visibleChanges(changes).map((change) => ({
      path: change.path,
      kind: change.kind,
      ...(change.kind === 'added' ? {} : { before: change.before ?? null }),
      ...(change.kind === 'removed' ? {} : { after: change.after ?? null }),
      ...(change.baseIndex !== undefined ? { baseIndex: change.baseIndex, targetIndex: change.targetIndex } : {}),
    })),
    null,
    2,
  );
}

/** Parses user input, turning a syntax error into a message worth showing. */
export function parseJsonInput(text: string, label: string): JsonValue {
  const trimmed = text.trim();
  if (trimmed === '') throw new JsonInputError(`${label}为空。`);
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch (error) {
    throw new JsonInputError(`${label}不是合法 JSON：${(error as Error).message}`);
  }
  assertJsonValue(value, label);
  return value;
}
