/**
 * Password and passphrase generation.
 *
 * Two correctness points that most implementations get wrong:
 *
 * 1. **Randomness source.** `crypto.getRandomValues` is used, never
 *    `Math.random`, which is a predictable PRNG and unsuitable for secrets.
 * 2. **Modulo bias.** Taking `random % poolSize` skews the distribution unless
 *    the value range is a multiple of the pool size. Values in the incomplete
 *    tail are rejected and redrawn instead (rejection sampling), which keeps the
 *    output uniform.
 *
 * Strength is reported as entropy in bits — `length × log2(poolSize)` — rather
 * than an invented "score", because that is the quantity that actually bounds
 * brute-force cost.
 */

export const CHAR_SETS = {
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?/',
} as const;

/** Characters that are easy to confuse when read aloud or transcribed. */
export const AMBIGUOUS = 'Il1O0oB8S5Z2G6';

export type CharSetKey = keyof typeof CHAR_SETS;

export interface PasswordOptions {
  length: number;
  sets: CharSetKey[];
  /** Remove visually ambiguous characters (0/O, 1/l/I, …). */
  excludeAmbiguous: boolean;
  /** Guarantee at least one character from every selected set. */
  requireEachSet: boolean;
}

export const DEFAULT_PASSWORD_OPTIONS: PasswordOptions = {
  length: 20,
  sets: ['lowercase', 'uppercase', 'digits', 'symbols'],
  excludeAmbiguous: false,
  requireEachSet: true,
};

/** Draws `count` uniform integers in [0, max) using rejection sampling. */
function randomInts(count: number, max: number): number[] {
  if (max <= 0) throw new Error('取值范围必须为正');

  const out: number[] = [];
  // Largest multiple of `max` that fits in 32 bits; anything at or above it
  // would bias the modulo towards low values.
  const limit = Math.floor(0x1_0000_0000 / max) * max;

  while (out.length < count) {
    const buffer = new Uint32Array(Math.max(count - out.length, 8) * 2);
    crypto.getRandomValues(buffer);
    for (const value of buffer) {
      if (value < limit) {
        out.push(value % max);
        if (out.length === count) break;
      }
    }
  }
  return out;
}

/** Builds the effective character pool for the given options. */
export function buildPool(options: Pick<PasswordOptions, 'sets' | 'excludeAmbiguous'>): {
  pool: string;
  perSet: Record<string, string>;
} {
  const perSet: Record<string, string> = {};
  let combined = '';

  for (const key of options.sets) {
    // Annotated: `CHAR_SETS` is `as const`, so inference would pin this to a
    // literal union and reject the filtered (plain string) result below.
    let characters: string = CHAR_SETS[key];
    if (options.excludeAmbiguous) {
      characters = [...characters]
        .filter((char) => !AMBIGUOUS.includes(char))
        .join('');
    }
    if (characters.length === 0) continue;
    perSet[key] = characters;
    combined += characters;
  }

  // Deduplicate: sets can overlap, and duplicates would silently skew the
  // distribution towards the repeated characters.
  return { pool: [...new Set(combined)].join(''), perSet };
}

export type GenerateResult =
  | { ok: true; value: string; entropyBits: number; poolSize: number }
  | { ok: false; error: string };

export function generatePassword(options: PasswordOptions): GenerateResult {
  if (!Number.isFinite(options.length) || options.length < 1) {
    return { ok: false, error: '长度至少为 1' };
  }
  if (options.length > 512) {
    return { ok: false, error: '长度上限为 512（再长也没有实际意义）' };
  }

  const { pool, perSet } = buildPool(options);
  const setKeys = Object.keys(perSet);

  if (pool.length === 0) {
    return { ok: false, error: '请至少选择一种字符类型' };
  }
  if (options.requireEachSet && setKeys.length > options.length) {
    return {
      ok: false,
      error: `长度 ${options.length} 不足以包含所选的 ${setKeys.length} 种字符类型`,
    };
  }

  const indices = randomInts(options.length, pool.length);
  const chars = indices.map((index) => pool[index]);

  if (options.requireEachSet) {
    // Overwrite random positions with one character from each required set, so
    // the guarantee does not come at the cost of a fixed prefix/suffix pattern.
    const positions = randomInts(setKeys.length, options.length);
    const seen = new Set<number>();

    setKeys.forEach((key, order) => {
      // Ensure distinct positions; a collision would drop a set's guarantee.
      let position = positions[order];
      let guard = 0;
      while (seen.has(position) && guard < options.length * 2) {
        position = randomInts(1, options.length)[0];
        guard += 1;
      }
      seen.add(position);

      const characters = perSet[key];
      const pick = characters[randomInts(1, characters.length)[0]];
      chars[position] = pick;
    });
  }

  const value = chars.join('');
  const entropyBits = Math.round(options.length * Math.log2(pool.length));

  return { ok: true, value, entropyBits, poolSize: pool.length };
}

/** Curated word list: short, easy to type, no homophones. */
const WORDS = [
  'apple', 'anchor', 'arrow', 'atlas', 'bamboo', 'beacon', 'bishop', 'bison',
  'bronze', 'cactus', 'candle', 'canyon', 'carbon', 'cedar', 'cello', 'cherry',
  'cobalt', 'comet', 'copper', 'coral', 'cosmos', 'cotton', 'crater', 'delta',
  'dolphin', 'domino', 'dragon', 'ember', 'falcon', 'fennel', 'fjord', 'flint',
  'forest', 'fossil', 'galaxy', 'garnet', 'ginger', 'glacier', 'granite', 'harbor',
  'hazel', 'helix', 'heron', 'hickory', 'indigo', 'ivory', 'jaguar', 'jasmine',
  'juniper', 'kelp', 'kestrel', 'lantern', 'larch', 'lemon', 'lichen', 'lilac',
  'lotus', 'lunar', 'magnet', 'mango', 'maple', 'marble', 'meadow', 'mesa',
  'meteor', 'mimosa', 'mint', 'nectar', 'nickel', 'nimbus', 'nutmeg', 'oasis',
  'obsidian', 'olive', 'onyx', 'orchid', 'otter', 'oxide', 'panda', 'papaya',
  'pebble', 'pepper', 'petal', 'pigeon', 'pine', 'pixel', 'plasma', 'plum',
  'pollen', 'poppy', 'prairie', 'pumice', 'quartz', 'quill', 'raven', 'reef',
  'rhubarb', 'ridge', 'rivet', 'robin', 'saffron', 'sage', 'salmon', 'satin',
  'sequoia', 'shadow', 'silk', 'silver', 'sorrel', 'spruce', 'stellar', 'sumac',
  'sundial', 'syrup', 'tangelo', 'tapestry', 'teak', 'thistle', 'timber', 'topaz',
  'tulip', 'tundra', 'turmeric', 'velvet', 'violet', 'walnut', 'willow', 'yarrow',
  'zephyr', 'zinc',
];

export interface PassphraseOptions {
  words: number;
  separator: string;
  capitalize: boolean;
  includeNumber: boolean;
}

export const DEFAULT_PASSPHRASE_OPTIONS: PassphraseOptions = {
  words: 4,
  separator: '-',
  capitalize: true,
  includeNumber: true,
};

/**
 * Generates a passphrase from the curated word list.
 *
 * Entropy is reported against the *word list size*, which is why the list must
 * be treated as public: the strength comes from the number of words, not from
 * the list being secret.
 */
export function generatePassphrase(options: PassphraseOptions): GenerateResult {
  if (options.words < 2) return { ok: false, error: '至少选择 2 个单词' };
  if (options.words > 24) return { ok: false, error: '单词数量上限为 24' };

  const picked = randomInts(options.words, WORDS.length).map((index) => {
    const word = WORDS[index];
    return options.capitalize ? word[0].toUpperCase() + word.slice(1) : word;
  });

  if (options.includeNumber) {
    const position = randomInts(1, picked.length)[0];
    const digit = randomInts(1, 10)[0];
    picked[position] = `${picked[position]}${digit}`;
  }

  const value = picked.join(options.separator);
  const wordBits = options.words * Math.log2(WORDS.length);
  const numberBits = options.includeNumber ? Math.log2(10 * options.words) : 0;
  const entropyBits = Math.round(wordBits + numberBits);

  return { ok: true, value, entropyBits, poolSize: WORDS.length };
}

export interface StrengthVerdict {
  label: string;
  /** Tailwind-ish colour token for the UI. */
  tone: 'danger' | 'warning' | 'success' | 'brand';
  advice: string;
}

/**
 * Interprets entropy in bits.
 *
 * Thresholds follow common guidance: 60 bits resists online guessing, 80+
 * resists offline cracking of a well-derived hash, 100+ is comfortable.
 */
export function judgeStrength(entropyBits: number): StrengthVerdict {
  if (entropyBits < 40) {
    return { label: '弱', tone: 'danger', advice: '很容易被暴力破解，请加长或增加字符类型' };
  }
  if (entropyBits < 60) {
    return { label: '一般', tone: 'warning', advice: '可抵挡在线猜测，但不足以抵御离线破解' };
  }
  if (entropyBits < 80) {
    return { label: '强', tone: 'success', advice: '足以应对在线与常见离线攻击' };
  }
  if (entropyBits < 120) {
    return { label: '很强', tone: 'success', advice: '适合长期使用的主密码' };
  }
  return { label: '极强', tone: 'brand', advice: '强度远超需要，注意别记不住' };
}

export const WORD_LIST_SIZE = WORDS.length;
