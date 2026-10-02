/**
 * Lazy entry point for this tool.
 *
 * The manifest is a separate module so the registry can import every tool's
 * metadata cheaply (name, description, one icon) without pulling in the
 * implementation. The component below, its ASN.1 reader and the Web Crypto
 * calls it makes are only fetched when the user actually opens this tool.
 */
export { manifest } from './manifest';
export { RsaKeyPairTool as default } from './RsaKeyPairTool';
