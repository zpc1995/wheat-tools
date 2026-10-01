import type { Locale } from './types';
import type { ToolManifest } from '../tools/types';

/**
 * Tool metadata translation.
 *
 * Each manifest carries its Chinese name and description as the base values and
 * an optional `translations` map for other locales. Looking up a translation is
 * a plain override with fallback, so a tool that has not been translated yet
 * still lists correctly — it just shows its Chinese name alongside translated
 * chrome.
 *
 * This lives beside the i18n module rather than in the registry so the registry
 * can stay unaware of locales: it registers manifests, and the UI localises them
 * at render time.
 */
export function localiseManifest(
  manifest: ToolManifest,
  locale: Locale,
): { name: string; description: string; tags: string[] } {
  const override = manifest.translations?.[locale];

  return {
    name: override?.name ?? manifest.name,
    description: override?.description ?? manifest.description,
    tags: override?.tags ?? manifest.tags ?? [],
  };
}

/**
 * Whether a tool ships a translation for the locale's *metadata*.
 *
 * Used to decide whether to show the "content is Chinese-only" notice: the
 * notice is about the tool's internals, but the metadata translation is the
 * signal that someone has worked on this tool for that locale at all.
 */
export function hasMetadataTranslation(manifest: ToolManifest, locale: Locale): boolean {
  if (locale === 'zh-CN') return true;
  return Boolean(manifest.translations?.[locale]?.name);
}
