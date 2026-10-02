/**
 * Lazy entry point for this tool.
 *
 * The manifest is re-exported from its own module so the registry can read every
 * tool's metadata (name, description, icon) eagerly without pulling in the
 * component and its dependencies; the component below is only fetched when the
 * tool is actually opened.
 */
export { manifest } from './manifest';
export { UrlParserTool as default } from './UrlParserTool';
