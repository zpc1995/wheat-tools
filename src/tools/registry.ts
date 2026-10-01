import type { RegisteredTool, ToolComponent, ToolManifest } from './types';

/** Shape a tool's `index.ts` is expected to expose. */
interface ToolModule {
  manifest?: ToolManifest;
  default?: ToolComponent;
}

/**
 * Automatic tool registration.
 *
 * Every directory under `src/tools/<id>/` that exposes an `index.ts` with a
 * named `manifest` export and a default-exported component is picked up here.
 * Adding a new tool therefore never requires editing this file or the router.
 */
const modules = import.meta.glob<ToolModule>('./*/index.ts', { eager: true });

function isValidManifest(value: unknown): value is ToolManifest {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    m.id.length > 0 &&
    typeof m.name === 'string' &&
    m.name.length > 0 &&
    typeof m.description === 'string'
  );
}

function loadTools(): RegisteredTool[] {
  const collected: RegisteredTool[] = [];
  const problems: string[] = [];
  const seenIds = new Map<string, string>();

  for (const [path, mod] of Object.entries(modules)) {
    const dir = path.replace(/^\.\//, '').replace(/\/index\.ts$/, '');

    if (!isValidManifest(mod.manifest)) {
      problems.push(`${dir}: missing or invalid \`manifest\` export`);
      continue;
    }
    if (typeof mod.default !== 'function') {
      problems.push(`${dir}: missing default-exported React component`);
      continue;
    }
    if (mod.manifest.id !== dir) {
      problems.push(
        `${dir}: manifest.id ("${mod.manifest.id}") must match its directory name`,
      );
      continue;
    }
    const clash = seenIds.get(mod.manifest.id);
    if (clash) {
      problems.push(`${dir}: duplicate id, already used by ${clash}`);
      continue;
    }
    seenIds.set(mod.manifest.id, dir);

    collected.push({ ...mod.manifest, Component: mod.default });
  }

  if (problems.length > 0) {
    // Surfaced in the console so a broken new tool is obvious during dev,
    // while the rest of the toolbox keeps working.
    console.warn(
      `[tools] ${problems.length} tool module(s) could not be registered:\n` +
        problems.map((p) => `  • ${p}`).join('\n'),
    );
  }

  return collected.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

/** All successfully registered tools, sorted by name. */
export const tools: RegisteredTool[] = loadTools();

/** Look up one tool by its manifest id. */
export function getTool(id: string | undefined): RegisteredTool | undefined {
  if (!id) return undefined;
  return tools.find((tool) => tool.id === id);
}
