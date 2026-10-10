/**
 * Lazy entry point for this tool.
 *
 * The manifest lives in its own module so the registry can read every tool's
 * metadata without importing any implementation. The component below is only
 * fetched when the user opens this tool.
 */
export { manifest } from './manifest';
export { KeycodeInfoTool as default } from './KeycodeInfoTool';
