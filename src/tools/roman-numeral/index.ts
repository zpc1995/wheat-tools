/**
 * Lazy entry point for this tool.
 *
 * The manifest lives in its own module so the registry can read every tool's
 * name, description and icon without pulling in the implementation. The
 * component — and whatever it imports — is only fetched when the user opens
 * this tool, which is what keeps the first-load bundle from growing with each
 * new tool.
 */
export { manifest } from './manifest';
export { RomanNumeralTool as default } from './RomanNumeralTool';
