/**
 * Lazy entry point for this tool.
 *
 * The manifest is a separate module so the registry can import every tool's
 * metadata cheaply (a name, a description, one icon) without pulling in the
 * implementation. That matters more than usual here: this tool carries the
 * 13 KB BIP-39 word list, which is imported by the component's utils module and
 * therefore stays in this tool's own chunk, loaded only when the user opens it.
 */
export { manifest } from './manifest';
export { Bip39GeneratorTool as default } from './Bip39GeneratorTool';
