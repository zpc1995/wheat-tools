/**
 * Lazy entry point for this tool.
 *
 * The manifest stays separate so the registry can read this tool's metadata
 * without downloading the emoji table, which is by far the largest static asset
 * any tool here ships.
 */
export { manifest } from './manifest';
export { EmojiPickerTool as default } from './EmojiPickerTool';
