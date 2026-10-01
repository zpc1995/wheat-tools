import { normalizeCategory } from './categories';
import type { RegisteredTool, ToolComponent, ToolManifest } from './types';

/**
 * Automatic tool registration, split for bundle size.
 *
 * `manifest.ts` files are imported eagerly because they are tiny — a name, a
 * description, a category and one icon — and the launcher, the sidebar and the
 * search all need them immediately to render anything at all.
 *
 * `index.ts` entry points are imported **lazily**: the glob returns loader
 * functions, so each tool's implementation (plus its dependencies, such as the
 * YAML parser or the QR encoder) stays in its own chunk until the tool is
 * opened. Importing them eagerly is what made the single bundle grow past 1 MB.
 *
 * Adding a tool still never requires editing this file.
 */
const manifests = import.meta.glob<{ manifest?: ToolManifest }>('./*/manifest.ts', {
  eager: true,
});

const loaders = import.meta.glob<{ default?: ToolComponent }>('./*/index.ts');

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

  for (const [path, mod] of Object.entries(manifests)) {
    const dir = path.replace(/^\.\//, '').replace(/\/manifest\.ts$/, '');

    if (!isValidManifest(mod.manifest)) {
      problems.push(`${dir}: manifest.ts 缺少合法的 \`manifest\` 导出`);
      continue;
    }

    const manifest = mod.manifest;

    if (manifest.id !== dir) {
      problems.push(
        `${dir}: manifest.id（"${manifest.id}"）必须与目录名一致`,
      );
      continue;
    }

    const clash = seenIds.get(manifest.id);
    if (clash) {
      problems.push(`${dir}: id 重复，已被 ${clash} 使用`);
      continue;
    }

    const loader = loaders[`./${dir}/index.ts`];
    if (!loader) {
      problems.push(`${dir}: 缺少 index.ts 入口，该工具不会被加载`);
      continue;
    }

    seenIds.set(manifest.id, dir);

    collected.push({
      ...manifest,
      resolvedCategory: normalizeCategory(manifest.category),
      // Wrapped so the resolved component is memoised per tool: React would
      // otherwise receive a new promise on every render of a lazy route and
      // remount the tool.
      load: (() => {
        let cached: Promise<ToolComponent> | null = null;
        return () => {
          if (!cached) {
            cached = loader().then((module) => {
              const component = module.default;
              if (typeof component !== 'function') {
                throw new Error(`${dir}: index.ts 没有默认导出组件`);
              }
              return component;
            });
          }
          return cached;
        };
      })(),
    });
  }

  if (problems.length > 0) {
    // Surfaced in the console so a broken new tool is obvious during dev, while
    // the rest of the toolbox keeps working.
    console.warn(
      `[tools] ${problems.length} 个工具模块未能注册：\n` +
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

/**
 * Starts fetching a tool's chunk ahead of time.
 *
 * Called on hover/focus of a launcher card or sidebar row, so the chunk is
 * usually already cached by the time the click lands and the tool appears
 * without a loading state. Failures are ignored on purpose: this is only an
 * optimisation, and the real navigation will surface any error.
 */
export function prefetchTool(id: string): void {
  const tool = getTool(id);
  if (!tool) return;
  void tool.load().catch(() => undefined);
}
