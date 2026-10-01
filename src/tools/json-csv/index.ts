/**
 * Lazy entry point for this tool.
 *
 * The manifest is a separate module so the registry can read every tool's
 * metadata (name, description, one icon) without importing the implementation.
 * The converter itself carries the parser, the generator and the option
 * plumbing, none of which is needed until the tool is opened.
 */
export { manifest } from './manifest';
export { JsonCsvTool as default } from './JsonCsvTool';
