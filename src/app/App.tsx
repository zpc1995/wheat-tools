import {
  HashRouter,
  MemoryRouter,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom';
import { tools } from '../tools/registry';
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
 * Route table generated from the tool registry — one route per discovered tool
 * directory, with the tool's id passed to the page as a prop. Adding a tool
 * never requires editing this file.
 */
function AppRoutes() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomeLauncher />} />
        {tools.map((tool) => (
          <Route
            key={tool.id}
            path={`/tools/${tool.id}`}
            element={<ToolPage toolId={tool.id} />}
          />
        ))}
        {/* Unknown routes fall back to the launcher. */}
        <Route path="*" element={<Navigate to="/" replace />} />
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
