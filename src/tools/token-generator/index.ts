/**
 * Lazy entry point for this tool.
 *
 * The manifest is a separate module so the registry can import every tool's
 * metadata cheaply, without pulling in the implementation. The component — and
 * its dependencies — is only fetched when the user opens this tool.
 */
export { manifest } from './manifest';
export { TokenGeneratorTool as default } from './TokenGeneratorTool';
