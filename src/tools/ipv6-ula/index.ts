/**
 * Lazy entry point for this tool.
 *
 * The manifest is a separate module so the registry can import every tool's
 * metadata cheaply (a name, a description, one icon) without pulling in the
 * implementation. The component below — and the address logic it imports,
 * including the hand-written SHA-1 — is only fetched when this tool is opened.
 */
export { manifest } from './manifest';
export { Ipv6UlaTool as default } from './Ipv6UlaTool';
