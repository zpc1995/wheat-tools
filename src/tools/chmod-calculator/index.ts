/**
 * Lazy entry point for this tool.
 *
 * The manifest lives in its own module so the registry can read every tool's
 * metadata — id, name, description, icon — without pulling in any
 * implementation. Only this component and its dependencies are fetched when the
 * user actually opens the tool, which is what keeps the launcher's first paint
 * cheap as the number of tools grows.
 */
export { manifest } from './manifest';
export { ChmodCalculatorTool as default } from './ChmodCalculatorTool';
