/**
 * Lazy entry point for this tool.
 *
 * The manifest lives in its own module so the registry can import every tool's
 * metadata cheaply (a name, a description, one icon) without pulling in the
 * implementation. The parser below — and the IBAN registry table it carries —
 * is only fetched when the user actually opens this tool.
 */
export { manifest } from './manifest';
export { IbanValidatorTool as default } from './IbanValidatorTool';
