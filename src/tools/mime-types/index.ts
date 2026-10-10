/**
 * Lazy entry point for this tool.
 *
 * The manifest is separate so the registry can read every tool's metadata
 * without pulling in the implementation, which here carries the whole registry
 * table. The component is only fetched when the tool is opened.
 */
export { manifest } from './manifest';
export { MimeTypesTool as default } from './MimeTypesTool';
