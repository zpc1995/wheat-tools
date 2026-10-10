/**
 * Email normalisation and validation, with deliberately explicit rules.
 *
 * ## Why there is no "full RFC 5322" regex here
 *
 * The well-known 6 kB regex that claims to match RFC 5322 is not usable in
 * practice, and both failure directions are easy to demonstrate:
 *
 *   - It **rejects valid addresses**. Comment folding
 *     (`john.smith@(comment)example.com`), which the RFC allows, is not matched,
 *     and neither are several legal forms of the local part it does not model.
 *   - It **accepts invalid addresses**. It happily matches
 *     `"test@example.com, test2@example.com"` as a whole, and it accepts a TLD
 *     of a single character such as `a@b.c`, even though the shortest real TLD
 *     is two characters.
 *
 * So the rules below are written out explicitly and are exactly what the UI
 * states. They are the rules most mail providers and forms actually enforce:
 *
 *   1. Exactly one `@` separating a local part from a domain (an `@` inside a
 *      quoted local part is legal RFC but is rejected here, see rule 5).
 *   2. Local part: 1..64 characters, ASCII letters/digits, Unicode letters and
 *      marks/numbers, plus ``!#$%&'*+-/=?^_`{|}~`` and `.`.
 *   3. Local part must not start or end with `.` and must not contain `..`.
 *   4. Domain: a hostname or an address literal, 1..255 octets, at least two
 *      labels, each label 1..63 octets with no leading/trailing hyphen; the TLD
 *      is at least two characters and not all digits.
 *   5. Quoted local parts (`"a b"@example.com`) and comments are rejected, with
 *      a specific message rather than a generic failure.
 *
 * ## What this cannot tell you
 *
 * Nothing here proves the mailbox exists. That needs an SMTP conversation, and
 * even `RCPT TO` is unreliable behind catch-all domains. MX lookup is out of
 * scope too — it is a network call, and the tool stays offline.
 *
 * ## IDN conversion uses the platform, not a Node builtin
 *
 * ToASCII comes from the `URL` API, which is the browser's own implementation of
 * the UTS #46 mapping tables — the authority, not a reimplementation of it.
 *
 * This module originally imported `domainToASCII` / `domainToUnicode` from
 * `node:url`. That type-checks (because `@types/node` is installed) but breaks
 * the browser build: the bundler cannot resolve a Node builtin. The two helpers
 * below replace it, and `check-email-normalizer.mjs` verifies them against
 * `node:url` on Node's side, where that module does exist — so the browser gets a
 * dependency-free implementation that is still checked against the platform.
 *
 * ToUnicode has no browser equivalent, so the RFC 3492 decode is written out
 * here. The platform's `domainToUnicode` is `ToUnicode(ToASCII(input))` — it
 * normalises and validates first and returns an empty string when that fails —
 * and this follows the same shape, which is what makes the two agree exactly on
 * malformed input as well as on valid names.
 *
 * ## One deliberate deviation
 *
 * The platform truncates at a path/query/fragment separator — `domainToASCII`
 * of `a/b` is `a` — while rejecting a port or credentials outright. Truncating is
 * wrong for an email domain: it would accept `user@a/b` as `user@a`, quietly
 * pointing the address at a different host. All such separators are rejected
 * here instead. `check-email-normalizer.mjs` asserts the platform's truncating
 * behaviour next to this implementation's refusal, so the reason for deviating
 * cannot rot unnoticed.
 */

const PUNYCODE_PREFIX = 'xn--';
const PUNYCODE_BASE = 36;
const PUNYCODE_TMIN = 1;
const PUNYCODE_TMAX = 26;
const PUNYCODE_SKEW = 38;
const PUNYCODE_DAMP = 700;
const PUNYCODE_INITIAL_BIAS = 72;
const PUNYCODE_INITIAL_N = 128;
const PUNYCODE_MAX = 0x7fffffff;

/**
 * True when the text cannot be a bare host name.
 *
 * `new URL('http://a:1').hostname` is `"a"` — it reads `:1` as a port — whereas
 * IDNA ToASCII rejects the colon. So anything that introduces a URL component
 * has to be refused before handing the text to `URL`. A bracketed IPv6 literal
 * is the exception: the platform accepts it verbatim.
 */
function isNonHostText(text: string): boolean {
  if (/^\[[0-9a-fA-F:.]+\]$/.test(text)) return false;
  return /[:/?#@[\]\\]/.test(text);
}

/** IDNA ToASCII; equivalent to `node:url`'s `domainToASCII`. */
export function toAsciiDomain(domain: string): string {
  if (isNonHostText(domain)) return '';
  try {
    return new URL(`http://${domain}`).hostname;
  } catch {
    return '';
  }
}

function punycodeAdapt(delta: number, numPoints: number, firstTime: boolean): number {
  let value = firstTime ? Math.floor(delta / PUNYCODE_DAMP) : delta >> 1;
  value += Math.floor(value / numPoints);
  let k = 0;
  while (value > ((PUNYCODE_BASE - PUNYCODE_TMIN) * PUNYCODE_TMAX) >> 1) {
    value = Math.floor(value / (PUNYCODE_BASE - PUNYCODE_TMIN));
    k += PUNYCODE_BASE;
  }
  return k + Math.floor(((PUNYCODE_BASE - PUNYCODE_TMIN + 1) * value) / (value + PUNYCODE_SKEW));
}

function punycodeDigit(code: number): number {
  if (code >= 48 && code <= 57) return code - 22;
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 97;
  return -1;
}

/** Decodes one Punycode label (RFC 3492), without the `xn--` prefix. */
function punycodeDecodeLabel(input: string): string | null {
  const output: number[] = [];
  let n = PUNYCODE_INITIAL_N;
  let i = 0;
  let bias = PUNYCODE_INITIAL_BIAS;
  let position = 0;

  const delimiter = input.lastIndexOf('-');
  if (delimiter > 0) {
    for (let index = 0; index < delimiter; index += 1) {
      const code = input.charCodeAt(index);
      if (code >= 0x80) return null;
      output.push(code);
    }
    position = delimiter + 1;
  }

  while (position < input.length) {
    const oldi = i;
    let weight = 1;
    for (let k = PUNYCODE_BASE; ; k += PUNYCODE_BASE) {
      if (position >= input.length) return null;
      const digit = punycodeDigit(input.charCodeAt(position));
      position += 1;
      if (digit < 0) return null;
      if (digit > Math.floor((PUNYCODE_MAX - i) / weight)) return null;
      i += digit * weight;
      const threshold =
        k <= bias ? PUNYCODE_TMIN : k >= bias + PUNYCODE_TMAX ? PUNYCODE_TMAX : k - bias;
      if (digit < threshold) break;
      if (weight > Math.floor(PUNYCODE_MAX / (PUNYCODE_BASE - threshold))) return null;
      weight *= PUNYCODE_BASE - threshold;
    }

    const length = output.length + 1;
    bias = punycodeAdapt(i - oldi, length, oldi === 0);
    if (Math.floor(i / length) > PUNYCODE_MAX - n) return null;
    n += Math.floor(i / length);
    i %= length;
    if (n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return null;
    output.splice(i, 0, n);
    i += 1;
  }

  let result = '';
  for (const code of output) result += String.fromCodePoint(code);
  return result;
}

/** IDNA ToUnicode; equivalent to `node:url`'s `domainToUnicode`. */
export function toUnicodeDomain(domain: string): string {
  const ascii = toAsciiDomain(domain);
  if (ascii === '') return '';
  return ascii
    .split('.')
    .map((label) =>
      label.startsWith(PUNYCODE_PREFIX)
        ? punycodeDecodeLabel(label.slice(PUNYCODE_PREFIX.length)) ?? label
        : label,
    )
    .join('.');
}

export interface EmailError {
  ok: false;
  /** Stable machine-readable code, for the checks and for the UI. */
  code:
    | 'empty'
    | 'no-at'
    | 'multiple-at'
    | 'local-empty'
    | 'local-too-long'
    | 'local-leading-dot'
    | 'local-trailing-dot'
    | 'local-double-dot'
    | 'local-char'
    | 'quoted-local'
    | 'comment'
    | 'whitespace'
    | 'domain-empty'
    | 'domain-too-long'
    | 'domain-label'
    | 'domain-label-too-long'
    | 'domain-hyphen'
    | 'domain-tld'
    | 'domain-idn';
  message: string;
}

export interface EmailParts {
  ok: true;
  /** The local part exactly as written. */
  local: string;
  /** The domain exactly as written (Unicode, brackets kept for literals). */
  domain: string;
  /** Lower-cased domain, still Unicode. */
  domainLower: string;
  /** ASCII / Punycode form of the domain; for `münchen.de` this is `xn--mnchen-3ya.de`. */
  domainAscii: string;
  /** TLD in lower case, `''` for address literals. */
  tld: string;
  /** True for `[192.168.1.1]` / `[IPv6:…]` style domains. */
  isAddressLiteral: boolean;
  /** The address with the domain in Punycode form. */
  asciiAddress: string;
}

export type EmailParse = EmailParts | EmailError;

/** Addresses longer than this are rejected outright (RFC 5321 path limit, with headroom). */
export const MAX_ADDRESS_LENGTH = 320;
export const MAX_LOCAL_LENGTH = 64;
export const MAX_DOMAIN_LENGTH = 255;
export const MAX_LABEL_LENGTH = 63;

/**
 * Printable ASCII characters that may appear in an unquoted local part.
 *
 * This is the RFC 5322 `atext` set. It is spelled out rather than matched with
 * a character-class range so the UI can show exactly what is allowed.
 */
export const LOCAL_SPECIALS = "!#$%&'*+-/=?^_`{|}~";

/**
 * The one further character allowed in a local part: the dot separator.
 *
 * Deliberately kept out of `LOCAL_SPECIALS` so that exported set stays exactly
 * the RFC `atext` alphabet, which is what the Python cross-check compares
 * against. The dot is added by the validator, together with the
 * "no leading / trailing / doubled dot" rules that give it its meaning.
 */
export const LOCAL_DOT = '.';

/** IPv4 literal, e.g. `[192.168.1.1]`. */
const IPV4_LITERAL = /^\[(?:\d{1,3}\.){3}\d{1,3}\]$/;
/** IPv6 literal, e.g. `[IPv6:2001:db8::1]`. */
const IPV6_LITERAL = /^\[IPv6:[0-9a-f:.]+\]$/i;

function invalid(code: EmailError['code'], message: string): EmailError {
  return { ok: false, code, message };
}

function isValidIpv4Literal(text: string): boolean {
  if (!IPV4_LITERAL.test(text)) return false;
  return text
    .slice(1, -1)
    .split('.')
    .every((octet) => Number(octet) >= 0 && Number(octet) <= 255 && String(Number(octet)) === octet);
}

/** Whether a single local-part character is permitted. */
function isLocalChar(char: string): boolean {
  if (/[A-Za-z0-9]/.test(char)) return true;
  if (char === LOCAL_DOT) return true;
  if (LOCAL_SPECIALS.includes(char)) return true;
  // A non-ASCII character is accepted when Unicode calls it a letter, a mark or
  // a number. Emoji and spaces are not, which is what a hand-written "any
  // non-ASCII is fine" rule would have got wrong.
  return /[\p{L}\p{M}\p{N}]/u.test(char);
}

/**
 * Splits and validates an address.
 *
 * Returned as a discriminated union instead of throwing so a live input field
 * can render the reason on every keystroke.
 */
export function parseEmail(input: string): EmailParse {
  const raw = input.trim();
  if (raw === '') return invalid('empty', '请输入邮箱地址');
  if (raw.length > MAX_ADDRESS_LENGTH) {
    return invalid('domain-too-long', `地址过长（最多 ${MAX_ADDRESS_LENGTH} 个字符）`);
  }
  if (/[\s]/.test(raw)) {
    return invalid('whitespace', '地址中不能有空格（带引号的本地部分本工具不支持）');
  }
  if (raw.startsWith('"') || raw.includes('"')) {
    return invalid('quoted-local', '不支持带引号的本地部分（RFC 允许，但实际几乎无人使用，且极易写错）');
  }
  if (raw.includes('(') || raw.includes(')')) {
    return invalid('comment', '不支持 RFC 5322 的注释写法（如 a@(注释)b.com）');
  }

  const parts = raw.split('@');
  if (parts.length === 1) return invalid('no-at', '缺少 @');
  if (parts.length > 2) return invalid('multiple-at', '只能有一个 @（本地部分里的 @ 也需要引号，本工具不支持）');

  const [local, domain] = parts;

  // --- Local part ---
  if (local === '') return invalid('local-empty', '@ 前必须有内容');
  if (local.length > MAX_LOCAL_LENGTH) {
    return invalid('local-too-long', `本地部分最多 ${MAX_LOCAL_LENGTH} 个字符，当前 ${local.length} 个`);
  }
  if (local.startsWith('.')) return invalid('local-leading-dot', '本地部分不能以 . 开头');
  if (local.endsWith('.')) return invalid('local-trailing-dot', '本地部分不能以 . 结尾');
  if (local.includes('..')) return invalid('local-double-dot', '本地部分不能出现连续的 ..');
  for (const char of local) {
    if (!isLocalChar(char)) {
      const code = char.codePointAt(0) ?? 0;
      return invalid(
        'local-char',
        `本地部分不能包含 ${JSON.stringify(char)}（U+${code.toString(16).toUpperCase().padStart(4, '0')}）`,
      );
    }
  }

  // --- Domain ---
  if (domain === '') return invalid('domain-empty', '@ 后必须有域名');

  const isAddressLiteral = domain.startsWith('[') || domain.endsWith(']');
  if (isAddressLiteral) {
    if (!isValidIpv4Literal(domain) && !IPV6_LITERAL.test(domain)) {
      return invalid(
        'domain-label',
        `"${domain}" 不是合法的地址字面量（只支持 [IPv4] 与 [IPv6:…]）`,
      );
    }
    return {
      ok: true,
      local,
      domain,
      domainLower: domain,
      domainAscii: domain,
      tld: '',
      isAddressLiteral: true,
      asciiAddress: `${local}@${domain}`,
    };
  }

  if (domain.length > MAX_DOMAIN_LENGTH) {
    return invalid('domain-too-long', `域名最长 ${MAX_DOMAIN_LENGTH} 个字符`);
  }

  // Lower-casing the domain is not an approximation: DNS labels are
  // case-insensitive (RFC 4343), and every provider treats `EXAMPLE.com` and
  // `example.com` as one mailbox.
  const domainLower = domain.toLowerCase();

  const ascii = toAsciiDomain(domainLower);
  if (ascii === '') {
    return invalid('domain-idn', `"${domain}" 不能转换为合法的 ASCII 域名（IDN 规则拒绝）`);
  }

  const labels = ascii.split('.');
  if (labels.length < 2) {
    return invalid('domain-label', '域名至少要有两段（例如 example.com）');
  }
  if (ascii.length > MAX_DOMAIN_LENGTH) {
    return invalid('domain-too-long', `域名转成 Punycode 后超过 ${MAX_DOMAIN_LENGTH} 个字符`);
  }
  for (const label of labels) {
    if (label === '') return invalid('domain-label', '域名中出现了空的段（连续的点）');
    if (label.length > MAX_LABEL_LENGTH) {
      return invalid('domain-label-too-long', `域名段 "${label}" 超过 ${MAX_LABEL_LENGTH} 个字符`);
    }
    if (label.startsWith('-') || label.endsWith('-')) {
      return invalid('domain-hyphen', `域名段 "${label}" 不能以连字符开头或结尾`);
    }
    if (!/^[a-z0-9-]+$/.test(label)) {
      return invalid('domain-label', `域名段 "${label}" 含有字母、数字、连字符之外的字符`);
    }
  }

  const tld = labels[labels.length - 1];
  if (tld.length < 2) {
    return invalid('domain-tld', `顶级域名 "${tld}" 至少要有 2 个字符`);
  }
  // The TLD rule has to allow both shapes that actually exist on the wire: a
  // plain alphabetic TLD (`com`, `de`, `museum`) and its Punycode form
  // (`xn--p1ai` for `рф`, `xn--fiqs8s` for `中国`). So digits are allowed only
  // inside an `xn--` label, and a label that is all digits is still rejected
  // because it means the user typed a bare IPv4 address.
  if (/^\d+$/.test(tld)) {
    return invalid('domain-tld', '顶级域名不能全是数字（裸 IP 请写成 [192.168.1.1] 形式）');
  }
  if (!/^xn--[a-z0-9-]+$/.test(tld) && !/^[a-z]+$/.test(tld)) {
    return invalid(
      'domain-tld',
      `顶级域名 "${tld}" 只能是纯字母或 xn-- 开头的 Punycode 形式（真实 TLD 没有别的形状）`,
    );
  }

  return {
    ok: true,
    local,
    domain,
    domainLower,
    domainAscii: ascii,
    tld,
    isAddressLiteral: false,
    asciiAddress: `${local}@${ascii}`,
  };
}

/** Convenience wrapper: the parsed parts or `null`. */
export function tryParseEmail(input: string): EmailParts | null {
  const parsed = parseEmail(input);
  return parsed.ok ? parsed : null;
}

/** True when the address passes every rule. */
export function isValidEmail(input: string): boolean {
  return parseEmail(input).ok;
}

/**
 * Lower-cases the local part.
 *
 * RFC 5321 says the local part is case-**sensitive** and must be passed through
 * unchanged; in practice every mainstream provider treats it case-insensitively.
 * So this is an option, defaults off, and the UI says why.
 *
 * Only ASCII letters are folded. Unicode lower-casing in a non-ASCII local part
 * is not applied because it is not idempotent with Unicode's own case folding
 * (`İ`.toLowerCase() is `i` + combining dot above, not `i`), and silently
 * rewriting an address into something that does not round-trip is worse than
 * leaving it alone.
 */
export function lowerLocalPart(local: string): string {
  return local.replace(/[A-Z]/g, (char) => char.toLowerCase());
}

export interface GmailReading {
  /** True when the domain is one of Google's Gmail domains. */
  isGmail: boolean;
  /** Local part with every `.` removed. */
  withoutDots: string;
  /** Local part with the `+tag` suffix removed. */
  withoutTag: string;
  /** Both applied: the canonical key Gmail itself uses. */
  canonical: string;
  /** Domains that route to the same mailbox (`googlemail.com` is an alias). */
  aliasDomains: string[];
}

/** The domains that share one Gmail mailbox namespace. */
export const GMAIL_DOMAINS = ['gmail.com', 'googlemail.com'];

/**
 * Applies Google's documented local-part rules.
 *
 * Two rules, both Gmail-specific and therefore behind their own switch:
 * dots are ignored (`first.last` and `firstlast` are one mailbox) and a `+`
 * starts a tag that is ignored (`user+news` delivers to `user`).
 *
 * Two edge cases worth knowing: a local part of only dots (`...@gmail.com`) is
 * not a real account, and everything before the *first* `+` is the account name,
 * so `a+b+c` is `a`.
 */
export function gmailReading(local: string, domainKey: string): GmailReading {
  const isGmail = GMAIL_DOMAINS.includes(domainKey.toLowerCase());
  const withoutDots = local.replace(/\./g, '');
  const plusIndex = local.indexOf('+');
  const withoutTag = plusIndex === -1 ? local : local.slice(0, plusIndex);
  const canonical = withoutTag.replace(/\./g, '');
  return {
    isGmail,
    withoutDots,
    withoutTag,
    canonical,
    aliasDomains: isGmail ? GMAIL_DOMAINS.slice() : [],
  };
}

// ---------------------------------------------------------------------------
// Free / disposable classification
// ---------------------------------------------------------------------------

/**
 * A small, deliberately incomplete list of the largest free mailbox providers.
 *
 * "Incomplete" is the honest description: there are thousands of providers in
 * the world. This answers "is the domain one of the webmail services people
 * reach for", which is the question a sign-up form actually asks, and it is a
 * data list rather than an algorithm so it can be extended without touching
 * any logic.
 */
export const FREE_EMAIL_DOMAINS: string[] = [
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.co.jp',
  'ymail.com',
  'rocketmail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'zoho.com',
  'protonmail.com',
  'proton.me',
  'pm.me',
  'gmx.com',
  'gmx.de',
  'gmx.net',
  'mail.com',
  'mail.ru',
  'yandex.ru',
  'yandex.com',
  'qq.com',
  '163.com',
  '126.com',
  'sina.com',
  'foxmail.com',
  'aliyun.com',
  'tom.com',
  'web.de',
  'tutanota.com',
  'fastmail.com',
  'hushmail.com',
  'inbox.com',
  'rediffmail.com',
  'naver.com',
  'hanmail.net',
  'daum.net',
];

/**
 * A very small sample of disposable / throwaway mailbox domains.
 *
 * This list is explicitly **not** a complete blocklist. Disposable domains are
 * registered and retired by the thousand every month, so any static list is out
 * of date the moment it is written; a real product needs a maintained feed. What
 * the list is good for is showing the classification mechanism and catching the
 * handful of domains that appear in almost every abuse report.
 */
export const DISPOSABLE_EMAIL_DOMAINS: string[] = [
  'mailinator.com',
  'guerrillamail.com',
  'guerrillamail.net',
  '10minutemail.com',
  '10minutemail.net',
  'tempmail.com',
  'temp-mail.org',
  'throwawaymail.com',
  'yopmail.com',
  'yopmail.fr',
  'trashmail.com',
  'sharklasers.com',
  'getnada.com',
  'dispostable.com',
  'maildrop.cc',
  'fakeinbox.com',
  'mailnesia.com',
  'spam4.me',
  'grr.la',
  'mytemp.email',
];

export type ProviderKind = 'free' | 'disposable' | 'disposable+free' | 'other';

export interface DomainClassification {
  domainAscii: string;
  /** Longest matching suffix from the disposable list, or `null`. */
  disposableMatch: string | null;
  /** Longest matching suffix from the free list, or `null`. */
  freeMatch: string | null;
  isDisposable: boolean;
  isFree: boolean;
  kind: ProviderKind;
  /** True when the domain is a subdomain of a listed provider (e.g. `mail.yopmail.com`). */
  matchedBySuffix: boolean;
}

/**
 * Classifies a domain by exact match first, then by suffix.
 *
 * The suffix pass exists because disposable services hand out addresses under
 * subdomains (`something.mailinator.com`) and because a company may run its own
 * mail on a big provider's infrastructure (`mail.gmail.com` is not a mailbox
 * domain, but `corp.gmail.com` style hosts do appear). Exact matches are
 * reported with `matchedBySuffix: false` so the distinction is visible.
 */
export function classifyDomain(domainAscii: string): DomainClassification {
  const key = domainAscii.toLowerCase();
  const suffixMatch = (list: string[]): { match: string | null; bySuffix: boolean } => {
    if (list.includes(key)) return { match: key, bySuffix: false };
    const bySuffix = list
      .filter((candidate) => key.endsWith(`.${candidate}`))
      .sort((a, b) => b.length - a.length)[0];
    return { match: bySuffix ?? null, bySuffix: Boolean(bySuffix) };
  };

  const disposable = suffixMatch(DISPOSABLE_EMAIL_DOMAINS);
  const free = suffixMatch(FREE_EMAIL_DOMAINS);
  const isDisposable = disposable.match !== null;
  const isFree = free.match !== null;

  let kind: ProviderKind = 'other';
  if (isDisposable && isFree) kind = 'disposable+free';
  else if (isDisposable) kind = 'disposable';
  else if (isFree) kind = 'free';

  return {
    domainAscii: key,
    disposableMatch: disposable.match,
    freeMatch: free.match,
    isDisposable,
    isFree,
    kind,
    matchedBySuffix: disposable.bySuffix || free.bySuffix,
  };
}

// ---------------------------------------------------------------------------
// Full normalisation
// ---------------------------------------------------------------------------

export interface NormaliseOptions {
  /** Apply `lowerLocalPart`. Off by default: the RFC says the local part is case-sensitive. */
  lowercaseLocal: boolean;
  /** Apply Gmail's dot and `+tag` rules. Off by default: they only hold for Gmail. */
  applyGmailRules: boolean;
}

export const DEFAULT_NORMALISE_OPTIONS: NormaliseOptions = {
  lowercaseLocal: false,
  applyGmailRules: false,
};

export interface NormalisedEmail {
  ok: true;
  /** The address as the user typed it, trimmed. */
  input: string;
  /** Local part after the selected options. */
  local: string;
  /** Domain in Punycode, lower case. */
  domainAscii: string;
  /** Domain in Unicode form recovered from the Punycode (`xn--mnchen-3ya.de` → `münchen.de`). */
  domainUnicode: string;
  /** The normalised address. */
  normalised: string;
  /** ASCII-only rendering, safe to pass to an SMTP client. */
  asciiAddress: string;
  tld: string;
  isAddressLiteral: boolean;
  classification: DomainClassification;
  gmail: GmailReading;
  /** True when `normalised` differs from the trimmed input. */
  changed: boolean;
  /** Human-readable list of what was changed, for the UI. */
  changes: string[];
}

export type NormaliseResult = NormalisedEmail | EmailError;

/** Normalises an address, or explains why it cannot be normalised. */
export function normaliseEmail(input: string, options: NormaliseOptions = DEFAULT_NORMALISE_OPTIONS): NormaliseResult {
  const parsed = parseEmail(input);
  if (!parsed.ok) return parsed;

  if (parsed.isAddressLiteral) {
    const changes: string[] = [];
    const normalised = `${parsed.local}@${parsed.domain}`;
    if (normalised !== input.trim()) changes.push('去掉了首尾空白');
    return {
      ok: true,
      input: input.trim(),
      local: parsed.local,
      domainAscii: parsed.domain,
      domainUnicode: parsed.domain,
      normalised,
      asciiAddress: normalised,
      tld: '',
      isAddressLiteral: true,
      classification: classifyDomain(''),
      gmail: gmailReading(parsed.local, ''),
      changed: changes.length > 0,
      changes,
    };
  }

  const changes: string[] = [];
  let local = parsed.local;

  if (options.lowercaseLocal) {
    const lowered = lowerLocalPart(local);
    if (lowered !== local) changes.push('本地部分转为小写');
    local = lowered;
  }
  if (parsed.domain !== parsed.domainLower) {
    changes.push('域名转为小写');
  }

  const domainKey = parsed.domainAscii.toLowerCase();
  const gmail = gmailReading(local, domainKey);

  if (options.applyGmailRules && gmail.isGmail) {
    if (gmail.canonical !== local) {
      const removedTag = gmail.withoutTag !== local;
      const removedDots = gmail.withoutDots !== local.replace(/\+.*$/, '');
      if (removedDots && removedTag) changes.push('按 Gmail 规则去掉了点号与 + 后缀');
      else if (removedDots) changes.push('按 Gmail 规则去掉了点号');
      else if (removedTag) changes.push('按 Gmail 规则去掉了 + 后缀');
    }
    local = gmail.canonical;
  } else if (options.applyGmailRules) {
    // A note, not a change: `changed` must stay false when the address is
    // untouched, but saying nothing at all would leave the user wondering why the
    // switch did not do anything.
    changes.push('域名不是 Gmail，未套用点号 / + 后缀规则');
  }

  const normalised = `${local}@${domainKey}`;
  const changed =
    normalised !== input.trim() ||
    changes.some(
      (note) =>
        note === '本地部分转为小写' ||
        note === '域名转为小写' ||
        note.startsWith('按 Gmail 规则'),
    );

  const unicode = toUnicodeDomain(domainKey);

  return {
    ok: true,
    input: input.trim(),
    local,
    domainAscii: domainKey,
    domainUnicode: unicode === '' ? domainKey : unicode,
    normalised,
    asciiAddress: parsed.asciiAddress,
    tld: parsed.tld,
    isAddressLiteral: false,
    classification: classifyDomain(domainKey),
    gmail,
    changed,
    changes,
  };
}

// ---------------------------------------------------------------------------
// Batch
// ---------------------------------------------------------------------------

export interface BatchRow {
  /** 1-based line number in the input. */
  line: number;
  input: string;
  result: NormaliseResult;
}

export interface BatchSummary {
  rows: BatchRow[];
  total: number;
  valid: number;
  invalid: number;
  changed: number;
  uniqueNormalised: number;
  duplicates: string[];
  free: number;
  disposable: number;
  gmail: number;
}

/**
 * Normalises one address per line, reporting the line number.
 *
 * Two behaviours worth knowing when reading the summary:
 *
 *   - Blank lines are skipped rather than reported as errors — pasted lists
 *     routinely end with one — so `total` counts processed lines and `line` keeps
 *     the original position in the pasted text.
 *   - Duplicate detection compares the *normalised* addresses, so it inherits the
 *     options. With `lowercaseLocal` off (the default) `Alice@x.com` and
 *     `alice@x.com` are two entries, which is the honest reading of a
 *     case-sensitive local part; turn the option on to fold them together.
 */
export function normaliseBatch(
  text: string,
  options: NormaliseOptions = DEFAULT_NORMALISE_OPTIONS,
  limit = 5000,
): BatchSummary {
  const lines = text.split(/\r?\n/);
  if (lines.length > limit) {
    lines.length = limit;
  }

  const rows: BatchRow[] = [];
  const seen = new Map<string, number>();

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    // Strip a display-name wrapper, which is how addresses arrive when copied
    // out of a mail client (`Alice <alice@example.com>`). The pattern is
    // optional and anchored, so a bare address — angle brackets or not — is left
    // untouched; the earlier greedy `.*<…>` form silently failed to match
    // `Name <a@b> extra` but also rewrote anything containing a stray `>`.
    const unwrapped = /^[^<>]*<\s*([^<>]*?)\s*>$/.exec(trimmed)?.[1] ?? trimmed;
    const result = normaliseEmail(unwrapped, options);
    rows.push({ line: index + 1, input: trimmed, result });
    if (result.ok) {
      // Keyed on the normalised address *as it stands*. Lower-casing it here
      // would undo the case-sensitivity decision made above — `ALICE@x.com` and
      // `alice@x.com` would collapse even with `lowercaseLocal` off, which is
      // exactly the option's whole point.
      seen.set(result.normalised, (seen.get(result.normalised) ?? 0) + 1);
    }
  }

  const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key);

  return {
    rows,
    total: rows.length,
    valid: rows.filter((row) => row.result.ok).length,
    invalid: rows.filter((row) => !row.result.ok).length,
    changed: rows.filter((row) => row.result.ok && row.result.changed).length,
    uniqueNormalised: seen.size,
    duplicates,
    free: rows.filter((row) => row.result.ok && row.result.classification.isFree).length,
    disposable: rows.filter((row) => row.result.ok && row.result.classification.isDisposable).length,
    gmail: rows.filter((row) => row.result.ok && row.result.gmail.isGmail).length,
  };
}

/** The rules, as text, so the UI and the checks describe the same thing. */
export const RULE_SUMMARY: string[] = [
  '恰好一个 @，分隔本地部分与域名（本地部分里带引号的 @ 不支持）',
  `本地部分 1~${MAX_LOCAL_LENGTH} 字符：ASCII 字母数字、Unicode 字母/标记/数字、${LOCAL_SPECIALS} 与 .`,
  '本地部分不能以 . 开头或结尾，也不能出现连续的 ..',
  `域名 1~${MAX_DOMAIN_LENGTH} 字符、至少两段、每段 1~${MAX_LABEL_LENGTH} 字符且不以连字符开头或结尾`,
  '顶级域名至少 2 个字符、不全是数字（真实 TLD 也不会含数字）',
  '域名可以用 Unicode 书写，会按 WHATWG URL 标准转成 Punycode',
  '不支持带引号的本地部分与 RFC 5322 注释写法，会给出明确原因而不是含糊报错',
  '不验证邮箱是否真实存在，也不查询 MX —— 那需要发信或联网',
];
