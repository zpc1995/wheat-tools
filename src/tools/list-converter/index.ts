/**
 * Lazy entry point for this tool.
 *
 * Keeping the manifest in its own module lets the registry read every tool's
 * metadata without importing the implementations. This tool's parser pulls in
 * the YAML library, which is another reason the entry point has to stay lazy.
 */
export { manifest } from './manifest';
export { ListConverterTool as default } from './ListConverterTool';
