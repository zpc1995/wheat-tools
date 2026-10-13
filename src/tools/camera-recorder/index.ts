/**
 * Lazy entry point for this tool.
 *
 * The manifest is a separate module so the registry can import every tool's
 * metadata cheaply (a name, a description, one icon) without pulling in the
 * implementation. That matters more than usual here: merely importing this
 * component is harmless, but opening it asks for camera permission, so the code
 * must not be part of the launcher bundle that every visitor downloads.
 */
export { manifest } from './manifest';
export { CameraRecorderTool as default } from './CameraRecorderTool';
