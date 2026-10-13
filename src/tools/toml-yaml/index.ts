/**
 * Lazy entry point for this tool.
 *
 * The manifest is a separate module so the registry can import every tool's
 * metadata cheaply (a name, a description, one icon) without pulling in the
 * implementation. The component below — together with the TOML parser and the
 * YAML dependency it carries — is only fetched when the user opens this tool.
 */
export { manifest } from './manifest';
export { TomlYamlTool as default } from './TomlYamlTool';
