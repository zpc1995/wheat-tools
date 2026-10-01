import type { ComponentType } from 'react';
import type { ToolCategory } from './categories';

/**
 * Metadata that every tool directory must declare.
 *
 * Layout of a tool directory:
 *
 *   src/tools/<id>/
 *   ├── manifest.ts   metadata only — imported eagerly by the registry
 *   ├── index.ts      lazy entry point: re-exports manifest + default component
 *   └── <Name>Tool.tsx
 *
 * The split exists for bundle size. The registry needs every tool's name,
 * description and icon to render the launcher and the sidebar, but it must not
 * pull in every implementation: with the metadata in its own module, the
 * components (and their dependencies such as the YAML parser or the QR encoder)
 * stay in per-tool chunks that load on demand.
 */
export interface ToolManifest {
  /** Unique, URL-safe id. Used as the route segment: `#/tools/<id>`. */
  id: string;
  /** Display name shown on the launcher card and page title. */
  name: string;
  /** One-line description shown on the launcher card. */
  description: string;
  /** Short keywords shown as tags; also used by the launcher search. */
  tags?: string[];
  /**
   * Sidebar group. `common` and `favorite` are virtual (derived from usage
   * data) and must not be used here. Unknown values fall back to `other`.
   */
  category: ToolCategory;
  /** Fluent icon element rendered on the launcher card. */
  icon?: ComponentType;
  /** Optional author / origin note shown in the tool footer. */
  version?: string;
}

/** The default export shape of a tool's component module. */
export type ToolComponent = ComponentType;

/**
 * A fully resolved, validated tool entry used by the registry.
 *
 * `load` is used instead of a `Component` reference so the implementation is
 * only fetched when a route actually needs it.
 */
export interface RegisteredTool extends ToolManifest {
  /**
   * Fetches the tool component.
   *
   * Returns a promise because the module is a dynamic import; the registry
   * keeps the function rather than the resolved component so the chunk is not
   * requested at startup.
   */
  load: () => Promise<ToolComponent>;
  /**
   * Category after normalisation. Kept separate from the manifest value so a
   * bad value is visible as `other` rather than silently trusted.
   */
  resolvedCategory: ToolCategory;
}
