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

/**
 * What the user chose, which is not the same as what is displayed.
 *
 * `system` is the default: the app then follows the browser/OS preference and
 * changes with it live. Picking `light` or `dark` pins the choice, which is what
 * someone does when they disagree with their OS.
 */
export type ThemePreference = 'system' | 'light' | 'dark';

/** The theme actually rendered. */
export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'wheat-tools:theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Fluent's stock themes.
 *
 * An earlier version shipped a hand-built violet brand ramp. It was reverted:
 * the default blue is what the design system's own guidance assumes, so every
 * Fluent component's brand states (hover, pressed, selected, focus) come out
 * correct without having to be re-verified against measured contrast, and the
 * app no longer needs a 16-stop ramp that has to be maintained by hand.
 *
 * The colour-preference logic below is independent of this and is unchanged.
 */
const lightTheme = webLightTheme;
const darkTheme = webDarkTheme;

interface ThemeContextValue {
  /** The theme currently rendered. */
  mode: ThemeMode;
  /** What the user asked for, including `system`. */
  preference: ThemePreference;
  theme: Theme;
  toggleMode: () => void;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * `localStorage` throws in some embedded/sandboxed contexts, so every access
 * is guarded — the theme simply stops persisting instead of breaking the app.
 */
function isPreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

function readStoredPreference(): ThemePreference | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    // 'light' and 'dark' written by an earlier version are still valid
    // preferences, so an existing choice survives the upgrade.
    return isPreference(stored) ? stored : null;
  } catch {
    return null;
  }
}

function storePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Persistence is a nice-to-have; ignore.
  }
}

/** Whether the OS currently prefers a dark colour scheme. */
function systemPrefersDark(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.(DARK_QUERY).matches ?? false;
}

/**
 * The default is to follow the system.
 *
 * This is the least surprising behaviour: someone whose OS is set to light sees
 * a light page, someone in dark mode sees dark, and either way it keeps up if
 * they change the OS setting while the page is open. An earlier version pinned
 * dark unconditionally, which meant fighting the OS on every visit.
 */
function readInitialPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  return readStoredPreference() ?? 'system';
}

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readInitialPreference);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  // Track the OS preference even while it is overridden, so switching back to
  // `system` is instant and correct rather than needing a reload.
  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    const apply = () => setSystemDark(query.matches);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);

  const mode: ThemeMode =
    preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    storePreference(preference);
    // `color-scheme` tells the browser to render form controls and scrollbars to
    // match, which is why it is set from the resolved mode rather than the
    // preference.
    document.documentElement.style.colorScheme = mode;
    document.documentElement.dataset.theme = mode;
    document.documentElement.dataset.themePreference = preference;
  }, [mode, preference]);

  const toggleMode = useCallback(
    // Toggling pins an explicit choice: if the OS says dark and the user asks for
    // light, they mean it, so the result must not be `system` again.
    () => setPreferenceState((current) => {
      const resolved = current === 'system' ? (systemDark ? 'dark' : 'light') : current;
      return resolved === 'light' ? 'dark' : 'light';
    }),
    [systemDark],
  );

  const setPreference = useCallback((next: ThemePreference) => setPreferenceState(next), []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      preference,
      theme: mode === 'dark' ? darkTheme : lightTheme,
      toggleMode,
      setPreference,
    }),
    [mode, preference, toggleMode, setPreference],
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
