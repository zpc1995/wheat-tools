import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AppHeader } from './AppHeader';
import { useToolId } from './useToolId';
import { LauncherSidebar } from './LauncherSidebar';

interface SidebarContextValue {
  /** True when the narrow-screen overlay drawer is showing. */
  open: boolean;
  /**
   * True when the sidebar rail is visible on a wide screen.
   *
   * Kept separate from `open` because the two presentations behave differently:
   * on a wide screen the rail takes layout width and is hidden entirely, while
   * on a narrow screen it is an overlay that slides in. Deriving both from one
   * flag made the header button appear to do nothing on desktop — which is
   * exactly the bug users reported.
   */
  railVisible: boolean;
  /** True below the drawer breakpoint. */
  narrow: boolean;
  toggle: () => void;
  close: () => void;
}

/** Matches the CSS breakpoint where the rail becomes an overlay. */
const NARROW_QUERY = '(max-width: 1000px)';

const RAIL_KEY = 'wheat-tools:rail-visible:v1';

function readRailVisible(): boolean {
  try {
    const raw = window.localStorage.getItem(RAIL_KEY);
    // Default to visible: hiding the navigation on first visit would be a
    // strange way to greet someone.
    return raw === null ? true : raw === 'true';
  } catch {
    return true;
  }
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

/**
 * Access to the drawer state.
 *
 * The header renders the toggle button while the layout owns the drawer, so the
 * state has to be shared rather than lifted into props.
 */
export function useSidebar(): SidebarContextValue {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used inside <AppLayout>');
  }
  return context;
}

/**
 * Shared shell: header on top, sidebar on the left, page content on the right.
 *
 * The sidebar lives here rather than inside the launcher so it stays available
 * while a tool is open — otherwise switching between tools would mean bouncing
 * back to the launcher every time.
 *
 * Below the CSS breakpoint the sidebar becomes an overlay drawer; that is driven
 * by a class toggle rather than a media query alone so the header button can
 * actually control it.
 */
export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const toolId = useToolId();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [railVisible, setRailVisible] = useState(readRailVisible);
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches,
  );

  // Track the breakpoint in JS as well as in CSS: the header button needs to
  // know which of the two presentations it is controlling.
  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const apply = () => setNarrow(query.matches);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(RAIL_KEY, String(railVisible));
    } catch {
      // Best effort; the sidebar still works without persistence.
    }
  }, [railVisible]);

  // Close the mobile drawer on navigation, otherwise it lingers over the tool
  // the user just opened.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  // The main pane is the scroll container, so reset it on route change;
  // otherwise a long launcher leaves the next tool scrolled mid-page.
  useEffect(() => {
    document.querySelector('.wt-content')?.scrollTo({ top: 0 });
  }, [location.pathname]);

  const close = useCallback(() => setDrawerOpen(false), []);

  const toggle = useCallback(() => {
    // One button, two meanings — decided by the current breakpoint so that it
    // always does something visible.
    if (window.matchMedia(NARROW_QUERY).matches) {
      setDrawerOpen((open) => !open);
    } else {
      setRailVisible((visible) => !visible);
    }
  }, []);

  const sidebar = useMemo(
    () => ({ open: drawerOpen, railVisible, narrow, toggle, close }),
    [drawerOpen, railVisible, narrow, toggle, close],
  );

  const openTool = useCallback(
    (id: string) => {
      setDrawerOpen(false);
      navigate(`/tools/${id}`);
    },
    [navigate],
  );

  return (
    <SidebarContext.Provider value={sidebar}>
      {/* Height-constrained flex column. This element is required: the app is
          mounted inside FluentProvider, whose wrapper is `display: block`, so
          without an explicit flex parent the `flex: 1 1 auto` on `.wt-body` had
          no effect — the body grew to its full content height and both panes
          scrolled with the document instead of on their own. */}
      <div className="wt-app">
        <AppHeader />

        <div className={`wt-body ${railVisible ? '' : 'wt-body--rail-hidden'}`}>
          <aside
            className={`wt-sidebar ${drawerOpen ? 'wt-sidebar--open' : ''}`}
            aria-label="工具导航栏"
          >
            <div className="wt-sidebar__scroll">
              <LauncherSidebar activeId={toolId} onSelect={openTool} />
            </div>
          </aside>

          {drawerOpen && (
            <button
              type="button"
              className="wt-scrim"
              aria-label="关闭导航"
              onClick={close}
            />
          )}

          <main className="wt-content">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarContext.Provider>
  );
}
