/**
 * Lazy entry point for this tool.
 *
 * Metadata is separated from the implementation so the registry can import every
 * tool's manifest eagerly without pulling the validator (or anything else) into
 * the initial bundle; the component is fetched only when the route is opened.
 */
export { manifest } from './manifest';
export { EmailNormalizerTool as default } from './EmailNormalizerTool';
