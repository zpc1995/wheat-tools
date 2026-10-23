/**
 * Lazy entry point for this tool.
 *
 * The manifest is a separate module so the registry can import every tool's
 * metadata cheaply — a name, a description and one icon — without pulling in the
 * implementation. That matters here because opening this tool can open cameras,
 * microphones and screen-capture pickers, and the WebRTC code must not be part of
 * the launcher bundle that every visitor downloads.
 */
export { manifest } from './manifest';
export { WebrtcTesterTool as default } from './WebrtcTesterTool';
