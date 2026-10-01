import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { enUS } from './locales/en-US';
import { zhCN, type Dictionary } from './locales/zh-CN';
import {
  DEFAULT_LOCALE,
  LOCALES,
  type DictionaryPaths,
  type InterpolationValues,
  type Locale,
} from './types';

export { LOCALES, DEFAULT_LOCALE };
export type { Locale };

/** Every dictionary the app ships, keyed by locale. */
const DICTIONARIES: Record<Locale, Dictionary> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

const STORAGE_KEY = 'wheat-tools:locale';

/** A valid dotted key path, derived from the dictionary shape. */
export type TranslationKey = DictionaryPaths<Dictionary>;

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Translates a key, substituting `{placeholder}` slots. */
  t: (key: TranslationKey, values?: InterpolationValues) => string;
  /** True when the locale is not the source language of tool content. */
  isTranslatedContent: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && value in DICTIONARIES;
}

function readStoredLocale(): Locale | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Picks the initial locale.
 *
 * A stored choice always wins. Otherwise the browser's preference is honoured,
 * because someone whose browser is set to English should not have to hunt for a
 * switcher before they can read anything.
 */
function detectLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;

  const stored = readStoredLocale();
  if (stored) return stored;

  const candidates = [
    ...(navigator.languages ?? []),
    navigator.language ?? '',
  ].filter(Boolean);

  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    if (lower.startsWith('zh')) return 'zh-CN';
    if (lower.startsWith('en')) return 'en-US';
  }
  return DEFAULT_LOCALE;
}

/** Resolves a dotted path against a dictionary. */
function lookup(dictionary: Dictionary, key: string): string {
  const parts = key.split('.');
  let current: unknown = dictionary;

  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return key;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : key;
}

/** Replaces `{name}` slots; an unknown slot is left untouched rather than blanked. */
export function interpolate(template: string, values?: InterpolationValues): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Persistence is best effort; the app still works without it.
    }
  }, [locale]);

  const setLocale = useCallback((next: Locale) => setLocaleState(next), []);

  const t = useCallback(
    (key: TranslationKey, values?: InterpolationValues) =>
      interpolate(lookup(DICTIONARIES[locale], key), values),
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t,
      // The tool content itself is authored in Chinese; anything else is a
      // translation of the chrome only.
      isTranslatedContent: locale === 'zh-CN',
    }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used inside <I18nProvider>');
  }
  return context;
}

/** Convenience hook when only the translate function is needed. */
export function useTranslation(): (key: TranslationKey, values?: InterpolationValues) => string {
  return useI18n().t;
}
