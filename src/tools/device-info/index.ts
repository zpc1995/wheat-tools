/**
 * Lazy entry point for this tool.
 *
 * The manifest is a separate module so the registry can import every tool's
 * metadata cheaply (a name, a description, one icon) without pulling in the
 * implementation. The component below — and the DOM probing it triggers — is
 * only fetched when the user actually opens this tool, which matters here
 * because opening it creates a canvas and asks the browser for WebGL details:
 * work that has no business happening on the launcher screen.
 */
export { manifest } from './manifest';
export { DeviceInfoTool as default } from './DeviceInfoTool';
