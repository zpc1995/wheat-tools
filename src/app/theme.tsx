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
  createDarkTheme,
  createLightTheme,
  type BrandVariants,
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
 * Brand ramp: violet, 258° hue.
 *
 * Why violet rather than the default Fluent blue: the stock blue makes the app
 * look like an unstyled Fluent sample rather than something with its own
 * identity, and violet reads as "tooling" without drifting into the blue that
 * would defeat the point.
 *
 * The ramp is a full 16-stop scale rather than one colour because a single hue
 * cannot work in both themes. Every vivid purple fails as text on a dark surface
 * (the darkest candidate measured about 2:1), so the dark theme has to draw its
 * foregrounds from the light half of the ramp — which is exactly what
 * `createDarkTheme` does with this input.
 *
 * The specific stops are not arbitrary; they were chosen against measured
 * contrast requirements (WCAG AA, 4.5:1):
 *
 *   - white on stop 80 (filled buttons, light theme)        6.96 ✓
 *   - stop 80 on white (link text, light theme)             6.96 ✓
 *   - stop 100 on #1f1f1f (link text, dark theme)           4.54 ✓
 *
 * The light half is deliberately raised: with an even ramp, Fluent's dark theme
 * picks stop 100 for `colorBrandForeground1`, which measured only 3.77:1 on the
 * dark surface — below AA for body-sized link text. Lifting the light stops is
 * what fixes that, and it is why the ramp is spelled out here rather than
 * generated from a formula at runtime.
 */
const brandRamp: BrandVariants = {
  10: '#211146',
  20: '#2a135f',
  30: '#321479',
  40: '#3a1494',
  50: '#4212b1',
  60: '#490fcf',
  70: '#4f0bef',
  80: '#5f1df8',
  90: '#743df3',
  100: '#956ef2',
  110: '#a98af1',
  120: '#bca5f1',
  130: '#cebef3',
  140: '#e0d7f6',
  150: '#ece6fa',
  160: '#f7f4fd',
};

const lightTheme = createLightTheme(brandRamp);
const darkTheme = createDarkTheme(brandRamp);

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
