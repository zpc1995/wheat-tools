/**
 * Lazy entry point for this tool.
 *
 * The manifest lives in its own module so the registry can read every tool's
 * metadata (name, description, icon) without pulling in any implementation.
 * The component below — and the parser it carries — is only fetched when the
 * user actually opens this tool, which keeps the initial bundle flat as tools
 * are added.
 */
export { manifest } from './manifest';
export { XmlJsonTool as default } from './XmlJsonTool';
