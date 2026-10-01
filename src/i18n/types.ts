/**
 * Locale identifiers this app ships.
 *
 * Two are supported deliberately: the interface chrome and every tool's
 * metadata are translated, and tool *content* falls back to Chinese with a
 * visible notice rather than showing a half-translated panel.
 */
export type Locale = 'zh-CN' | 'en-US';

export const LOCALES: Array<{ id: Locale; label: string; english: string }> = [
  { id: 'zh-CN', label: '简体中文', english: 'Chinese (Simplified)' },
  { id: 'en-US', label: 'English', english: 'English' },
];

export const DEFAULT_LOCALE: Locale = 'zh-CN';

/**
 * Dotted key paths of a nested dictionary, e.g. `nav.home`.
 *
 * Deriving the union from the dictionary type means a typo or a removed key is a
 * compile error rather than a blank label at runtime.
 */
export type DictionaryPaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${DictionaryPaths<T[K]>}`;
}[keyof T & string];

/** Values substituted into `{placeholder}` slots. */
export type InterpolationValues = Record<string, string | number>;
