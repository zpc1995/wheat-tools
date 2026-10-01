/**
 * Lazy entry point for this tool.
 *
 * The manifest lives in its own module so the registry can read every tool's
 * name, description and icon eagerly (a few bytes each) while this component —
 * and the conversion logic it pulls in — is only downloaded when the tool is
 * actually opened.
 */
export { manifest } from './manifest';
export { TextToUnicodeTool as default } from './TextToUnicodeTool';
