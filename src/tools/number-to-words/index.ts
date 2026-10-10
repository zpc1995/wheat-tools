/**
 * Lazy entry point for this tool.
 *
 * The manifest is kept in its own module so the registry can read all tool
 * metadata eagerly without importing any implementation; the conversion logic is
 * only fetched once the tool is actually opened.
 */
export { manifest } from './manifest';
export { NumberToWordsTool as default } from './NumberToWordsTool';
