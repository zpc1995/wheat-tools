/**
 * Verifies that every tool directory is actually registered.
 *
 * The registry discovers tools by globbing for `./<dir>/index.ts`, so a tool
 * directory without that file is silently invisible in the app — it compiles,
 * type-checks and even passes a per-tool smoke test (which only visits tools
 * that *are* registered), yet users can never open it. That happened once with
 * `text-toolkit`, hence this check.
 *
 * Usage: node scripts/check-registry.mjs
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const TOOLS_DIR = 'src/tools';

const entries = readdirSync(TOOLS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

let problems = 0;

const registered = [];

for (const name of entries) {
  const dir = `${TOOLS_DIR}/${name}`;
  const manifestPath = `${dir}/manifest.ts`;
  const indexPath = `${dir}/index.ts`;

  // Two files are required per tool: the eagerly-imported metadata module and
  // the lazily-imported entry point. A tool missing either one is invisible in
  // the app while still passing type-checks and the per-tool smoke test.
  if (!existsSync(manifestPath)) {
    problems += 1;
    console.log(`FAIL  ${name}  缺少 manifest.ts，该工具不会被注册`);
    continue;
  }
  if (!existsSync(indexPath)) {
    problems += 1;
    console.log(`FAIL  ${name}  缺少 index.ts，该工具的代码无法被加载`);
    continue;
  }

  const manifestSource = readFileSync(manifestPath, 'utf8');
  const indexSource = readFileSync(indexPath, 'utf8');

  // `manifest.id` must equal the directory name: the sidebar and the usage
  // statistics key off the id, so a mismatch would scatter the data.
  const idMatch = /id:\s*'([^']+)'/.exec(manifestSource);
  if (!idMatch) {
    problems += 1;
    console.log(`FAIL  ${name}  manifest.ts 中找不到 manifest.id`);
    continue;
  }
  if (idMatch[1] !== name) {
    problems += 1;
    console.log(
      `FAIL  ${name}  manifest.id 为 "${idMatch[1]}"，必须与目录名一致`,
    );
    continue;
  }

  if (!/category:\s*'[a-z]+'/.test(manifestSource)) {
    problems += 1;
    console.log(`FAIL  ${name}  manifest 缺少 category`);
    continue;
  }

  if (!/^export const manifest/m.test(manifestSource)) {
    problems += 1;
    console.log(`FAIL  ${name}  manifest.ts 没有具名导出 manifest`);
    continue;
  }

  // The entry point must re-export the manifest and a default component, which
  // is the contract the registry's lazy loader relies on.
  if (!/export \{ manifest \} from '\.\/manifest'/.test(indexSource)) {
    problems += 1;
    console.log(`FAIL  ${name}  index.ts 没有从 './manifest' 重新导出 manifest`);
    continue;
  }
  if (!/as default \} from '\.\//.test(indexSource)) {
    problems += 1;
    console.log(`FAIL  ${name}  index.ts 没有默认导出组件`);
    continue;
  }

  // The manifest module must stay free of the implementation import, otherwise
  // it drags the whole tool (and its dependencies) into the eager bundle.
  if (/from '\.\/\w+Tool'/.test(manifestSource)) {
    problems += 1;
    console.log(
      `FAIL  ${name}  manifest.ts 引用了工具组件，会把实现拉进首屏包`,
    );
    continue;
  }

  registered.push(idMatch[1]);
}

// Every id must be unique, or routes would collide.
const duplicates = registered.filter(
  (id, index) => registered.indexOf(id) !== index,
);
if (duplicates.length > 0) {
  problems += 1;
  console.log(`FAIL  重复的工具 id：${[...new Set(duplicates)].join(', ')}`);
}

console.log(
  problems === 0
    ? `PASS  ${entries.length} 个工具目录结构正确（manifest 与实现分离、id 唯一、入口惰性加载）`
    : `\n共 ${problems} 处问题`,
);
process.exit(problems === 0 ? 0 : 1);
