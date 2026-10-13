/**
 * Lazy entry point for this tool.
 *
 * The manifest lives in its own module so the registry can read every tool's
 * metadata without pulling in any implementation. The glyph table below is the
 * reason that matters here: it is a few kilobytes of font data that the
 * launcher and the sidebar must never download.
 */
export { manifest } from './manifest';
export { AsciiArtTextTool as default } from './AsciiArtTextTool';
