/**
 * Lazy entry point for this tool.
 *
 * The manifest lives in its own module so the registry can read every tool's
 * name, description and icon without importing a single implementation; the
 * component below is only fetched when a route asks for it.
 */
export { manifest } from './manifest';
export { MacGeneratorTool as default } from './MacGeneratorTool';
