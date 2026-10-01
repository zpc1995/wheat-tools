/**
 * Lazy entry point for this tool.
 *
 * The manifest is a separate module so the registry can import every tool's
 * metadata cheaply (a name, a description, one icon) without pulling in the
 * implementation. The component below — and its dependencies — is only fetched
 * when the user actually opens this tool, which is what keeps the initial
 * bundle from growing with every tool added.
 */
export { manifest } from './manifest';
export { OnlineClockTool as default } from './OnlineClockTool';
