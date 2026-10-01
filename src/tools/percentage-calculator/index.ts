/**
 * Lazy entry point for this tool.
 *
 * The manifest lives in its own module so the registry can import every tool's
 * metadata — a name, a description, one icon — without pulling in the
 * implementation. The component and its dependencies are only fetched when the
 * user opens this tool, which is what keeps the initial bundle from growing
 * with every tool added.
 */
export { manifest } from './manifest';
export { PercentageCalculatorTool as default } from './PercentageCalculatorTool';
