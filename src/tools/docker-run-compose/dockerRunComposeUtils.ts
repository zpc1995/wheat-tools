/**
 * `docker run ...` → `docker-compose.yml`。
 *
 * ## 为什么要先做一次 shell 词法切分
 *
 * 输入是用户在终端里敲的命令行，引号是**shell 的**语法而不是 docker 的：
 * `-e "A=b c"` 是一个参数，`-e A=b c` 是两个。直接 `split(' ')` 会把
 * `"A=b c"` 拆坏，交给 docker 的话环境变量就变成了 `A=b`。所以第一步按
 * POSIX shell 的规矩切词（单引号内全字面、双引号内只认 `\"` `\\` `\$`
 * 反引号转义、引号外反斜杠转义下一个字符），第二步才在词上解析 flag。
 *
 * ## 为什么输出顺序与 flag 书写顺序无关
 *
 * 解析结果先收进 `Map`/`Set`，再按固定的 `SERVICE_KEY_ORDER` 组装对象。
 * 这样 `docker run -p 80:80 -e A=1 img` 与 `docker run -e A=1 -p 80:80 img`
 * 会得到逐字节相同的 YAML —— 用户不会因为调换两个参数就得到一份 diff。
 *
 * ## 明确不做
 *
 * 不连 docker daemon、不校验镜像是否存在、不解析 Dockerfile、不生成除了
 * compose 文件以外的任何东西，也不执行生成的命令。
 */

import { stringify as yamlStringify } from 'yaml';

/* ------------------------------------------------------------------ */
/* 错误                                                                */
/* ------------------------------------------------------------------ */

export interface DockerError {
  message: string;
  /** 出错的那个词。 */
  token?: string;
  /** 该词在命令行里的字符偏移。 */
  index?: number;
  /** 补救建议。 */
  hint?: string;
}

/* ------------------------------------------------------------------ */
/* shell 切词                                                          */
/* ------------------------------------------------------------------ */

export type ShellSplitResult =
  | { ok: true; words: string[] }
  | { ok: false; error: DockerError };

/**
 * 按 POSIX shell 的规则切词。
 *
 * 引号本身不进入结果：`-e "A=b c"` 得到 `-e` 与 `A=b c` 两个词。引号未闭合
 * 时返回错误而不是把剩下的整段吃掉——那样会得到一个看似成功、实际错位的
 * 参数列表。
 */
export function splitShellWords(input: string): ShellSplitResult {
  const words: string[] = [];
  let current = '';
  let started = false;
  let i = 0;

  const flush = () => {
    if (started) {
      words.push(current);
      current = '';
      started = false;
    }
  };

  while (i < input.length) {
    const ch = input[i];

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      flush();
      i += 1;
      continue;
    }

    if (ch === "'") {
      const end = input.indexOf("'", i + 1);
      if (end === -1) {
        return { ok: false, error: { message: '单引号没有闭合', index: i, hint: "补一个 ' 再试" } };
      }
      current += input.slice(i + 1, end);
      started = true;
      i = end + 1;
      continue;
    }

    if (ch === '"') {
      i += 1;
      started = true;
      let closed = false;
      while (i < input.length) {
        const inner = input[i];
        // 双引号里只有这几个字符能被反斜杠转义，`\n` 保持两字符原样。
        if (inner === '\\' && i + 1 < input.length && '"\\$`'.includes(input[i + 1])) {
          current += input[i + 1];
          i += 2;
          continue;
        }
        if (inner === '"') {
          closed = true;
          i += 1;
          break;
        }
        current += inner;
        i += 1;
      }
      if (!closed) {
        return { ok: false, error: { message: '双引号没有闭合', index: i, hint: '补一个 " 再试' } };
      }
      continue;
    }

    if (ch === '\\' && i + 1 < input.length) {
      current += input[i + 1];
      started = true;
      i += 2;
      continue;
    }

    current += ch;
    started = true;
    i += 1;
  }

  flush();
  return { ok: true, words };
}

/* ------------------------------------------------------------------ */
/* flag 表                                                             */
/* ------------------------------------------------------------------ */

interface FlagDef {
  /** 规范化名，同时用于去重与提示。 */
  name: string;
  /** 接受的所有拼写（长短选项）。 */
  forms: string[];
  kind: 'bool' | 'value';
  /** 可重复出现的多值 flag。 */
  multi?: boolean;
  /** 映射到的 compose 服务字段；null 表示只能给提示。 */
  field?: string | null;
  /** 值要当数字写进 YAML。 */
  numeric?: boolean;
  /** 不能映射时的说明。 */
  note?: string;
}

const FLAG_DEFS: FlagDef[] = [
  { name: 'name', forms: ['--name'], kind: 'value', field: 'container_name' },
  { name: 'publish', forms: ['-p', '--publish'], kind: 'value', multi: true, field: 'ports' },
  { name: 'volume', forms: ['-v', '--volume'], kind: 'value', multi: true, field: 'volumes' },
  { name: 'mount', forms: ['--mount'], kind: 'value', multi: true, field: 'volumes' },
  { name: 'env', forms: ['-e', '--env'], kind: 'value', multi: true, field: 'environment' },
  { name: 'env-file', forms: ['--env-file'], kind: 'value', multi: true, field: 'env_file' },
  { name: 'label', forms: ['-l', '--label'], kind: 'value', multi: true, field: 'labels' },
  { name: 'restart', forms: ['--restart'], kind: 'value', field: 'restart' },
  { name: 'network', forms: ['--network', '--net'], kind: 'value', multi: true, field: 'networks' },
  { name: 'hostname', forms: ['-h', '--hostname'], kind: 'value', field: 'hostname' },
  { name: 'entrypoint', forms: ['--entrypoint'], kind: 'value', field: 'entrypoint' },
  { name: 'workdir', forms: ['-w', '--workdir'], kind: 'value', field: 'working_dir' },
  { name: 'user', forms: ['-u', '--user'], kind: 'value', field: 'user' },
  { name: 'privileged', forms: ['--privileged'], kind: 'bool', field: 'privileged' },
  { name: 'cap-add', forms: ['--cap-add'], kind: 'value', multi: true, field: 'cap_add' },
  { name: 'cap-drop', forms: ['--cap-drop'], kind: 'value', multi: true, field: 'cap_drop' },
  { name: 'security-opt', forms: ['--security-opt'], kind: 'value', multi: true, field: 'security_opt' },
  { name: 'group-add', forms: ['--group-add'], kind: 'value', multi: true, field: 'group_add' },
  { name: 'memory', forms: ['-m', '--memory'], kind: 'value', field: 'mem_limit' },
  { name: 'memory-swap', forms: ['--memory-swap'], kind: 'value', field: 'memswap_limit' },
  { name: 'cpus', forms: ['--cpus'], kind: 'value', field: 'cpus', numeric: true },
  { name: 'cpu-shares', forms: ['-c', '--cpu-shares'], kind: 'value', field: 'cpu_shares', numeric: true },
  { name: 'cpuset-cpus', forms: ['--cpuset-cpus'], kind: 'value', field: 'cpuset' },
  { name: 'pids-limit', forms: ['--pids-limit'], kind: 'value', field: 'pids_limit', numeric: true },
  { name: 'shm-size', forms: ['--shm-size'], kind: 'value', field: 'shm_size' },
  { name: 'interactive', forms: ['-i', '--interactive'], kind: 'bool', field: 'stdin_open' },
  { name: 'tty', forms: ['-t', '--tty'], kind: 'bool', field: 'tty' },
  { name: 'init', forms: ['--init'], kind: 'bool', field: 'init' },
  { name: 'read-only', forms: ['--read-only'], kind: 'bool', field: 'read_only' },
  { name: 'detach', forms: ['-d', '--detach'], kind: 'bool', field: null, note: 'compose 里由 `docker compose up -d` 控制，不写进服务定义' },
  { name: 'rm', forms: ['--rm'], kind: 'bool', field: null, note: '容器的一次性语义对应 `docker compose run --rm`，服务定义里没有对应字段' },
  { name: 'publish-all', forms: ['-P', '--publish-all'], kind: 'bool', field: null, note: '随机端口映射没有稳定的 compose 写法' },
  { name: 'attach', forms: ['-a', '--attach'], kind: 'value', multi: true, field: null, note: '只影响前台输出，服务定义里没有对应字段' },
  { name: 'link', forms: ['--link'], kind: 'value', multi: true, field: null, note: 'link 已被 compose 网络取代，请改用 networks 与 service 名' },
  { name: 'gpus', forms: ['--gpus'], kind: 'value', multi: true, field: null, note: 'GPU 需要写成 deploy.resources.reservations.devices，请手工补' },
  { name: 'ip', forms: ['--ip'], kind: 'value', field: null, note: '静态 IP 要写在 networks.<net>.ipv4_address 下，请手工补' },
  { name: 'ip6', forms: ['--ip6'], kind: 'value', field: null, note: '静态 IPv6 要写在 networks.<net>.ipv6_address 下，请手工补' },
  { name: 'sig-proxy', forms: ['--sig-proxy'], kind: 'value', field: null, note: '只影响信号转发，服务定义里没有对应字段' },
  { name: 'mac-address', forms: ['--mac-address'], kind: 'value', field: 'mac_address' },
  { name: 'add-host', forms: ['--add-host'], kind: 'value', multi: true, field: 'extra_hosts' },
  { name: 'dns', forms: ['--dns'], kind: 'value', multi: true, field: 'dns' },
  { name: 'dns-search', forms: ['--dns-search'], kind: 'value', multi: true, field: 'dns_search' },
  { name: 'dns-option', forms: ['--dns-option'], kind: 'value', multi: true, field: 'dns_opt' },
  { name: 'device', forms: ['--device'], kind: 'value', multi: true, field: 'devices' },
  { name: 'device-cgroup-rule', forms: ['--device-cgroup-rule'], kind: 'value', multi: true, field: 'device_cgroup_rules' },
  { name: 'expose', forms: ['--expose'], kind: 'value', multi: true, field: 'expose' },
  { name: 'tmpfs', forms: ['--tmpfs'], kind: 'value', multi: true, field: 'tmpfs' },
  { name: 'volumes-from', forms: ['--volumes-from'], kind: 'value', multi: true, field: 'volumes_from' },
  { name: 'ulimit', forms: ['--ulimit'], kind: 'value', multi: true, field: 'ulimits' },
  { name: 'sysctl', forms: ['--sysctl'], kind: 'value', multi: true, field: 'sysctls' },
  { name: 'platform', forms: ['--platform'], kind: 'value', field: 'platform' },
  { name: 'pull', forms: ['--pull'], kind: 'value', field: 'pull_policy' },
  { name: 'runtime', forms: ['--runtime'], kind: 'value', field: 'runtime' },
  { name: 'userns', forms: ['--userns'], kind: 'value', field: 'userns_mode' },
  { name: 'uts', forms: ['--uts'], kind: 'value', field: 'uts' },
  { name: 'ipc', forms: ['--ipc'], kind: 'value', field: 'ipc' },
  { name: 'pid', forms: ['--pid'], kind: 'value', field: 'pid' },
  { name: 'cgroup-parent', forms: ['--cgroup-parent'], kind: 'value', field: 'cgroup_parent' },
  { name: 'isolation', forms: ['--isolation'], kind: 'value', field: 'isolation' },
  { name: 'stop-signal', forms: ['--stop-signal'], kind: 'value', field: 'stop_signal' },
  { name: 'stop-timeout', forms: ['--stop-timeout'], kind: 'value', field: 'stop_grace_period' },
  { name: 'log-driver', forms: ['--log-driver'], kind: 'value', field: 'logging.driver' },
  { name: 'log-opt', forms: ['--log-opt'], kind: 'value', multi: true, field: 'logging.options' },
  { name: 'health-cmd', forms: ['--health-cmd'], kind: 'value', field: 'healthcheck.test' },
  { name: 'health-interval', forms: ['--health-interval'], kind: 'value', field: 'healthcheck.interval' },
  { name: 'health-timeout', forms: ['--health-timeout'], kind: 'value', field: 'healthcheck.timeout' },
  { name: 'health-retries', forms: ['--health-retries'], kind: 'value', field: 'healthcheck.retries', numeric: true },
  { name: 'health-start-period', forms: ['--health-start-period'], kind: 'value', field: 'healthcheck.start_period' },
  { name: 'no-healthcheck', forms: ['--no-healthcheck'], kind: 'bool', field: 'healthcheck.disable' },
];

/** 拼写 → 定义。 */
const FLAG_BY_FORM = new Map<string, FlagDef>();
for (const def of FLAG_DEFS) {
  for (const form of def.forms) {
    FLAG_BY_FORM.set(form, def);
  }
}

/* ------------------------------------------------------------------ */
/* 解析结果                                                            */
/* ------------------------------------------------------------------ */

export interface ComposeService {
  [key: string]: unknown;
}

export interface ComposeFile {
  services: Record<string, ComposeService>;
  volumes?: Record<string, Record<string, never>>;
  networks?: Record<string, Record<string, never>>;
}

/** 供界面与检查脚本使用的结构化摘要。 */
export interface RunSummary {
  image: string;
  command: string[];
  serviceName: string;
  /** 服务定义，键的排列顺序固定。 */
  service: ComposeService;
  compose: ComposeFile;
  warnings: string[];
}

export type DockerRunResult =
  | ({ ok: true; yaml: string } & RunSummary)
  | { ok: false; error: DockerError };

export interface DockerRunOptions {
  /** 覆盖服务名（默认从 `--name` 或镜像名推导）。 */
  serviceName?: string;
}

/** 服务定义里键的固定顺序，保证 flag 顺序不影响输出。 */
const SERVICE_KEY_ORDER = [
  'image',
  'container_name',
  'hostname',
  'platform',
  'restart',
  'pull_policy',
  'entrypoint',
  'command',
  'working_dir',
  'user',
  'environment',
  'env_file',
  'ports',
  'expose',
  'volumes',
  'volumes_from',
  'tmpfs',
  'networks',
  'dns',
  'dns_search',
  'dns_opt',
  'extra_hosts',
  'mac_address',
  'devices',
  'device_cgroup_rules',
  'privileged',
  'cap_add',
  'cap_drop',
  'security_opt',
  'group_add',
  'read_only',
  'init',
  'stdin_open',
  'tty',
  'ipc',
  'pid',
  'uts',
  'userns_mode',
  'runtime',
  'isolation',
  'cgroup_parent',
  'shm_size',
  'mem_limit',
  'memswap_limit',
  'cpus',
  'cpu_shares',
  'cpuset',
  'pids_limit',
  'ulimits',
  'sysctls',
  'stop_signal',
  'stop_grace_period',
  'logging',
  'healthcheck',
  'labels',
];

/**
 * 嵌套对象的键序也要固定，否则 `--health-interval` 与 `--health-cmd` 的书写
 * 顺序会让 healthcheck 里的键换位置，破坏"flag 顺序无关"这条性质。
 */
const NESTED_KEY_ORDER: Record<string, string[]> = {
  healthcheck: ['test', 'interval', 'timeout', 'retries', 'start_period', 'disable'],
  logging: ['driver', 'options'],
};

/** 按给定顺序重排对象键，未列出的键保持原相对顺序排在后面。 */
function orderKeys(source: Record<string, unknown>, order: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of order) {
    if (Object.prototype.hasOwnProperty.call(source, key)) result[key] = source[key];
  }
  for (const key of Object.keys(source)) {
    if (!Object.prototype.hasOwnProperty.call(result, key)) result[key] = source[key];
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function splitOnce(text: string, separator: string): [string, string] | null {
  const at = text.indexOf(separator);
  if (at === -1) return null;
  return [text.slice(0, at), text.slice(at + separator.length)];
}

/**
 * 切分 `-v` 的规格。
 *
 * Windows 盘符（`C:\data:/data`）里的冒号不是分隔符，先把它并回去再切，
 * 否则会得到 source `C` 这种明显错误的结论。
 */
export function splitVolumeSpec(spec: string): string[] {
  const parts = spec.split(':');
  const looksLikeDrive = /^[A-Za-z]$/.test(parts[0] ?? '') && (parts[1] ?? '').startsWith('\\');
  if (looksLikeDrive && parts.length > 1) {
    return [`${parts[0]}:${parts[1]}`, ...parts.slice(2)];
  }
  return parts;
}

/** 卷的 source 是不是"命名卷"（相对路径与绝对路径都不是）。 */
export function isNamedVolumeSource(source: string): boolean {
  if (source === '') return false;
  if (source.startsWith('/') || source.startsWith('\\')) return false;
  if (source.startsWith('./') || source.startsWith('../') || source === '.' || source === '..') return false;
  if (source.startsWith('~')) return false;
  // `${VAR}` / `$VAR` 是变量展开，交给 compose 处理。
  if (source.startsWith('$')) return false;
  return true;
}

/** 把 `1.5` / `3` 之类的字符串写成 YAML 数字，其余原样。 */
function toNumeric(value: string): number | string {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

/** `key=value` 形式；没有等号时 value 为 true。 */
function splitKeyValue(text: string): [string, string | true] {
  const pair = splitOnce(text, '=');
  return pair === null ? [text, true] : [pair[0], pair[1]];
}

/** 往嵌套对象上按 `a.b` 路径写值。 */
function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let node = root;
  for (const segment of segments.slice(0, -1)) {
    const next = node[segment];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      const created: Record<string, unknown> = {};
      node[segment] = created;
      node = created;
    } else {
      node = next as Record<string, unknown>;
    }
  }
  node[segments[segments.length - 1]] = value;
}

/* ------------------------------------------------------------------ */
/* flag 收集                                                           */
/* ------------------------------------------------------------------ */

interface Collected {
  bools: Set<string>;
  values: Map<string, string[]>;
  /** 每个原样写法出现过一次，用于提示里说清是哪个 flag。 */
  spellings: Map<string, string>;
}

interface ParseWordsResult {
  ok: true;
  collected: Collected;
  /** 镜像之后的词：command 与 args。 */
  command: string[];
  /** 镜像名。 */
  image: string;
  warnings: string[];
  /** 未经 `--` 分隔、直接被当成镜像的那个词的下标。 */
  imageWordIndex: number;
}

const KNOWN_LAUNCHERS = new Set(['docker', 'podman', 'nerdctl']);

/** 去掉命令开头的 `docker run` / `docker container run` / `podman run`。 */
function stripLauncher(
  words: string[],
): { ok: true; rest: string[]; launcherOffset: number } | { ok: false; error: DockerError } {
  let i = 0;
  if (words.length > 0 && KNOWN_LAUNCHERS.has(words[0])) {
    i = 1;
  }
  if (words[i] === 'container') i += 1;
  if (words[i] !== 'run') {
    return {
      ok: false,
      error: {
        message: '只支持 `docker run`（或 `docker container run`）形式的命令',
        token: words[i] ?? '',
        index: i,
        hint: '把 `docker exec` / `docker create` 之类的命令改写成 `docker run ...`',
      },
    };
  }
  return { ok: true, rest: words.slice(i + 1), launcherOffset: i + 1 };
}

function parseWords(words: string[]): ParseWordsResult | { ok: false; error: DockerError } {
  const collected: Collected = { bools: new Set(), values: new Map(), spellings: new Map() };
  const warnings: string[] = [];

  const addValue = (def: FlagDef, spelling: string, value: string) => {
    const list = collected.values.get(def.name) ?? [];
    if (!def.multi && list.length > 0) {
      // docker CLI 的行为就是后者覆盖前者，这里照做并说明。
      warnings.push(`${spelling} 重复出现，按 docker 的行为取最后一个值`);
      list.length = 0;
    }
    list.push(value);
    collected.values.set(def.name, list);
    collected.spellings.set(def.name, spelling);
  };

  let i = 0;
  let image: string | null = null;
  let imageWordIndex = -1;
  const command: string[] = [];
  let afterTerminator = false;

  while (i < words.length) {
    const word = words[i];

    if (image !== null) {
      command.push(word);
      i += 1;
      continue;
    }

    if (!afterTerminator && word === '--') {
      afterTerminator = true;
      i += 1;
      continue;
    }

    if (!afterTerminator && word.startsWith('--') && word.length > 2) {
      const pair = splitOnce(word, '=');
      const spelling = pair === null ? word : pair[0];
      const inlineValue = pair === null ? null : pair[1];
      const def = FLAG_BY_FORM.get(spelling);

      if (def === undefined) {
        warnings.push(`无法识别的选项 ${spelling}，已忽略（生成的 compose 里没有它）`);
        i += 1;
        continue;
      }

      if (def.kind === 'bool') {
        if (inlineValue !== null && !/^(true|false)$/i.test(inlineValue)) {
          return {
            ok: false,
            error: {
              message: `${spelling} 是开关选项，只能写 ${spelling} 或 ${spelling}=true|false`,
              token: word,
              index: i,
            },
          };
        }
        if (inlineValue === null || /^true$/i.test(inlineValue)) collected.bools.add(def.name);
        else collected.bools.delete(def.name);
        collected.spellings.set(def.name, spelling);
        i += 1;
        continue;
      }

      if (inlineValue !== null) {
        addValue(def, spelling, inlineValue);
        i += 1;
        continue;
      }
      const next = words[i + 1];
      if (next === undefined) {
        return {
          ok: false,
          error: { message: `${spelling} 缺少取值`, token: spelling, index: i, hint: `写成 ${spelling} 值 或 ${spelling}=值` },
        };
      }
      addValue(def, spelling, next);
      i += 2;
      continue;
    }

    if (!afterTerminator && word.startsWith('-') && word.length > 1) {
      // 短选项：可能是 `-it` 组合，也可能是 `-p8080:80` 这种值贴在后面。
      let cursor = 1;
      let consumedNext = false;
      while (cursor < word.length) {
        const spelling = `-${word[cursor]}`;
        const def = FLAG_BY_FORM.get(spelling);
        if (def === undefined) {
          warnings.push(`无法识别的选项 ${spelling}（来自 ${word}），已忽略`);
          cursor += 1;
          continue;
        }
        if (def.kind === 'bool') {
          collected.bools.add(def.name);
          collected.spellings.set(def.name, spelling);
          cursor += 1;
          continue;
        }
        const attached = word.slice(cursor + 1);
        if (attached !== '') {
          addValue(def, spelling, attached);
        } else {
          const next = words[i + 1];
          if (next === undefined) {
            return {
              ok: false,
              error: { message: `${spelling} 缺少取值`, token: word, index: i, hint: `写成 ${spelling} 值 或 ${spelling}=值` },
            };
          }
          addValue(def, spelling, next);
          consumedNext = true;
        }
        cursor = word.length;
      }
      i += consumedNext ? 2 : 1;
      continue;
    }

    image = word;
    imageWordIndex = i;
    i += 1;
  }

  if (image === null) {
    return {
      ok: false,
      error: { message: '没有找到镜像名', hint: '命令末尾要写镜像，例如 `docker run -d nginx:1.25`' },
    };
  }

  return { ok: true, collected, command, image, warnings, imageWordIndex };
}

/* ------------------------------------------------------------------ */
/* 服务名                                                              */
/* ------------------------------------------------------------------ */

/**
 * 从镜像名推导服务名。
 *
 * `ghcr.io/acme/api:1.2@sha256:...` → `api`：去掉 registry、去掉 tag 与
 * digest，再把 compose 不接受的字符换成 `-`。
 */
export function serviceNameFromImage(image: string): string {
  let name = image;
  const atDigest = name.indexOf('@');
  if (atDigest !== -1) name = name.slice(0, atDigest);
  const lastSlash = name.lastIndexOf('/');
  if (lastSlash !== -1) name = name.slice(lastSlash + 1);
  const lastColon = name.lastIndexOf(':');
  if (lastColon !== -1) name = name.slice(0, lastColon);
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[-_.]+$/, '');
  return cleaned === '' ? 'service' : cleaned;
}

/* ------------------------------------------------------------------ */
/* 组装服务定义                                                        */
/* ------------------------------------------------------------------ */

function buildEnvironment(values: string[]): unknown {
  // 只要有一个是不带 `=` 的透传写法，就用列表形式：map 里的 null 会被
  // compose 当成"显式置空"，与 `docker run -e KEY` 的语义不同。
  const hasPassthrough = values.some((value) => !value.includes('='));
  if (hasPassthrough) return values.map((value) => value);
  const map: Record<string, string> = {};
  for (const value of values) {
    const pair = splitOnce(value, '=');
    if (pair !== null) map[pair[0]] = pair[1];
  }
  return map;
}

function buildLabels(values: string[], warnings: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const value of values) {
    const pair = splitOnce(value, '=');
    if (pair === null) {
      warnings.push(`标签 ${value} 没有写成 key=value，已忽略`);
      continue;
    }
    map[pair[0]] = pair[1];
  }
  return map;
}

function buildUlimits(values: string[], warnings: string[]): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const value of values) {
    const pair = splitOnce(value, '=');
    if (pair === null) {
      warnings.push(`ulimit ${value} 没有写成 name=soft:hard，已忽略`);
      continue;
    }
    const [soft, hard] = pair[1].includes(':') ? pair[1].split(':') : [pair[1], pair[1]];
    map[pair[0]] = { soft: toNumeric(soft), hard: toNumeric(hard) };
  }
  return map;
}

function buildMapOptions(values: string[], warnings: string[], what: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const value of values) {
    const pair = splitOnce(value, '=');
    if (pair === null) {
      warnings.push(`${what} ${value} 没有写成 key=value，已忽略`);
      continue;
    }
    map[pair[0]] = pair[1];
  }
  return map;
}

/** `--mount type=bind,source=/a,target=/b,readonly` → compose 长语法。 */
function buildMountVolume(spec: string, warnings: string[]): Record<string, unknown> | null {
  const options: Record<string, string | true> = {};
  for (const part of spec.split(',')) {
    if (part === '') continue;
    const [key, value] = splitKeyValue(part);
    options[key] = value;
  }
  const type = options.type;
  const source = options.source ?? options.src;
  const target = options.target ?? options.destination ?? options.dst;
  if (typeof target !== 'string' || target === '') {
    warnings.push(`--mount ${spec} 缺少 target/destination，无法转换，已忽略`);
    return null;
  }
  const volume: Record<string, unknown> = {};
  volume.type = typeof type === 'string' ? type : 'volume';
  if (typeof source === 'string') volume.source = source;
  volume.target = target;
  if (options.readonly === true || options.ro === true) volume.read_only = true;
  if (typeof options.consistency === 'string') volume.consistency = options.consistency;
  if (typeof options['bind-propagation'] === 'string') {
    volume.bind = { propagation: options['bind-propagation'] };
  }
  if (options['volume-nocopy'] === true) {
    volume.volume = { nocopy: true };
  }
  const unknown = Object.keys(options).filter(
    (key) =>
      ![
        'type',
        'source',
        'src',
        'target',
        'destination',
        'dst',
        'readonly',
        'ro',
        'consistency',
        'bind-propagation',
        'volume-nocopy',
      ].includes(key),
  );
  if (unknown.length > 0) {
    warnings.push(`--mount 里的 ${unknown.join(', ')} 没有对应的 compose 字段，已忽略`);
  }
  return volume;
}

/* ------------------------------------------------------------------ */
/* 主入口                                                              */
/* ------------------------------------------------------------------ */

export function dockerRunToCompose(input: string, options: DockerRunOptions = {}): DockerRunResult {
  const split = splitShellWords(input);
  if (!split.ok) return split;

  if (split.words.length === 0) {
    return { ok: false, error: { message: '命令是空的', hint: '粘贴一条 `docker run ...` 命令' } };
  }

  const stripped = stripLauncher(split.words);
  if (!stripped.ok) return stripped;

  const parsed = parseWords(stripped.rest);
  if (!parsed.ok) return parsed;

  const warnings = [...parsed.warnings];
  const { collected } = parsed;

  const service: Record<string, unknown> = { image: parsed.image };
  const namedVolumes = new Set<string>();
  const namedNetworks = new Set<string>();

  const valuesOf = (name: string): string[] => collected.values.get(name) ?? [];

  // 未映射的 flag：认出来了但要明确告诉用户它没有进 compose。
  for (const def of FLAG_DEFS) {
    const used = collected.bools.has(def.name) || collected.values.has(def.name);
    if (!used) continue;
    if (def.field === null) {
      warnings.push(`${collected.spellings.get(def.name) ?? def.forms[0]}：${def.note ?? '没有对应的 compose 字段'}`);
    }
  }

  const setField = (field: string, value: unknown) => {
    if (value === undefined) return;
    // 空的映射没有任何意义（例如所有 `-l` 都没写成 key=value），写出去只会
    // 让 YAML 里多一个 `labels: {}`，看起来像"用户显式要了空标签"。
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    ) {
      return;
    }
    setPath(service, field, value);
  };

  // 单值字段
  const single: Array<[string, string]> = [
    ['name', 'container_name'],
    ['hostname', 'hostname'],
    ['platform', 'platform'],
    ['restart', 'restart'],
    ['pull', 'pull_policy'],
    ['entrypoint', 'entrypoint'],
    ['workdir', 'working_dir'],
    ['user', 'user'],
    ['runtime', 'runtime'],
    ['userns', 'userns_mode'],
    ['uts', 'uts'],
    ['ipc', 'ipc'],
    ['pid', 'pid'],
    ['cgroup-parent', 'cgroup_parent'],
    ['isolation', 'isolation'],
    ['shm-size', 'shm_size'],
    ['memory', 'mem_limit'],
    ['memory-swap', 'memswap_limit'],
    ['cpuset-cpus', 'cpuset'],
    ['mac-address', 'mac_address'],
    ['stop-signal', 'stop_signal'],
    ['stop-timeout', 'stop_grace_period'],
    ['log-driver', 'logging.driver'],
  ];
  for (const [flagName, field] of single) {
    const list = valuesOf(flagName);
    if (list.length > 0) setField(field, list[list.length - 1]);
  }

  // 开关字段
  const booleanFields: Array<[string, string]> = [
    ['privileged', 'privileged'],
    ['read-only', 'read_only'],
    ['init', 'init'],
    ['interactive', 'stdin_open'],
    ['tty', 'tty'],
  ];
  for (const [flagName, field] of booleanFields) {
    if (collected.bools.has(flagName)) setField(field, true);
  }
  if (collected.bools.has('no-healthcheck')) {
    setPath(service, 'healthcheck.disable', true);
  }

  // 数字字段
  for (const [flagName, field] of [
    ['cpus', 'cpus'],
    ['cpu-shares', 'cpu_shares'],
    ['pids-limit', 'pids_limit'],
  ] as Array<[string, string]>) {
    const list = valuesOf(flagName);
    if (list.length > 0) setField(field, toNumeric(list[list.length - 1]));
  }
  const retries = valuesOf('health-retries');
  if (retries.length > 0) setPath(service, 'healthcheck.retries', toNumeric(retries[retries.length - 1]));

  // 列表字段
  const listFields: Array<[string, string]> = [
    ['publish', 'ports'],
    ['env-file', 'env_file'],
    ['network', 'networks'],
    ['cap-add', 'cap_add'],
    ['cap-drop', 'cap_drop'],
    ['security-opt', 'security_opt'],
    ['group-add', 'group_add'],
    ['add-host', 'extra_hosts'],
    ['dns', 'dns'],
    ['dns-search', 'dns_search'],
    ['dns-option', 'dns_opt'],
    ['device', 'devices'],
    ['device-cgroup-rule', 'device_cgroup_rules'],
    ['expose', 'expose'],
    ['tmpfs', 'tmpfs'],
    ['volumes-from', 'volumes_from'],
  ];
  for (const [flagName, field] of listFields) {
    const list = valuesOf(flagName);
    if (list.length > 0) setField(field, [...list]);
  }
  // `docker run --network foo` 里的 foo 是既存网络名；compose 要求先在顶层
  // networks 里声明再引用，否则 `docker compose up` 会直接报"未定义网络"。
  for (const network of valuesOf('network')) namedNetworks.add(network);

  // 环境变量
  const env = valuesOf('env');
  if (env.length > 0) setField('environment', buildEnvironment(env));

  // 标签
  const labels = valuesOf('label');
  if (labels.length > 0) setField('labels', buildLabels(labels, warnings));

  // 卷：`-v` 的字符串形式与 `--mount` 的长语法可以混用。
  const volumeEntries: unknown[] = [];
  for (const spec of valuesOf('volume')) {
    volumeEntries.push(spec);
    const parts = splitVolumeSpec(spec);
    if (parts.length >= 2 && isNamedVolumeSource(parts[0])) namedVolumes.add(parts[0]);
  }
  for (const spec of valuesOf('mount')) {
    const volume = buildMountVolume(spec, warnings);
    if (volume === null) continue;
    volumeEntries.push(volume);
    if (volume.type === 'volume' && typeof volume.source === 'string' && isNamedVolumeSource(volume.source)) {
      namedVolumes.add(volume.source);
    }
  }
  if (volumeEntries.length > 0) setField('volumes', volumeEntries);

  // ulimit / sysctl / logging.options
  const ulimits = valuesOf('ulimit');
  if (ulimits.length > 0) setField('ulimits', buildUlimits(ulimits, warnings));
  const sysctls = valuesOf('sysctl');
  if (sysctls.length > 0) setField('sysctls', buildMapOptions(sysctls, warnings, 'sysctl'));
  const logOpts = valuesOf('log-opt');
  if (logOpts.length > 0) {
    setPath(service, 'logging.options', buildMapOptions(logOpts, warnings, 'log-opt'));
  }

  // healthcheck
  const healthCmd = valuesOf('health-cmd');
  if (healthCmd.length > 0) {
    // docker 用 CMD-SHELL 执行 --health-cmd，compose 要写出同一件事。
    setPath(service, 'healthcheck.test', ['CMD-SHELL', healthCmd[healthCmd.length - 1]]);
  }
  for (const [flagName, field] of [
    ['health-interval', 'healthcheck.interval'],
    ['health-timeout', 'healthcheck.timeout'],
    ['health-start-period', 'healthcheck.start_period'],
  ] as Array<[string, string]>) {
    const list = valuesOf(flagName);
    if (list.length > 0) setPath(service, field, list[list.length - 1]);
  }

  // command：镜像之后的全部词，始终写成列表，避免被 shell 再解释一次。
  if (parsed.command.length > 0) setField('command', [...parsed.command]);

  // 按固定顺序重排键。
  for (const [key, order] of Object.entries(NESTED_KEY_ORDER)) {
    const nested = service[key];
    if (typeof nested === 'object' && nested !== null && !Array.isArray(nested)) {
      service[key] = orderKeys(nested as Record<string, unknown>, order);
    }
  }
  const orderedService: ComposeService = orderKeys(service, SERVICE_KEY_ORDER);

  // 服务名
  let serviceName = options.serviceName ?? '';
  if (serviceName === '') {
    const containerName = valuesOf('name');
    const base = containerName.length > 0 ? containerName[containerName.length - 1] : serviceNameFromImage(parsed.image);
    serviceName = base
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '-')
      .replace(/^[^a-z0-9]+/, '');
    if (serviceName === '') serviceName = 'service';
    if (serviceName !== base) {
      warnings.push(`服务名 ${base} 含 compose 不接受的字符，改用 ${serviceName}`);
    }
  }

  const compose: ComposeFile = { services: { [serviceName]: orderedService } };
  if (namedVolumes.size > 0) {
    const declared: Record<string, Record<string, never>> = {};
    for (const name of [...namedVolumes].sort()) declared[name] = {};
    compose.volumes = declared;
    warnings.push(`命名卷 ${[...namedVolumes].sort().join('、')} 已在顶层 volumes 里声明（compose 要求先声明再使用）`);
  }
  if (namedNetworks.size > 0) {
    const declared: Record<string, Record<string, never>> = {};
    for (const name of [...namedNetworks].sort()) declared[name] = {};
    compose.networks = declared;
    warnings.push(`网络 ${[...namedNetworks].sort().join('、')} 已在顶层 networks 里声明（compose 要求先声明再使用）`);
  }

  const yaml = yamlStringify(compose, { lineWidth: 0 });

  return {
    ok: true,
    yaml,
    image: parsed.image,
    command: parsed.command,
    serviceName,
    service: orderedService,
    compose,
    warnings,
  };
}

/** 只要 YAML 文本时的便捷入口。 */
export function toComposeYaml(input: string, options: DockerRunOptions = {}): string {
  const result = dockerRunToCompose(input, options);
  return result.ok ? result.yaml : '';
}

export const DOCKER_RUN_SAMPLE =
  'docker run -d --name web --restart unless-stopped -p 8080:80 -p 8443:443 ' +
  '-v /srv/site:/usr/share/nginx/html:ro -v nginx-cache:/var/cache/nginx ' +
  "-e TZ=Asia/Shanghai -e \"GREETING=hello world\" -e API_KEY --env-file .env " +
  '--network appnet --hostname web --cap-drop ALL --cap-add NET_BIND_SERVICE ' +
  '--memory 512m --cpus 1.5 --label com.example.role=frontend ' +
  "--health-cmd 'curl -fsS http://localhost/healthz' --health-interval 30s --health-retries 3 " +
  'nginx:1.25 nginx -g "daemon off;"';
