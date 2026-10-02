/**
 * Lazy entry point for this tool.
 *
 * The manifest is a separate module so the registry can import every tool's
 * metadata (a name, a description, one icon) eagerly without pulling in the
 * implementations. The component below, and the Web Crypto calls it makes, are
 * only fetched when the user opens this tool.
 */
export { manifest } from './manifest';
export { OtpGeneratorTool as default } from './OtpGeneratorTool';
