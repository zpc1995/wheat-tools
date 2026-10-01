/**
 * Lazy entry point for this tool.
 *
 * The manifest is a separate module so the registry can list this tool (name,
 * description, icon) without loading the implementation. The component is only
 * fetched when the tool is opened, which also keeps its snippets and validation
 * out of the launcher bundle.
 */
export { manifest } from './manifest';
export { BasicAuthTool as default } from './BasicAuthTool';
