/**
 * Lazy entry point for this tool.
 *
 * The manifest lives in its own module so the registry can collect every
 * tool's metadata without pulling in any implementation; the decoder component
 * is only fetched when the route is opened.
 */
export { manifest } from './manifest';
export { SafelinkDecoderTool as default } from './SafelinkDecoderTool';
