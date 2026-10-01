/**
 * Lazy entry point for this tool.
 *
 * The manifest is a separate module so the registry can import every tool's
 * metadata cheaply; the cheat sheet table — which is a sizeable data module —
 * and the component are only fetched when the route is opened.
 */
export { manifest } from './manifest';
export { GitCheatsheetTool as default } from './GitCheatsheetTool';
