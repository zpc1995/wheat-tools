import type { ComponentType } from 'react';
import type { ToolCategory } from './categories';

/**
 * Metadata that every tool module must declare.
 *
 * A tool is a self-contained directory under `src/tools/<tool-id>/` that
 * exports its manifest (and its React component) from `index.ts`.
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

/** A fully resolved, validated tool entry used by the registry. */
export interface RegisteredTool extends ToolManifest {
  Component: ToolComponent;
  /**
   * Category after normalisation. Kept separate from the manifest value so a
   * bad value is visible as `other` rather than silently trusted.
   */
  resolvedCategory: ToolCategory;
}
