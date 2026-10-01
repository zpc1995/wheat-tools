import { useEffect } from 'react';
import {
  HashRouter,
  MemoryRouter,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom';
import { tools } from '../tools/registry';
import { useUsage } from '../tools/usage';
import { AppLayout } from './AppLayout';
import { useToolId } from './useToolId';
import { HomeLauncher } from './HomeLauncher';
import { ToolPage } from './ToolPage';
import { AppThemeProvider } from './theme';

/**
 * The production app uses hash routing so it can be served from any static
 * host. `VITE_ROUTER=memory` swaps in an in-memory router, which the UI test
 * harness uses because a `file://` URL has a pathname that hash-history would
 * prepend to the route path.
 */
const Router =
  import.meta.env.VITE_ROUTER === 'memory' ? MemoryRouter : HashRouter;

/**
 * Counts one "open" per tool view.
 *
 * Reads the route rather than being called from a click handler, so it also
 * covers deep links and back/forward navigation. Counting from an effect keyed
 * on the tool id is safe under StrictMode's double-invoked effects only because
 * the key is stable — a remount re-runs it, which is the intended behaviour for
 * "this tool was opened".
 */
function UsageTracker() {
  const toolId = useToolId();
  const { recordOpen } = useUsage();

  useEffect(() => {
    if (toolId) recordOpen(toolId);
  }, [toolId, recordOpen]);

  return null;
}

function HomeRoute() {
  return (
    <>
      <UsageTracker />
      <HomeLauncher />
    </>
  );
}

function ToolRoute() {
  const toolId = useToolId();
  return (
    <>
      <UsageTracker />
      <ToolPage toolId={toolId ?? ''} />
    </>
  );
}

/**
 * Route table generated from the tool registry — one route per discovered tool
 * directory. Every route renders inside `AppLayout`, which owns the header and
 * sidebar. Adding a tool never requires editing this file.
 */
function AppRoutes() {
  return (
    <Router>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomeRoute />} />
          {tools.map((tool) => (
            <Route
              key={tool.id}
              path={`/tools/${tool.id}`}
              element={<ToolRoute />}
            />
          ))}
          {/* Unknown routes fall back to the launcher. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Router>
  );
}

export function App() {
  return (
    <AppThemeProvider>
      <AppRoutes />
    </AppThemeProvider>
  );
}
