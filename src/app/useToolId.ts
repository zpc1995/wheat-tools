import { useLocation } from 'react-router-dom';

/**
 * Extracts the tool id from the current route.
 *
 * Derived from the pathname rather than `useParams()` on purpose. In this
 * react-router version (6.30.6) `useParams()` returns an empty object for
 * routes nested under a pathless layout route — verified with a minimal
 * reproduction covering both JSX `<Routes>` nesting and object-form
 * `useRoutes`. The routes themselves match correctly; only parameter extraction
 * breaks, so the id has to come from somewhere reliable.
 *
 * `useLocation()` is unaffected by that bug, and a regex over the pathname is
 * trivial to keep correct for a flat `/tools/<id>` scheme.
 */
const TOOL_PATH = /\/tools\/([^/?#]+)\/?$/;

export function parseToolId(pathname: string): string | null {
  const match = TOOL_PATH.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    // Malformed percent-encoding: hand back the raw segment rather than
    // throwing during render.
    return match[1];
  }
}

/** The tool id for the current route, or undefined when not on a tool page. */
export function useToolId(): string | undefined {
  const location = useLocation();
  return parseToolId(location.pathname) ?? undefined;
}
