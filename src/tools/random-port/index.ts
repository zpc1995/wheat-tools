/**
 * Lazy entry point for this tool.
 *
 * The manifest lives in its own module so the registry can import every tool's
 * metadata cheaply (a name, a description, one icon) without pulling in the
 * implementation. The component below — and the utility module it imports — is
 * only fetched when the user actually opens this tool.
 */
export { manifest } from './manifest';
export { RandomPortTool as default } from './RandomPortTool';
