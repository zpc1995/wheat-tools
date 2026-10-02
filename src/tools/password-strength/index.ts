/**
 * Lazy entry point for this tool.
 *
 * The manifest lives in its own module so the registry can import every tool's
 * metadata cheaply, without pulling the analyser — and its 1000-entry weak
 * password list — into the initial bundle. The component is fetched only when
 * the user opens this tool.
 */
export { manifest } from './manifest';
export { PasswordStrengthTool as default } from './PasswordStrengthTool';
