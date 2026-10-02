/**
 * Lazy entry point for this tool.
 *
 * The manifest lives in its own module so the registry can read all tool
 * metadata eagerly while each implementation stays in a chunk that is only
 * fetched when the tool is opened.
 */
export { manifest } from './manifest';
export { OgMetaGeneratorTool as default } from './OgMetaGeneratorTool';
