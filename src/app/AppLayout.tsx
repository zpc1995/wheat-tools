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
  open: boolean;
  toggle: () => void;
  close: () => void;
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
  const toggle = useCallback(() => setDrawerOpen((open) => !open), []);

  const sidebar = useMemo(
    () => ({ open: drawerOpen, toggle, close }),
    [drawerOpen, toggle, close],
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

        <div className="wt-body">
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
