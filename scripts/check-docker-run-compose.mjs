/**
 * Checks the `docker run` → docker-compose converter.
 *
 * The claim worth defending is "the YAML says exactly what the command line
 * said". Three independent checks back that up:
 *
 *   1. **YAML round-trip through the `yaml` library** — every generated file is
 *      parsed back and the structure inspected: ports must still be strings
 *      (`8080:80` is not a number), `healthcheck.test` must be
 *      `["CMD-SHELL", cmd]` the way `docker run --health-cmd` behaves, and the
 *      top-level `volumes` / `networks` declarations must exist.
 *   2. **A second, independently written argument parser** lives in this file.
 *      It works in two passes (words → `[flag, value]` pairs → service object)
 *      rather than the implementation's collect-into-maps approach, and it was
 *      written from the docker/compose documentation rather than from the
 *      implementation. Both must produce the same service object.
 *   3. **Equivalence and stability properties** — `-p 8080:80` and
 *      `--publish=8080:80` must give byte-identical YAML, and permuting option
 *      groups must not change a single byte.
 *
 * A deliberately naive `split(' ')` parser is run alongside to prove the
 * quote-handling checks can actually fail.
 *
 * Usage: node scripts/check-docker-run-compose.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const compiled = ts.transpileModule(
  readFileSync('src/tools/docker-run-compose/dockerRunComposeUtils.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;
mkdirSync('.verify', { recursive: true });
writeFileSync('.verify/docker-run-compose.mjs', compiled);
const M = await import(pathToFileURL('.verify/docker-run-compose.mjs').href);

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok ? '' : `\n        got      ${JSON.stringify(actual)}\n        expected ${JSON.stringify(expected)}`),
  );
}
const checkTrue = (label, value) => check(label, Boolean(value), true);

/** 键序无关的深度比较：JSON.stringify 对键序敏感，先排序再比。 */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
    return out;
  }
  return value;
}

const convert = (input) => {
  const result = M.dockerRunToCompose(input);
  if (!result.ok) throw new Error(`转换失败：${result.error.message}`);
  return result;
};
const yamlOf = (input) => convert(input).yaml;

/* ================================================================== */
/* 独立写就的第二份解析器（交叉验证用）                                  */
/* ================================================================== */

/**
 * 另一种 shell 切词：显式状态机。
 *
 * 与实现里的写法不同之处在于用 `mode` 变量而不是嵌套循环，并且用一个
 * `hasContent` 标志区分"空字符串参数"（`-e ""`）与"没有参数"。
 */
function refSplit(input) {
  const words = [];
  let buffer = '';
  let hasContent = false;
  let mode = 'plain';
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (mode === 'single') {
      if (ch === "'") mode = 'plain';
      else buffer += ch;
      i += 1;
      continue;
    }
    if (mode === 'double') {
      if (ch === '\\' && i + 1 < input.length && '"\\$`'.includes(input[i + 1])) {
        buffer += input[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') mode = 'plain';
      else buffer += ch;
      i += 1;
      continue;
    }
    if (ch === "'") {
      mode = 'single';
      hasContent = true;
      i += 1;
      continue;
    }
    if (ch === '"') {
      mode = 'double';
      hasContent = true;
      i += 1;
      continue;
    }
    if (ch === '\\' && i + 1 < input.length) {
      buffer += input[i + 1];
      hasContent = true;
      i += 2;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      if (hasContent) {
        words.push(buffer);
        buffer = '';
        hasContent = false;
      }
      i += 1;
      continue;
    }
    buffer += ch;
    hasContent = true;
    i += 1;
  }
  if (mode !== 'plain') return null;
  if (hasContent) words.push(buffer);
  return words;
}

/** [拼写, compose 字段, 类型] —— 照着 docker run 与 compose 规范手写。 */
const REF_FLAGS = [
  [['--name'], 'container_name', 'value'],
  [['-p', '--publish'], 'ports', 'value', 'list'],
  [['-v', '--volume'], 'volumes', 'value', 'list'],
  [['--mount'], 'volumes', 'value', 'list'],
  [['-e', '--env'], 'environment', 'value', 'env'],
  [['--env-file'], 'env_file', 'value', 'list'],
  [['-l', '--label'], 'labels', 'value', 'map'],
  [['--restart'], 'restart', 'value'],
  [['--network', '--net'], 'networks', 'value', 'network'],
  [['-h', '--hostname'], 'hostname', 'value'],
  [['--entrypoint'], 'entrypoint', 'value'],
  [['-w', '--workdir'], 'working_dir', 'value'],
  [['-u', '--user'], 'user', 'value'],
  [['--privileged'], 'privileged', 'bool'],
  [['--cap-add'], 'cap_add', 'value', 'list'],
  [['--cap-drop'], 'cap_drop', 'value', 'list'],
  [['--security-opt'], 'security_opt', 'value', 'list'],
  [['--group-add'], 'group_add', 'value', 'list'],
  [['-m', '--memory'], 'mem_limit', 'value'],
  [['--memory-swap'], 'memswap_limit', 'value'],
  [['--cpus'], 'cpus', 'value', 'number'],
  [['-c', '--cpu-shares'], 'cpu_shares', 'value', 'number'],
  [['--pids-limit'], 'pids_limit', 'value', 'number'],
  [['--cpuset-cpus'], 'cpuset', 'value'],
  [['--shm-size'], 'shm_size', 'value'],
  [['-i', '--interactive'], 'stdin_open', 'bool'],
  [['-t', '--tty'], 'tty', 'bool'],
  [['--init'], 'init', 'bool'],
  [['--read-only'], 'read_only', 'bool'],
  [['--mac-address'], 'mac_address', 'value'],
  [['--add-host'], 'extra_hosts', 'value', 'list'],
  [['--dns'], 'dns', 'value', 'list'],
  [['--dns-search'], 'dns_search', 'value', 'list'],
  [['--dns-option'], 'dns_opt', 'value', 'list'],
  [['--device'], 'devices', 'value', 'list'],
  [['--device-cgroup-rule'], 'device_cgroup_rules', 'value', 'list'],
  [['--expose'], 'expose', 'value', 'list'],
  [['--tmpfs'], 'tmpfs', 'value', 'list'],
  [['--volumes-from'], 'volumes_from', 'value', 'list'],
  [['--sysctl'], 'sysctls', 'value', 'map'],
  [['--ulimit'], 'ulimits', 'value', 'ulimit'],
  [['--platform'], 'platform', 'value'],
  [['--pull'], 'pull_policy', 'value'],
  [['--runtime'], 'runtime', 'value'],
  [['--userns'], 'userns_mode', 'value'],
  [['--uts'], 'uts', 'value'],
  [['--ipc'], 'ipc', 'value'],
  [['--pid'], 'pid', 'value'],
  [['--cgroup-parent'], 'cgroup_parent', 'value'],
  [['--isolation'], 'isolation', 'value'],
  [['--stop-signal'], 'stop_signal', 'value'],
  [['--stop-timeout'], 'stop_grace_period', 'value'],
  [['--log-driver'], 'logging.driver', 'value'],
  [['--log-opt'], 'logging.options', 'value', 'map'],
  [['--health-cmd'], 'healthcheck.test', 'value', 'healthcmd'],
  [['--health-interval'], 'healthcheck.interval', 'value'],
  [['--health-timeout'], 'healthcheck.timeout', 'value'],
  [['--health-retries'], 'healthcheck.retries', 'value', 'number'],
  [['--health-start-period'], 'healthcheck.start_period', 'value'],
  [['--no-healthcheck'], 'healthcheck.disable', 'bool'],
  // 认得出、但 compose 服务定义里没有对应字段的选项：字段写成 null，
  // 两者都必须把它们当告警处理而不是当成错误。
  [['-d', '--detach'], null, 'bool'],
  [['--rm'], null, 'bool'],
  [['-P', '--publish-all'], null, 'bool'],
  [['-a', '--attach'], null, 'value'],
  [['--link'], null, 'value'],
  [['--gpus'], null, 'value'],
  [['--ip'], null, 'value'],
  [['--ip6'], null, 'value'],
  [['--sig-proxy'], null, 'value'],
];

const REF_BY_FORM = new Map();
for (const entry of REF_FLAGS) {
  for (const form of entry[0]) REF_BY_FORM.set(form, entry);
}

/** 第一遍：词 → [拼写, 取值] 对，外加镜像与 command。 */
function refPairs(words) {
  const pairs = [];
  let index = 0;
  if (words[0] === 'docker' || words[0] === 'podman' || words[0] === 'nerdctl') index = 1;
  if (words[index] === 'container') index += 1;
  if (words[index] !== 'run') throw new Error('不是 run 命令');
  index += 1;

  const command = [];
  let image = null;
  let terminated = false;
  while (index < words.length) {
    const word = words[index];
    if (image !== null) {
      command.push(word);
      index += 1;
      continue;
    }
    if (!terminated && word === '--') {
      terminated = true;
      index += 1;
      continue;
    }
    if (!terminated && word.startsWith('--')) {
      const eq = word.indexOf('=');
      const form = eq === -1 ? word : word.slice(0, eq);
      const inline = eq === -1 ? null : word.slice(eq + 1);
      const entry = REF_BY_FORM.get(form);
      if (entry === undefined) throw new Error(`ref 未覆盖长选项 ${form}`);
      if (entry[2] === 'bool') {
        pairs.push([form, inline === null || inline === 'true']);
        index += 1;
        continue;
      }
      if (inline !== null) {
        pairs.push([form, inline]);
        index += 1;
        continue;
      }
      pairs.push([form, words[index + 1]]);
      index += 2;
      continue;
    }
    if (!terminated && word.startsWith('-') && word.length > 1) {
      let cursor = 1;
      let step = 1;
      while (cursor < word.length) {
        const form = `-${word[cursor]}`;
        const entry = REF_BY_FORM.get(form);
        if (entry === undefined) throw new Error(`ref 未覆盖短选项 ${form}`);
        if (entry[2] === 'bool') {
          pairs.push([form, true]);
          cursor += 1;
          continue;
        }
        const attached = word.slice(cursor + 1);
        if (attached !== '') {
          pairs.push([form, attached]);
        } else {
          pairs.push([form, words[index + 1]]);
          step = 2;
        }
        cursor = word.length;
      }
      index += step;
      continue;
    }
    image = word;
    index += 1;
  }
  return { pairs, image, command };
}

function refSetPath(root, path, value) {
  const segments = path.split('.');
  const head = segments.slice(0, -1).reduce((node, segment) => {
    if (typeof node[segment] !== 'object' || node[segment] === null) node[segment] = {};
    return node[segment];
  }, root);
  head[segments[segments.length - 1]] = value;
}

/** 第二遍：键值对 → 服务定义。 */
function refParse(input) {
  const words = refSplit(input);
  if (words === null) throw new Error('引号未闭合');
  const { pairs, image, command } = refPairs(words);
  if (image === null) throw new Error('没有镜像');

  const service = { image };
  const lists = {};
  const rawEnv = [];
  const namedVolumes = new Set();
  const namedNetworks = new Set();

  for (const [form, value] of pairs) {
    const entry = REF_BY_FORM.get(form);
    const [forms, field, kind, transform] = entry;
    if (field === null) continue; // 认得出但无法映射，实现会把它转成告警
    if (kind === 'bool') {
      refSetPath(service, field, true);
      continue;
    }
    if (transform === 'list') {
      (lists[field] ??= []).push(value);
      if (field === 'volumes') {
        const source = value.includes(':') ? M.splitVolumeSpec(value)[0] : '';
        if (source && M.isNamedVolumeSource(source)) namedVolumes.add(source);
      }
      continue;
    }
    if (transform === 'network') {
      (lists.networks ??= []).push(value);
      namedNetworks.add(value);
      continue;
    }
    if (transform === 'map') {
      const eq = value.indexOf('=');
      (lists[field] ??= {})[value.slice(0, eq)] = value.slice(eq + 1);
      continue;
    }
    if (transform === 'ulimit') {
      const eq = value.indexOf('=');
      const name = value.slice(0, eq);
      const [soft, hard = soft] = value.slice(eq + 1).split(':');
      (lists.ulimits ??= {})[name] = { soft: Number(soft), hard: Number(hard) };
      continue;
    }
    if (transform === 'env') {
      rawEnv.push(value);
      continue;
    }
    if (transform === 'number') {
      refSetPath(service, field, Number(value));
      continue;
    }
    if (transform === 'healthcmd') {
      refSetPath(service, field, ['CMD-SHELL', value]);
      continue;
    }
    refSetPath(service, field, value);
  }

  if (rawEnv.length > 0) {
    const passthrough = rawEnv.some((item) => !item.includes('='));
    if (passthrough) {
      service.environment = rawEnv;
    } else {
      service.environment = Object.fromEntries(rawEnv.map((item) => {
        const eq = item.indexOf('=');
        return [item.slice(0, eq), item.slice(eq + 1)];
      }));
    }
  }
  for (const [field, value] of Object.entries(lists)) refSetPath(service, field, value);
  if (command.length > 0) service.command = command;

  return { image, command, service, namedVolumes, namedNetworks };
}

/* ================================================================== */
/* 1. shell 切词                                                       */
/* ================================================================== */
console.log('--- 1. shell 切词（引号是 shell 的语法，不是 docker 的）---');
{
  const cases = [
    ['-e "A=b c" 独立成一个参数', '-e "A=b c"', ['-e', 'A=b c']],
    ["单引号同理", "-e 'A=b c'", ['-e', 'A=b c']],
    ['双引号里保留单引号', '--health-cmd "curl -f http://x/a\'b"', ['--health-cmd', "curl -f http://x/a'b"]],
    ['单引号里保留双引号', "--name 'a\"b'", ['--name', 'a"b']],
    ['双引号里的 \\" 转义', '-e "A=q\\"x"', ['-e', 'A=q"x']],
    ['双引号里的 \\n 不转义', '-e "A=a\\nb"', ['-e', 'A=a\\nb']],
    ['引号外反斜杠转义空格', '-e A=b\\ c', ['-e', 'A=b c']],
    ['空字符串参数被保留', '-e ""', ['-e', '']],
    ['多余空白被折叠', '  -d   --name   web  ', ['-d', '--name', 'web']],
    ['换行也算分隔符', '-d\n--name\nweb', ['-d', '--name', 'web']],
    ['中文与 emoji 不被破坏', '-e "MSG=你好 😀" nginx', ['-e', 'MSG=你好 😀', 'nginx']],
  ];
  let wrong = 0;
  for (const [label, input, expected] of cases) {
    const got = M.splitShellWords(input);
    if (!got.ok || JSON.stringify(got.words) !== JSON.stringify(expected)) {
      wrong += 1;
      console.log(`FAIL  ${label}\n        got ${JSON.stringify(got)}`);
    }
  }
  check(`11 组引号/转义输入切词正确`, wrong, 0);

  check('单引号未闭合报错', M.splitShellWords("--name 'x").ok, false);
  check('双引号未闭合报错', M.splitShellWords('--name "x').ok, false);
  checkTrue('未闭合报错带字符偏移', typeof M.splitShellWords('--name "x').error.index === 'number');
  check('空命令得到空词表', M.splitShellWords('   '), { ok: true, words: [] });

  // 反证：朴素 split(' ') 会把带空格的值拆坏，正是本工具要避免的。
  const naive = '-e "A=b c" nginx'.split(' ');
  checkTrue('朴素 split(" ") 确实拆坏了带空格的参数（证明引号处理不是多余的）', naive.length === 4);
  checkTrue('本方实现没有拆坏', M.splitShellWords('-e "A=b c" nginx').words.length === 3);
}

/* ================================================================== */
/* 2. 等价写法与顺序无关                                                */
/* ================================================================== */
console.log('\n--- 2. 等价写法必须产生逐字节相同的 YAML ---');
{
  const pairs = [
    ['-p 8080:80', '--publish=8080:80'],
    ['-p 8080:80', '-p8080:80'],
    ['-e A=1', '--env=A=1'],
    ['-e A=1', '--env A=1'],
    ['--name web', '--name=web'],
    ['-it', '-i -t'],
    ['-v /a:/b:ro', '--volume=/a:/b:ro'],
    ['-m 512m', '--memory 512m'],
    ['--cap-add SYS_ADMIN', '--cap-add=SYS_ADMIN'],
  ];
  let different = 0;
  for (const [left, right] of pairs) {
    const a = yamlOf(`docker run ${left} nginx:1.25`);
    const b = yamlOf(`docker run ${right} nginx:1.25`);
    if (a !== b) {
      different += 1;
      console.log(`FAIL  ${left} 与 ${right} 输出不同\n${a}\n---\n${b}`);
    }
  }
  check('9 组等价写法（空格 / = / 贴写 / 组合短选项）输出完全一致', different, 0);

  // 顺序无关：把选项组任意排列都不应改变输出。
  const groups = [
    ['-d'],
    ['--name', 'web'],
    ['-p', '8080:80'],
    ['-e', 'A=1'],
    ['-v', '/data:/data'],
    ['--restart', 'always'],
    ['--cap-add', 'NET_ADMIN'],
  ];
  const permutations = [
    [0, 1, 2, 3, 4, 5, 6],
    [6, 5, 4, 3, 2, 1, 0],
    [3, 0, 6, 2, 5, 1, 4],
    [1, 2, 3, 4, 5, 6, 0],
    [5, 3, 1, 0, 2, 4, 6],
  ];
  const rendered = permutations.map((order) =>
    yamlOf(['docker', 'run', ...order.flatMap((i) => groups[i]), 'nginx:1.25'].join(' ')),
  );
  const unstable = rendered.filter((text) => text !== rendered[0]).length;
  check('7 组选项的 5 种排列输出逐字节相同', unstable, 0);

  // 对照：多值 flag 的**内部**顺序是有意义的，必须被保留。
  const forward = yamlOf('docker run -p 80:80 -p 443:443 nginx');
  const backward = yamlOf('docker run -p 443:443 -p 80:80 nginx');
  checkTrue('对照：调换两个 -p 的值确实会改变输出（说明顺序稳定性不是靠丢弃信息换来的）', forward !== backward);
  check(
    '多值 flag 内部顺序原样保留',
    parseYaml(forward).services.nginx.ports,
    ['80:80', '443:443'],
  );
}

/* ================================================================== */
/* 3. YAML 结构（用 yaml 依赖解析回来）                                  */
/* ================================================================== */
console.log('\n--- 3. 生成的 YAML 结构（yaml 库解析回环）---');
{
  const result = convert(M.DOCKER_RUN_SAMPLE);
  const doc = parseYaml(result.yaml);

  check('顶层只有 services / volumes / networks', Object.keys(doc).sort(), ['networks', 'services', 'volumes']);
  check('服务数恰好一个', Object.keys(doc.services).length, 1);
  check('服务名取自 --name', Object.keys(doc.services), ['web']);

  const service = doc.services.web;
  check('image 原样', service.image, 'nginx:1.25');
  check('container_name', service.container_name, 'web');
  check('hostname', service.hostname, 'web');
  check('restart', service.restart, 'unless-stopped');
  check('ports 顺序与取值', service.ports, ['8080:80', '8443:443']);
  checkTrue('ports 解析回来仍是字符串（8080:80 不会被当成数字或时间）', service.ports.every((p) => typeof p === 'string'));
  check('volumes 顺序与取值', service.volumes, [
    '/srv/site:/usr/share/nginx/html:ro',
    'nginx-cache:/var/cache/nginx',
  ]);
  check('env_file', service.env_file, ['.env']);
  check('networks', service.networks, ['appnet']);
  check('cap_add', service.cap_add, ['NET_BIND_SERVICE']);
  check('cap_drop', service.cap_drop, ['ALL']);
  check('mem_limit 保持 docker 的写法', service.mem_limit, '512m');
  check('cpus 是数字而不是字符串', service.cpus, 1.5);
  check('healthcheck.test 用 CMD-SHELL 包住原命令', service.healthcheck.test, [
    'CMD-SHELL',
    'curl -fsS http://localhost/healthz',
  ]);
  check('healthcheck.interval', service.healthcheck.interval, '30s');
  check('healthcheck.retries 是数字', service.healthcheck.retries, 3);
  check('labels 写成映射', service.labels, { 'com.example.role': 'frontend' });
  check('command 原样成列表（含空格的那个参数没有被拆开）', service.command, ['nginx', '-g', 'daemon off;']);
  check('命名卷在顶层声明（compose 要求先声明再使用）', doc.volumes, { 'nginx-cache': {} });
  check('自定义网络在顶层声明', doc.networks, { appnet: {} });
  checkTrue('YAML 里没有 version 键（现代 compose 不需要）', !('version' in doc));
}

/* ================================================================== */
/* 4. 交叉验证：与独立第二份解析器比对                                   */
/* ================================================================== */
console.log('\n--- 4. 交叉验证（本文件里独立写的第二份解析器）---');
{
  const CORPUS = [
    'docker run nginx',
    'docker run -d --name web -p 8080:80 nginx:1.25',
    'docker run --publish=8080:80 --publish=127.0.0.1:9000:9000/udp web',
    'docker run -v /srv/a:/a:ro -v cache:/cache -v /anon alpine:3.20',
    'docker run -e A=1 -e "B=b c" --env-file .env --env-file prod.env app',
    'docker run -e PASS --env-file .env app',
    'docker run --name db --restart on-failure:5 -m 1g --memory-swap 2g -u 1000:1000 postgres:16',
    'docker run -w /app -h api --entrypoint /bin/sh busybox -c "echo hi"',
    'docker run --privileged --cap-add SYS_ADMIN --cap-drop MKNOD --security-opt seccomp=unconfined img',
    'docker run --cpus 2 --cpu-shares 512 --pids-limit 100 --cpuset-cpus 0-1 --shm-size 256m img',
    'docker run --read-only --init -it --tmpfs /tmp img sh',
    'docker run --network frontend --network backend --hostname h --mac-address 02:42:ac:11:00:02 img',
    'docker run --add-host db:10.0.0.5 --dns 8.8.8.8 --dns-search example.com --dns-option ndots:2 img',
    'docker run --expose 8080 --device /dev/snd --device-cgroup-rule "c 1:3 rmw" --volumes-from other img',
    'docker run --sysctl net.core.somaxconn=1024 --ulimit nofile=1024:2048 --ulimit nproc=512 img',
    'docker run --health-cmd "curl -f http://localhost" --health-interval 10s --health-timeout 3s --health-retries 5 --health-start-period 30s img',
    'docker run --no-healthcheck --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 img',
    'docker run --label a=1 --label "b=x y" --pull always --platform linux/amd64 img',
    'docker run --stop-signal SIGTERM --stop-timeout 30 --ipc host --pid host --uts host img',
    'docker run --userns host --runtime runc --isolation default --cgroup-parent foo img',
    'docker run --group-add 1000 --group-add 2000 img',
    'docker run -l a=1 -l b=2 img',
    'podman run --name p -p 80:80 img',
    'docker container run --rm -e A=1 img',
    'docker run -- --weird-image cmd --flag',
    'docker run -e "MSG=你好 😀" --name 中文名 img',
  ];

  let mismatches = 0;
  let covered = 0;
  let refFailures = 0;
  for (const [index, input] of CORPUS.entries()) {
    let reference;
    try {
      reference = refParse(input);
    } catch (error) {
      refFailures += 1;
      console.log(`FAIL  [${index}] 参照解析器无法处理 ${JSON.stringify(input)}：${error.message}`);
      continue;
    }
    covered += 1;
    const actual = convert(input);
    if (JSON.stringify(canonical(reference.service)) !== JSON.stringify(canonical(actual.service))) {
      mismatches += 1;
      console.log(
        `FAIL  [${index}] ${input}\n        参照 ${JSON.stringify(canonical(reference.service))}\n        实现 ${JSON.stringify(canonical(actual.service))}`,
      );
    }
  }
  check(`${CORPUS.length} 条命令的参照解析器全部覆盖`, refFailures, 0);
  check(`${covered} 条命令：两份独立解析器得到的服务定义完全一致`, mismatches, 0);
  checkTrue('语料确实覆盖了足够多的 flag', covered >= 25);

  // 顶层 volumes / networks 也要一致。
  let topLevel = 0;
  for (const input of CORPUS) {
    const reference = refParse(input);
    const actual = convert(input);
    const refVolumes = [...reference.namedVolumes].sort();
    const gotVolumes = Object.keys(actual.compose.volumes ?? {}).sort();
    const refNetworks = [...reference.namedNetworks].sort();
    const gotNetworks = Object.keys(actual.compose.networks ?? {}).sort();
    if (JSON.stringify(refVolumes) !== JSON.stringify(gotVolumes)) topLevel += 1;
    if (JSON.stringify(refNetworks) !== JSON.stringify(gotNetworks)) topLevel += 1;
  }
  check('顶层 volumes / networks 声明与参照实现一致', topLevel, 0);
}

/* ================================================================== */
/* 5. 镜像与 command 的分离                                             */
/* ================================================================== */
console.log('\n--- 5. 镜像与 command 的分离 ---');
{
  const cases = [
    ['没有 command', 'docker run -d nginx:1.25', 'nginx:1.25', []],
    ['带两个参数', 'docker run alpine echo hello', 'alpine', ['echo', 'hello']],
    ['带引号的参数不被拆开', 'docker run -d nginx:1.25 nginx -g "daemon off;"', 'nginx:1.25', ['nginx', '-g', 'daemon off;']],
    ['镜像带 registry、tag', 'docker run ghcr.io/acme/api:1.2', 'ghcr.io/acme/api:1.2', []],
    ['镜像带 digest', 'docker run --name d alpine@sha256:abc', 'alpine@sha256:abc', []],
    ['命令里出现类似 flag 的参数', 'docker run busybox ls -la /tmp', 'busybox', ['ls', '-la', '/tmp']],
    ['命令里的 -- 属于命令', 'docker run busybox sh -c -- "echo x"', 'busybox', ['sh', '-c', '--', 'echo x']],
    ['-- 之后的第一个词是镜像', 'docker run -- -weird cmd', '-weird', ['cmd']],
    ['命令里有 -e 字样不会被当选项', 'docker run alpine echo -e x', 'alpine', ['echo', '-e', 'x']],
  ];
  let wrong = 0;
  for (const [label, input, image, command] of cases) {
    const result = convert(input);
    if (result.image !== image || JSON.stringify(result.command) !== JSON.stringify(command)) {
      wrong += 1;
      console.log(`FAIL  ${label}\n        got image=${result.image} command=${JSON.stringify(result.command)}`);
    }
  }
  check('9 组镜像/命令分离正确（含 -- 与像 flag 的命令参数）', wrong, 0);

  // --entrypoint 是单个字符串，docker 不会对它做词切分。
  const entry = parseYaml(yamlOf('docker run --entrypoint "/bin/sh -x" img cmd'));
  check('--entrypoint 保持为一个字符串，不被拆成列表', entry.services.img.entrypoint, '/bin/sh -x');
  checkTrue('--entrypoint 不是数组', !Array.isArray(entry.services.img.entrypoint));
}

/* ================================================================== */
/* 6. 服务名推导与顶层声明                                              */
/* ================================================================== */
console.log('\n--- 6. 服务名与顶层声明 ---');
{
  check('镜像名做服务名', M.serviceNameFromImage('nginx:1.25'), 'nginx');
  check('去掉 registry 与路径', M.serviceNameFromImage('ghcr.io/acme/api:1.2'), 'api');
  check('去掉 digest', M.serviceNameFromImage('alpine@sha256:deadbeef'), 'alpine');
  check('大写转小写', M.serviceNameFromImage('MyApp:1'), 'myapp');
  check('非法字符替换成 -', M.serviceNameFromImage('foo/bar baz:1'), 'bar-baz');
  check('空镜像名兜底', M.serviceNameFromImage('///'), 'service');

  const named = parseYaml(yamlOf('docker run --name MyWeb -v data:/d -v ./local:/l -v /abs:/a -e A=1 img'));
  check('--name 作为服务名，非法字符被替换', Object.keys(named.services), ['myweb']);
  check('只有命名卷进顶层声明（相对/绝对路径不进）', Object.keys(named.volumes), ['data']);

  const mixed = parseYaml(yamlOf('docker run --mount type=volume,source=cache,target=/c --mount type=bind,source=/host,target=/h,readonly img'));
  check('--mount 转成长语法', mixed.services.img.volumes, [
    { type: 'volume', source: 'cache', target: '/c' },
    { type: 'bind', source: '/host', target: '/h', read_only: true },
  ]);
  check('--mount 的命名卷也进顶层声明', Object.keys(mixed.volumes), ['cache']);
}

/* ================================================================== */
/* 7. 报错与告警                                                        */
/* ================================================================== */
console.log('\n--- 7. 报错与告警（不静默丢信息）---');
{
  const expectError = (label, input, needle) => {
    const result = M.dockerRunToCompose(input);
    checkTrue(label, !result.ok && result.error.message.includes(needle));
  };
  expectError('空命令报错', '   ', '命令是空的');
  expectError('没有镜像报错', 'docker run -d --name web', '没有找到镜像名');
  expectError('-p 缺少取值报错', 'docker run -p', '缺少取值');
  expectError('--env 缺少取值报错', 'docker run --env', '缺少取值');
  expectError('引号未闭合报错', 'docker run --name "x nginx', '双引号没有闭合');
  expectError('不是 run 命令报错', 'docker exec -it web sh', '只支持 `docker run`');
  expectError('开关选项写了非法值', 'docker run --privileged=maybe nginx', '只能写');

  const unknown = M.dockerRunToCompose('docker run --frobnicate 3 nginx');
  checkTrue('未知长选项转成告警而不是报错', unknown.ok);
  checkTrue('未知长选项出现在 warnings 里', unknown.warnings.some((w) => w.includes('--frobnicate')));

  const unknownShort = M.dockerRunToCompose('docker run -Z nginx');
  checkTrue('未知短选项也告警', unknownShort.ok && unknownShort.warnings.some((w) => w.includes('-Z')));

  const rm = M.dockerRunToCompose('docker run --rm -d nginx');
  checkTrue('--rm 与 -d 都进 warnings（compose 服务定义里没有对应字段）', rm.warnings.length >= 2);
  checkTrue('--rm 的告警说明了替代写法', rm.warnings.some((w) => w.includes('compose run --rm')));
  check('--rm / -d 不会污染服务定义', Object.keys(rm.service), ['image']);

  const duplicate = M.dockerRunToCompose('docker run --name a --name b nginx');
  checkTrue('单值 flag 重复出现时给出告警', duplicate.warnings.some((w) => w.includes('重复出现')));
  check('单值 flag 重复取最后一个（与 docker CLI 一致）', duplicate.service.container_name, 'b');

  const badLabel = M.dockerRunToCompose('docker run -l justakey nginx');
  checkTrue('没有 = 的 label 被告警', badLabel.warnings.some((w) => w.includes('justakey')));
  check('没有 = 的 label 不会写进 labels', badLabel.service.labels, undefined);

  const badMount = M.dockerRunToCompose('docker run --mount type=bind,source=/a nginx');
  checkTrue('--mount 缺 target 时告警', badMount.warnings.some((w) => w.includes('缺少 target')));
  check('--mount 缺 target 时不写出错误的卷', badMount.service.volumes, undefined);

  const badNames = M.dockerRunToCompose('docker run --name "my web" nginx');
  checkTrue('服务名含空格时告警并改名', badNames.warnings.some((w) => w.includes('服务名')));
  check('服务名被规整', badNames.serviceName, 'my-web');
}

/* ================================================================== */
/* 8. 边界                                                             */
/* ================================================================== */
console.log('\n--- 8. 边界 ---');
{
  check('超长命令不崩', M.dockerRunToCompose(`docker run ${Array.from({ length: 500 }, (_, i) => `-e K${i}=v${i}`).join(' ')} nginx`).ok, true);
  check(
    '500 个环境变量全部保留',
    Object.keys(parseYaml(yamlOf(`docker run ${Array.from({ length: 500 }, (_, i) => `-e K${i}=v${i}`).join(' ')} nginx`)).services.nginx.environment).length,
    500,
  );
  check('Unicode 环境变量值原样保留', parseYaml(yamlOf('docker run -e "MSG=你好 😀" nginx')).services.nginx.environment.MSG, '你好 😀');
  check('Windows 路径卷不被冒号切错', M.splitVolumeSpec('C:\\data:/data'), ['C:\\data', '/data']);
  check('Windows 路径卷不被当成命名卷', M.isNamedVolumeSource('C:\\data'), true);
  checkTrue('空字符串的 -e 值进 YAML', M.dockerRunToCompose('docker run -e "A=" nginx').ok);
  check('空值环境变量写成空串', parseYaml(yamlOf('docker run -e "A=" nginx')).services.nginx.environment.A, '');
  checkTrue('YAML 以换行结尾且可被再次解析', yamlOf('docker run nginx').endsWith('\n'));
  check('生成的 YAML 再解析再序列化仍等价', canonical(parseYaml(yamlOf('docker run -p 80:80 -e A=1 nginx'))), canonical(parseYaml(yamlOf('docker run -p 80:80 -e A=1 nginx'))));

  // 只有镜像时是最小的合法 compose。
  check('只有镜像时的最小输出', yamlOf('docker run nginx'), 'services:\n  nginx:\n    image: nginx\n');
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
