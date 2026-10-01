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

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'wheat-tools:theme';

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

/**
 * Dark is the default.
 *
 * The system preference is deliberately *not* consulted: a tool collection is
 * usually opened for a few minutes at a time, and defaulting to dark keeps the
 * first paint consistent regardless of what the OS happens to be set to. A
 * stored choice always wins, so switching to light sticks.
 */
function readInitialMode(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  return readStoredMode() ?? 'dark';
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
      theme: mode === 'dark' ? darkTheme : lightTheme,
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
