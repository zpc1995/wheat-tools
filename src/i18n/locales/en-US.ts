import type { Dictionary } from './zh-CN';

/**
 * English dictionary.
 *
 * Typed as `Dictionary`, so this file must supply every key the Chinese one
 * has. A missing translation is therefore a compile error rather than a blank
 * label discovered in production.
 */
export const enUS: Dictionary = {
  app: {
    name: 'wheat tools',
    subtitle: '麦工具',
    tagline: 'A small collection of browser-only developer tools',
    builtWith: 'Built with DeepSeek Harness 0.2.0-rc.2',
    builtWithShort: 'DeepSeek Harness 0.2.0-rc.2',
  },

  header: {
    toggleSidebar: 'Show or hide the sidebar',
    expandSidebar: 'Show sidebar',
    collapseSidebar: 'Hide sidebar',
    expandNav: 'Open navigation',
    collapseNav: 'Close navigation',
    themeToDark: 'Switch to dark theme',
    themeToLight: 'Switch to light theme',
    designSpec: 'Design system: Fluent 2',
    language: 'Interface language',
    switchLanguage: 'Change language',
    github: 'View the source on GitHub',
  },

  nav: {
    home: 'All tools',
    expandAll: 'Expand all',
    collapseAll: 'Collapse all',
    groups: 'Categories',
    localStorageNote: 'Saved locally · never uploaded',
    localStorageHint:
      'Usage counts and favourites are stored in this browser (localStorage) and never uploaded',
    commonEmpty: 'Tools you open will appear here, ranked by how often you use them.',
    favoriteEmpty: 'Use the star on a tool card to add it here.',
    ariaLabel: 'Tool navigation',
  },

  launcher: {
    title: 'Toolbox',
    subtitle:
      '{count} standalone tools. Everything runs locally in the browser, except the public IP lookup, which calls a third-party API.',
    searchPlaceholder: 'Search tools…',
    noMatch: 'No matching tools',
    noMatchHint: 'Try a tool name or a word from its description, or clear the search to see everything.',
    clearSearch: 'Clear search',
    searchLabel: 'Search tools',
    countOf: '{shown} / {total}',
    countTotal: '{total} tools',
    addFavorite: 'Add to favourites',
    removeFavorite: 'Remove from favourites',
  },

  toolPage: {
    backToLauncher: 'All tools',
    notFound: 'Tool “{id}” not found',
    notFoundHint: 'It may have been removed, or the link may be wrong.',
    back: 'Back to the toolbox',
    version: 'v{version}',
    contentNotTranslated:
      'This tool’s content is currently Chinese-only. The interface and the tool description are translated; the text inside the tool is still being filled in.',
    loading: 'Loading “{name}”…',
    loadingGeneric: 'Loading tool…',
    loadingHint: 'The first visit downloads the tool’s code; after that it opens instantly.',
  },

  categories: {
    common: 'Frequently used',
    favorite: 'Favourites',
    dev: 'Developer',
    time: 'Time & schedules',
    text: 'Text & formats',
    crypto: 'Hashing & encryption',
    network: 'Network',
    media: 'Images & media',
    other: 'Other',
  },

  common: {
    copy: 'Copy',
    copied: 'Copied',
    copyFailed: 'Copy failed',
    clear: 'Clear',
    reset: 'Reset',
    download: 'Download',
    close: 'Close',
    search: 'Search',
    options: 'Options',
    result: 'Result',
    input: 'Input',
    output: 'Output',
    statistics: 'Statistics',
    notes: 'Notes',
    warnings: 'Warnings',
    examples: 'Examples',
    loadSample: 'Load sample',
    addRow: 'Add row',
    delete: 'Delete',
    enable: 'Enable',
    true: 'Yes',
    false: 'No',
    none: 'None',
  },

  footer: {
    local: 'Local only',
    localHint: 'Everything is computed in your browser; nothing you type is uploaded.',
    source: 'Source',
    spec: 'Design system',
    built: 'Built with',
  },
};
