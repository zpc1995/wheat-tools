/**
 * Lazy entry point for this tool.
 *
 * `manifest` is a separate module so the registry can render the launcher from
 * metadata without importing this component or its dependencies; this file is
 * the seam the registry's dynamic import resolves.
 */
export { manifest } from './manifest';
export { Ipv4RangeExpanderTool as default } from './Ipv4RangeExpanderTool';
