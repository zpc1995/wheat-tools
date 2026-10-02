/**
 * Lazy entry point for this tool.
 *
 * The manifest is a separate module so the registry can import every tool's
 * metadata cheaply (a name, a description, one icon) without pulling in the
 * implementation. The parser below is a few hundred lines of byte handling that
 * most visitors will never use, so it is only fetched when this tool is opened.
 */
export { manifest } from './manifest';
export { PdfSignatureInspectorTool as default } from './PdfSignatureInspectorTool';
