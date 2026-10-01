import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  FluentProvider,
  webDarkTheme,
  webLightTheme,
  type Theme,
} from '@fluentui/react-components';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'wheat-tools:theme';

interface ThemeContextValue {
  mode: ThemeMode;
  theme: Theme;
  toggleMode: () => void;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * `localStorage` throws in some embedded/sandboxed contexts, so every access
 * is guarded — the theme simply stops persisting instead of breaking the app.
 */
function readStoredMode(): ThemeMode | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch {
    return null;
  }
}

function storeMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Persistence is a nice-to-have; ignore.
  }
}

function readInitialMode(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  const stored = readStoredMode();
  if (stored) return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(readInitialMode);

  useEffect(() => {
    storeMode(mode);
    document.documentElement.style.colorScheme = mode;
    document.documentElement.dataset.theme = mode;
  }, [mode]);

  const toggleMode = useCallback(
    () => setMode((current) => (current === 'light' ? 'dark' : 'light')),
    [],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      theme: mode === 'dark' ? webDarkTheme : webLightTheme,
      toggleMode,
      setMode,
    }),
    [mode, toggleMode],
  );

  return (
    <ThemeContext.Provider value={value}>
      <FluentProvider theme={value.theme} style={{ height: '100%' }}>
        {children}
      </FluentProvider>
    </ThemeContext.Provider>
  );
}

export function useAppTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useAppTheme must be used inside <AppThemeProvider>');
  }
  return context;
}
