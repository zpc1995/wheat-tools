/**
 * Lazy entry point for this tool.
 *
 * The manifest is a separate module so the registry can import every tool's
 * metadata cheaply (a name, a description, one icon) without pulling in the
 * implementation. The component below — and the XML parser it imports — is only
 * fetched when the user actually opens this tool.
 */
export { manifest } from './manifest';
export { XmlFormatterTool as default } from './XmlFormatterTool';
