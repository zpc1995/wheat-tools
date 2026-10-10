/**
 * Lazy entry point for this tool.
 *
 * The manifest stays separate so the registry can read the metadata without
 * importing the parser and its sample list; the component loads on demand.
 */
export { manifest } from './manifest';
export { UserAgentParserTool as default } from './UserAgentParserTool';
