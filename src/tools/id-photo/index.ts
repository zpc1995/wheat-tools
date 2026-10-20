/**
 * Lazy entry point for this tool.
 *
 * The manifest is a separate module so the registry can import every tool's
 * metadata cheaply (a name, a description and one icon) without pulling in the
 * implementation. The component below, and its pixel-processing code, is only
 * fetched when a route opens this tool.
 */
export { manifest } from './manifest';
export { IdPhotoTool as default } from './IdPhotoTool';
