/**
 * Lazy entry point for this tool.
 *
 * The manifest lives in its own module so the registry can read every tool's
 * metadata (name, description, icon) eagerly without pulling in the
 * implementations. The component below, and the Web Crypto calls it makes, are
 * only fetched when the user opens this tool.
 */
export { manifest } from './manifest';
export { HmacGeneratorTool as default } from './HmacGeneratorTool';
