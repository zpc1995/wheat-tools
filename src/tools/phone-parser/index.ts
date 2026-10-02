/**
 * Lazy entry point for this tool.
 *
 * The manifest lives in its own module so the registry can import every tool's
 * metadata cheaply — a name, a description, one icon — without pulling in the
 * implementation. The country table below is a sizeable constant, and it must
 * not end up in the first-load bundle for users who never open this tool.
 */
export { manifest } from './manifest';
export { PhoneParserTool as default } from './PhoneParserTool';
