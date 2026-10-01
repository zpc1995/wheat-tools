/**
 * Lazy entry point for this tool.
 *
 * The manifest lives in its own module so the registry can import every tool's
 * metadata (a name, a description, one icon) without pulling in the
 * implementation. This tool's entity table alone is a few tens of kilobytes, so
 * keeping it behind the dynamic import also keeps it out of the first paint.
 */
export { manifest } from './manifest';
export { HtmlEntitiesTool as default } from './HtmlEntitiesTool';
