/**
 * Lazy entry point for this tool.
 *
 * The manifest lives in its own module so the registry can read every tool's
 * metadata (a name, a description, one icon) without importing a single
 * implementation. Re-exporting it here and default-exporting the component is
 * the contract the registry's lazy loader depends on.
 */
export { manifest } from './manifest';
export { SvgPlaceholderTool as default } from './SvgPlaceholderTool';
