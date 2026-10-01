/**
 * Regular-expression reference data.
 *
 * Each entry has a tested `sample` — a string that must actually match the
 * `pattern` under the given flags. `scripts/check-cheatsheet.mjs` verifies every
 * entry, so a wrong or mistyped pattern cannot ship as "documentation".
 */

export interface CheatEntry {
  pattern: string;
  /** What it matches. */
  meaning: string;
  /** A string that MUST match `pattern`; verified by the test script. */
  sample: string;
}

export interface CheatGroup {
  id: string;
  title: string;
  note?: string;
  entries: CheatEntry[];
}

export const CHEAT_GROUPS: CheatGroup[] = [
  {
    id: 'classes',
    title: '字符类',
    entries: [
      { pattern: '.', meaning: '任意字符（默认不含换行）', sample: 'a' },
      { pattern: '\\d', meaning: '数字，等价 [0-9]', sample: '7' },
      { pattern: '\\D', meaning: '非数字', sample: 'x' },
      { pattern: '\\w', meaning: '字母、数字或下划线', sample: '_' },
      { pattern: '\\W', meaning: '非 \\w', sample: '-' },
      { pattern: '\\s', meaning: '空白（空格、制表、换行等）', sample: '\t' },
      { pattern: '\\S', meaning: '非空白', sample: 'a' },
      { pattern: '[abc]', meaning: 'a、b 或 c 之一', sample: 'b' },
      { pattern: '[^abc]', meaning: '除 a、b、c 之外的字符', sample: 'd' },
      { pattern: '[a-z]', meaning: 'a 到 z 的区间', sample: 'm' },
      { pattern: '[\\u4e00-\\u9fa5]', meaning: '常用汉字', sample: '中' },
      { pattern: '\\p{L}', meaning: '任意语言的字母（需 u 标志）', sample: '中', },
      { pattern: '\\p{Script=Han}', meaning: '汉字（需 u 标志）', sample: '汉' },
    ],
  },
  {
    id: 'anchors',
    title: '锚点与边界',
    note: '^ 与 $ 默认只匹配整串首尾，加 m 标志后匹配每行首尾',
    entries: [
      { pattern: '^abc', meaning: '行首', sample: 'abc' },
      { pattern: 'abc$', meaning: '行尾', sample: 'abc' },
      { pattern: '\\bword\\b', meaning: '单词边界', sample: 'a word here' },
      { pattern: '\\Bord', meaning: '非单词边界', sample: 'word' },
      { pattern: '(?=abc)', meaning: '正向前瞻：后面是 abc', sample: 'abc' },
      { pattern: '(?!abc)', meaning: '负向前瞻：后面不是 abc', sample: 'x' },
      { pattern: '(?<=abc)', meaning: '正向后顾：前面是 abc', sample: 'abc' },
      { pattern: '(?<!abc)', meaning: '负向后顾：前面不是 abc', sample: 'x' },
    ],
  },
  {
    id: 'quantifiers',
    title: '量词',
    entries: [
      { pattern: 'a*', meaning: '0 次或多次', sample: 'aaa' },
      { pattern: 'a+', meaning: '1 次或多次', sample: 'a' },
      { pattern: 'a?', meaning: '0 次或 1 次', sample: 'a' },
      { pattern: 'a{3}', meaning: '恰好 3 次', sample: 'aaa' },
      { pattern: 'a{2,4}', meaning: '2 到 4 次', sample: 'aaa' },
      { pattern: 'a{2,}', meaning: '至少 2 次', sample: 'aa' },
      { pattern: 'a+?', meaning: '懒惰匹配：尽可能少', sample: 'a' },
      { pattern: 'a{2,4}?', meaning: '懒惰区间量词', sample: 'aa' },
    ],
  },
  {
    id: 'groups',
    title: '分组与引用',
    entries: [
      { pattern: '(ab)+', meaning: '捕获分组', sample: 'abab' },
      { pattern: '(?:ab)+', meaning: '非捕获分组', sample: 'abab' },
      { pattern: '(?<name>ab)', meaning: '命名分组', sample: 'ab' },
      { pattern: '(a)\\1', meaning: '反向引用第一个分组', sample: 'aa' },
      { pattern: '(?<x>a)\\k<x>', meaning: '命名反向引用', sample: 'aa' },
      { pattern: 'a|b', meaning: '或', sample: 'b' },
    ],
  },
  {
    id: 'flags',
    title: '标志',
    entries: [
      { pattern: '^b', meaning: 'm：^ $ 匹配每行首尾', sample: 'a\nb' },
      { pattern: 'a.b', meaning: 's：. 匹配换行', sample: 'a\nb' },
      { pattern: 'ä', meaning: 'u：Unicode 模式', sample: 'ä' },
      { pattern: 'a', meaning: 'i：忽略大小写', sample: 'A' },
    ],
  },
  {
    id: 'common',
    title: '常用模式',
    note: '这些是实用模式；注意它们各自都有已知边界，不要当成严格校验',
    entries: [
      {
        pattern: '^[\\w.+-]+@[\\w-]+\\.[\\w.]+$',
        meaning: '邮箱（基础校验）',
        sample: 'user.name+tag@example.co.uk',
      },
      {
        pattern: '^https?://[^\\s]+$',
        meaning: 'HTTP(S) 链接',
        sample: 'https://wheat.chat/path?q=1',
      },
      {
        pattern: '^1[3-9]\\d{9}$',
        meaning: '中国大陆手机号',
        sample: '13800138000',
      },
      {
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        meaning: '日期 YYYY-MM-DD（不校验有效性）',
        sample: '2026-10-01',
      },
      {
        pattern: '^[0-9a-fA-F]{6}$',
        meaning: '十六进制颜色（不含 #）',
        sample: '2f6fed',
      },
      {
        pattern: '^(?:\\d{1,3}\\.){3}\\d{1,3}$',
        meaning: 'IPv4 形状（不校验范围）',
        sample: '192.168.1.1',
      },
      {
        pattern: '^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$',
        meaning: 'IPv6 完整形式（不支持 ::）',
        sample: '2001:0db8:0000:0000:0000:0000:0000:0001',
      },
      {
        pattern: '^[a-zA-Z0-9_-]{3,16}$',
        meaning: '用户名 3–16 位',
        sample: 'wheat_tools',
      },
      {
        pattern: '^\\s*$',
        meaning: '空行或纯空白行',
        sample: '   ',
      },
      {
        pattern: '<([a-zA-Z][\\w-]*)[^>]*>.*?</\\1>',
        meaning: '成对标签（不适用于嵌套同名标签）',
        sample: '<div class="a">内容</div>',
      },
    ],
  },
];

/** Flags needed to make a given entry's sample match. */
export const ENTRY_FLAGS: Record<string, string> = {
  '\\p{L}': 'u',
  '\\p{Script=Han}': 'u',
  'ā': 'u',
  '^b': 'm',
  'a.b': 's',
  'a': 'i',
  'ä': 'u',
};

/** Resolves the flags that should be used when testing a given entry. */
export function flagsForEntry(entry: CheatEntry): string {
  if (entry.pattern === '^b') return 'm';
  if (entry.pattern === 'a.b') return 's';
  if (entry.pattern === 'a' && entry.sample === 'A') return 'i';
  if (/\\p\{|ä/.test(entry.pattern)) return 'u';
  return '';
}

export interface QuickRule {
  title: string;
  detail: string;
  /** Rendered as a warning when true. */
  caution?: boolean;
}

export const PITFALLS: QuickRule[] = [
  {
    title: '`.` 默认不匹配换行',
    detail: '需要跨行时加 s 标志，或用 [\\s\\S] 这类写法。',
  },
  {
    title: '`^` `$` 默认只匹配整串首尾',
    detail: '多行文本要加 m 标志，否则只会匹配到第一行开头与最后一行结尾。',
  },
  {
    title: '`g` 标志下的 RegExp 是有状态的',
    detail:
      '同一对象连续 exec 会从 lastIndex 继续，复用前必须重置 lastIndex = 0，否则会静默漏掉开头。',
    caution: true,
  },
  {
    title: '零宽匹配会死循环',
    detail:
      '像 /(?:)/g 或 /(?=x)/g 这类能匹配空串的模式，lastIndex 不前进，while (m = re.exec(s)) 会永远转下去。需要手工推进。',
    caution: true,
  },
  {
    title: '嵌套量词可能导致灾难性回溯',
    detail:
      '如 (a+)+$、([a-z]+)* 在长输入上会指数级回溯，冻结页面。应改写为更具体的模式。',
    caution: true,
  },
  {
    title: '`[` 内的字符大多不需要转义',
    detail:
      '在字符类里，. + * ( ) 等是普通字符；需要转义的只有 ] \\ ^ -（且位置敏感）。',
  },
  {
    title: 'JavaScript 不支持占有量词与原子组',
    detail:
      'a++、a*+、(?>…) 是 PCRE/Java 的语法，在 JavaScript 里会直接报 Nothing to repeat。JS 也没有可用来替代的原子组写法。',
    caution: true,
  },
  {
    title: '`\\d` `\\w` 只看 ASCII',
    detail:
      '\\d 只匹配 0-9，\\w 只匹配 [A-Za-z0-9_]，都不含中文与其他数字系统。中文需要显式区间或 \\p{Script=Han}。',
  },
  {
    title: '字符串里的反斜杠要写两次',
    detail:
      '在 JS 字符串中 new RegExp("\\\\d") 才等于正则 \\d；直接写字面量 /\\d/ 则不受影响。',
  },
  {
    title: '正则不适合校验邮箱与 URL',
    detail:
      'RFC 允许的写法远超常见正则覆盖范围；正则只适合粗筛，最终校验应交由真正的解析器或发信验证。',
    caution: true,
  },
];
