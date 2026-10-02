/**
 * Lazy entry point for this tool.
 *
 * The manifest is re-exported from its own module so the registry can build the
 * launcher and sidebar from metadata alone; the component below, plus everything
 * it pulls in, is only fetched when the route is opened.
 */
export { manifest } from './manifest';
export { Ipv4ConverterTool as default } from './Ipv4ConverterTool';
