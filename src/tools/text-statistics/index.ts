/**
 * Lazy entry point for this tool.
 *
 * The manifest stays in its own module so the registry can read every tool's
 * name, description and icon without pulling in any implementation; the
 * component below is only fetched when this route is opened.
 */
export { manifest } from './manifest';
export { TextStatisticsTool as default } from './TextStatisticsTool';
