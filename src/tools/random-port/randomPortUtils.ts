/**
 * Port number generation, classification and formatting.
 *
 * Pure logic: no React, no DOM, no clock and — importantly — no random number
 * generator of its own. The random source is a parameter, because a generator
 * that calls `Math.random()` internally can only be checked by looking at its
 * output; with the source injected, a check can drive it with a known sequence
 * and assert on the exact result.
 *
 * What this module is NOT: a port scanner. A browser cannot open a raw TCP or
 * UDP socket to an arbitrary port, so there is no way for this code to learn
 * whether a port is free on the machine that happens to be running the tab.
 * Everything here is arithmetic on numbers in 0 .. 65535.
 *
 * IANA divides the port space into three ranges (RFC 6335 §6):
 *
 *   0 .. 1023     system ports (well known); binding usually needs privileges
 *   1024 .. 49151 user ports (registered); listed with IANA on request
 *   49152 .. 65535 dynamic / private ports, used by the kernel as ephemeral
 *                  source ports
 *
 * Port 0 is special even inside the first range: it is reserved and cannot be
 * used as a real connection endpoint, which is why the UI labels it.
 */

/**
 * A uniform random source: a function returning a value in `[0, 1)`.
 *
 * Taking a function rather than an array of bytes means the generator can be
 * driven by anything — crypto-backed randomness in the browser, a seeded
 * xorshift in the check script, or a deliberately hostile source that returns
 * 1.0 to prove the bounds guard works.
 */
export type RandomSource = () => number;

export class PortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PortError';
  }
}

/** Lowest and highest representable port. */
export const MIN_PORT = 0;
export const MAX_PORT = 65535;
/** Upper bound of the IANA system port range. */
export const WELL_KNOWN_MAX = 1023;
/** Upper bound of the IANA registered port range. */
export const REGISTERED_MAX = 49151;
/** Lower bound of the IANA dynamic / private range. */
export const DYNAMIC_MIN = 49152;

/**
 * Hard cap on one request.
 *
 * A cap rather than no limit because a mistyped quantity would otherwise build
 * a six-figure list and freeze the tab while React renders it. 1000 rows is far
 * more than anyone reads, and the check script exercises the boundary.
 */
export const MAX_COUNT = 1000;

export type PortClassKind = 'wellKnown' | 'registered' | 'dynamic';

/** Which IANA range a port belongs to, plus the wording the UI shows. */
export interface PortClass {
  kind: PortClassKind;
  label: string;
  /** The IANA range as text, e.g. "49152–65535". */
  ianaRange: string;
  note: string;
}

const PORT_CLASSES: Record<PortClassKind, PortClass> = {
  wellKnown: {
    kind: 'wellKnown',
    label: '系统端口（知名端口）',
    ianaRange: '0–1023',
    note: 'IANA 系统端口，绑定通常需要特权；0 号端口被保留，不能作为连接端点',
  },
  registered: {
    kind: 'registered',
    label: '用户端口（注册端口）',
    ianaRange: '1024–49151',
    note: 'IANA 登记的用户端口，普通进程即可绑定',
  },
  dynamic: {
    kind: 'dynamic',
    label: '动态 / 私有端口',
    ianaRange: '49152–65535',
    note: 'IANA 动态端口，内核通常从这里挑选临时（ephemeral）源端口',
  },
};

/** True when `port` is an integer inside 0 .. 65535. */
export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT;
}

/**
 * The IANA range a port falls in.
 *
 * The comparison is deliberately `<=` against each upper bound in ascending
 * order. Writing the boundaries as `port >= 0 && port <= 1023` and so on would
 * be the same logic, but a chain makes it obvious that 1023 belongs to the
 * system range while 1024 does not — the off-by-one that this tool exists to
 * get right.
 */
export function classifyPort(port: number): PortClass {
  if (!isValidPort(port)) {
    throw new PortError(`端口号必须是 0 到 65535 之间的整数，收到 "${port}"`);
  }
  if (port <= WELL_KNOWN_MAX) return PORT_CLASSES.wellKnown;
  if (port <= REGISTERED_MAX) return PORT_CLASSES.registered;
  return PORT_CLASSES.dynamic;
}

/**
 * Service names for the ports people actually recognise.
 *
 * A hand-written table rather than a fetch: there are 65536 possible ports and
 * ~14000 IANA registrations, and a lookup service would turn a pure function
 * into a network call. `ianaName` was transcribed from the IANA "Service Name
 * and Transport Protocol Port Number Registry" CSV (the port numbers whose
 * names differ most from the common convention are the interesting ones).
 *
 * The distinction between `name` and `ianaName` is not pedantry. Several ports
 * that everyone "knows" are *not* what the registry says:
 *
 *   1521 Oracle       registry: ncube-lm
 *   2181 ZooKeeper    registry: eforward
 *   7001 WebLogic     registry: afs3-callback
 *   9200 Elasticsearch registry: wap-wsp
 *   6443 Kubernetes   registry: sun-sr-https
 *
 * Those are de-facto conventions layered on top of a port that IANA assigned to
 * something else years earlier, so the UI labels which is which instead of
 * presenting a convention as an authoritative name. A port number also means
 * nothing without its transport protocol: 53 is DNS over both UDP and TCP, 123
 * is registered on both but is NTP over UDP in practice, and 514 is syslog over
 * UDP while the same number is `shell` over TCP.
 */
export interface PortService {
  /** The name a developer would recognise, in Simplified Chinese prose. */
  name: string;
  /** The IANA registry name (lowercase), or null when the port is unassigned. */
  ianaName: string | null;
  /** Transport protocols the registry lists for this port. */
  protocols: string;
}

export const PORT_SERVICES: Readonly<Record<number, PortService>> = {
  20: { name: 'FTP 数据', ianaName: 'ftp-data', protocols: 'tcp, udp' },
  21: { name: 'FTP 控制', ianaName: 'ftp', protocols: 'tcp, udp' },
  22: { name: 'SSH', ianaName: 'ssh', protocols: 'tcp, udp' },
  23: { name: 'Telnet', ianaName: 'telnet', protocols: 'tcp, udp' },
  25: { name: 'SMTP', ianaName: 'smtp', protocols: 'tcp, udp' },
  53: { name: 'DNS', ianaName: 'domain', protocols: 'tcp, udp' },
  67: { name: 'DHCP 服务端', ianaName: 'bootps', protocols: 'tcp, udp' },
  68: { name: 'DHCP 客户端', ianaName: 'bootpc', protocols: 'tcp, udp' },
  69: { name: 'TFTP', ianaName: 'tftp', protocols: 'tcp, udp' },
  80: { name: 'HTTP', ianaName: 'http', protocols: 'tcp, udp' },
  110: { name: 'POP3', ianaName: 'pop3', protocols: 'tcp, udp' },
  123: { name: 'NTP', ianaName: 'ntp', protocols: 'tcp, udp' },
  137: { name: 'NetBIOS 名称服务', ianaName: 'netbios-ns', protocols: 'tcp, udp' },
  143: { name: 'IMAP', ianaName: 'imap', protocols: 'tcp, udp' },
  161: { name: 'SNMP', ianaName: 'snmp', protocols: 'tcp, udp' },
  389: { name: 'LDAP', ianaName: 'ldap', protocols: 'tcp, udp' },
  443: { name: 'HTTPS', ianaName: 'https', protocols: 'tcp, udp' },
  445: { name: 'SMB', ianaName: 'microsoft-ds', protocols: 'tcp, udp' },
  465: { name: 'SMTPS（邮件提交）', ianaName: 'submissions', protocols: 'tcp' },
  514: { name: 'Syslog（UDP）', ianaName: 'syslog', protocols: 'udp' },
  587: { name: 'SMTP 提交', ianaName: 'submission', protocols: 'tcp, udp' },
  636: { name: 'LDAPS', ianaName: 'ldaps', protocols: 'tcp, udp' },
  873: { name: 'rsync', ianaName: 'rsync', protocols: 'tcp, udp' },
  993: { name: 'IMAPS', ianaName: 'imaps', protocols: 'tcp' },
  995: { name: 'POP3S', ianaName: 'pop3s', protocols: 'tcp, udp' },
  1080: { name: 'SOCKS 代理', ianaName: 'socks', protocols: 'tcp, udp' },
  1194: { name: 'OpenVPN', ianaName: 'openvpn', protocols: 'tcp, udp' },
  1433: { name: 'Microsoft SQL Server', ianaName: 'ms-sql-s', protocols: 'tcp, udp' },
  1521: { name: 'Oracle 数据库（约定）', ianaName: 'ncube-lm', protocols: 'tcp, udp' },
  1701: { name: 'L2TP', ianaName: 'l2tp', protocols: 'tcp, udp' },
  1723: { name: 'PPTP', ianaName: 'pptp', protocols: 'tcp, udp' },
  1883: { name: 'MQTT', ianaName: 'mqtt', protocols: 'tcp, udp' },
  2049: { name: 'NFS', ianaName: 'nfs', protocols: 'tcp, udp' },
  2181: { name: 'ZooKeeper（约定）', ianaName: 'eforward', protocols: 'tcp, udp' },
  2375: { name: 'Docker（未加密）', ianaName: 'docker', protocols: 'tcp' },
  2376: { name: 'Docker（TLS）', ianaName: 'docker-s', protocols: 'tcp' },
  3306: { name: 'MySQL / MariaDB', ianaName: 'mysql', protocols: 'tcp, udp' },
  3389: { name: 'RDP 远程桌面', ianaName: 'ms-wbt-server', protocols: 'tcp, udp' },
  4369: { name: 'Erlang EPMD', ianaName: 'epmd', protocols: 'tcp, udp' },
  5432: { name: 'PostgreSQL', ianaName: 'postgresql', protocols: 'tcp, udp' },
  5672: { name: 'AMQP（RabbitMQ）', ianaName: 'amqp', protocols: 'tcp, udp' },
  5900: { name: 'VNC', ianaName: 'rfb', protocols: 'tcp, udp' },
  5984: { name: 'CouchDB', ianaName: 'couchdb', protocols: 'tcp, udp' },
  6379: { name: 'Redis', ianaName: 'redis', protocols: 'tcp' },
  6443: { name: 'Kubernetes API（约定）', ianaName: 'sun-sr-https', protocols: 'tcp, udp' },
  7001: { name: 'WebLogic（约定）', ianaName: 'afs3-callback', protocols: 'tcp, udp' },
  8080: { name: 'HTTP 备用（代理 / Tomcat）', ianaName: 'http-alt', protocols: 'tcp, udp' },
  8443: { name: 'HTTPS 备用', ianaName: 'pcsync-https', protocols: 'tcp, udp' },
  9200: { name: 'Elasticsearch（约定）', ianaName: 'wap-wsp', protocols: 'tcp, udp' },
  9300: { name: 'Elasticsearch 集群通信（约定）', ianaName: 'vrace', protocols: 'tcp, udp' },
  11211: { name: 'Memcached', ianaName: 'memcache', protocols: 'tcp, udp' },
  27017: { name: 'MongoDB', ianaName: 'mongodb', protocols: 'tcp' },
};

/** The service entry for a port, or null when it is not in the table. */
export function serviceInfo(port: number): PortService | null {
  return PORT_SERVICES[port] ?? null;
}

/** The recognisable service name for a port, or null. */
export function serviceName(port: number): string | null {
  return PORT_SERVICES[port]?.name ?? null;
}

/**
 * Ports that are occupied on a typical development machine.
 *
 * This is a *convention* list, not a scan result: it is exactly the set of
 * default ports developers are told to avoid, which is why a few of them (3000,
 * 5000, 8000, 8888, 9000) are framework conventions rather than IANA service
 * assignments. Excluding them makes a generated number less likely to collide
 * with something the user already runs — it says nothing about the machine the
 * page is open on, and the UI says so in as many words.
 *
 * Kept sorted so the "available count" reported to the user is easy to audit.
 * Every entry is inside 0 .. 49151 on purpose: the points of this list are the
 * ports services bind by default, and the dynamic range above it is never
 * assigned by IANA, so nothing there is a "default" to avoid.
 */
export const COMMON_OCCUPIED_PORTS: readonly number[] = [
  21, 22, 23, 25, 53, 67, 68, 80, 110, 123, 143, 161, 389, 443, 445, 465, 514,
  587, 636, 993, 995, 1080, 1194, 1433, 1521, 1723, 1883, 2049, 2181, 2375,
  2376, 3000, 3306, 3389, 4369, 5000, 5432, 5672, 5900, 5984, 6379, 6443, 7001,
  8000, 8080, 8443, 8888, 9000, 9200, 9300, 11211, 27017, 27018,
];

/** True when `port` is in the common-defaults exclusion list. */
export function isCommonlyOccupied(port: number): boolean {
  return COMMON_OCCUPIED_PORTS.includes(port);
}

/** Range presets offered by the UI; the first one is the default. */
export interface PortRangePreset {
  id: string;
  label: string;
  min: number;
  max: number;
  note: string;
}

export const PORT_RANGE_PRESETS: readonly PortRangePreset[] = [
  {
    id: 'dynamic',
    label: '动态 / 私有端口 49152–65535',
    min: 49152,
    max: 65535,
    note: 'IANA 动态端口，最不容易与已经跑着的服务撞上，也是默认范围',
  },
  {
    id: 'registered',
    label: '用户 / 注册端口 1024–49151',
    min: 1024,
    max: 49151,
    note: 'IANA 注册端口，普通权限即可绑定；其中不少号码已被登记的服务占用',
  },
  {
    id: 'all',
    label: '全部端口 0–65535',
    min: 0,
    max: 65535,
    note: '完整端口空间；0 号端口被 IANA 保留，不能作为实际的连接端点',
  },
];

export const DEFAULT_PRESET_ID = 'dynamic';

export function presetById(id: string): PortRangePreset | null {
  return PORT_RANGE_PRESETS.find((preset) => preset.id === id) ?? null;
}

/** Validates a range and throws a message the UI can show verbatim. */
export function assertRange(min: number, max: number): void {
  if (!Number.isInteger(min) || !Number.isInteger(max)) {
    throw new PortError(`端口范围必须是整数，收到 ${min} – ${max}`);
  }
  if (min < MIN_PORT || min > MAX_PORT) {
    throw new PortError(`最小端口必须在 ${MIN_PORT} 到 ${MAX_PORT} 之间，收到 ${min}`);
  }
  if (max < MIN_PORT || max > MAX_PORT) {
    throw new PortError(`最大端口必须在 ${MIN_PORT} 到 ${MAX_PORT} 之间，收到 ${max}`);
  }
  if (min > max) {
    throw new PortError(`最小端口 ${min} 不能大于最大端口 ${max}`);
  }
}

/** Validates a requested quantity. */
export function assertCount(count: number): void {
  if (!Number.isInteger(count) || count < 1) {
    throw new PortError(`生成数量必须是大于 0 的整数，收到 "${count}"`);
  }
  if (count > MAX_COUNT) {
    throw new PortError(`一次最多生成 ${MAX_COUNT} 个端口，收到 ${count}`);
  }
}

/** The common-default ports that fall inside `min .. max`, ascending. */
export function excludedPortsInRange(min: number, max: number): number[] {
  assertRange(min, max);
  return COMMON_OCCUPIED_PORTS.filter((port) => port >= min && port <= max);
}

/**
 * How many distinct ports a request could possibly return.
 *
 * This is the number that decides whether "N distinct ports" is satisfiable, so
 * it is computed *before* any sampling happens. Doing it up front is what turns
 * an unsatisfiable request into an error message instead of a loop that keeps
 * drawing from an exhausted pool.
 */
export function availablePortCount(min: number, max: number, excludeCommon: boolean): number {
  const total = max - min + 1;
  const excluded = excludeCommon ? excludedPortsInRange(min, max).length : 0;
  return total - excluded;
}

/**
 * All candidate ports in the range, ascending.
 *
 * Built as an explicit array so the distinct case can use a partial
 * Fisher-Yates shuffle over it. The alternative — draw a random port and retry
 * when it was already drawn — terminates with probability 1 but has no useful
 * worst-case bound, and asking for 1000 distinct ports out of a 1024-wide range
 * makes it take a very long time. Shuffling costs one array of at most 65536
 * numbers and is done in a single pass.
 */
export function candidatePorts(min: number, max: number, excludeCommon: boolean): number[] {
  assertRange(min, max);
  const excluded = new Set(excludeCommon ? excludedPortsInRange(min, max) : []);
  const pool: number[] = [];
  for (let port = min; port <= max; port += 1) {
    if (!excluded.has(port)) pool.push(port);
  }
  return pool;
}

/**
 * Draws an index in `0 .. n - 1` from the injected source.
 *
 * The bounds check is not defensive noise. A source returning exactly 1 would
 * otherwise index one past the end and yield `undefined`, which would then
 * propagate into the result as a missing port rather than as an error; NaN
 * would produce NaN. Both are reported instead.
 */
function randomIndex(random: RandomSource, n: number): number {
  const value = random();
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) {
    throw new PortError(`随机源必须返回 [0, 1) 之间的有限数值，收到 "${String(value)}"`);
  }
  const index = Math.floor(value * n);
  // `value < 1` makes `index < n` hold; the clamp only covers a float that
  // rounds up to exactly n, which cannot happen for n <= 65536.
  return index < n ? index : n - 1;
}

export interface PortRequest {
  min: number;
  max: number;
  count: number;
  /** true: every returned port is distinct. false: independent samples. */
  unique: boolean;
  /** true: skip the ports in COMMON_OCCUPIED_PORTS. */
  excludeCommon: boolean;
}

export interface PortResult {
  /** The generated ports, in generation order. */
  ports: number[];
  /** Distinct ports the request could have returned. */
  available: number;
  /** The common-default ports that were skipped inside this range. */
  excluded: number[];
}

/**
 * Generates ports from the injected random source.
 *
 * Throws a `PortError` — never loops forever — when the request is impossible:
 * a range that cannot be satisfied at all after exclusion, or a distinct count
 * larger than the number of distinct ports in the range.
 */
export function generatePorts(request: PortRequest, random: RandomSource): PortResult {
  const { min, max, count, unique, excludeCommon } = request;
  assertRange(min, max);
  assertCount(count);

  const pool = candidatePorts(min, max, excludeCommon);
  const available = pool.length;
  const excluded = excludeCommon ? excludedPortsInRange(min, max) : [];

  if (available === 0) {
    throw new PortError(
      `范围 ${min}–${max} 内的端口全部落在"常见占用端口"列表里，请关闭排除或换一个范围`,
    );
  }

  if (!unique) {
    const ports: number[] = [];
    for (let index = 0; index < count; index += 1) {
      ports.push(pool[randomIndex(random, available)]);
    }
    return { ports, available, excluded };
  }

  if (count > available) {
    throw new PortError(
      `范围 ${min}–${max} 内最多只有 ${available} 个可用端口，无法生成 ${count} 个互不重复的端口`,
    );
  }

  // Partial Fisher-Yates: swap the i-th slot with a random slot at or after it,
  // so every subset of size `count` is equally likely and the first `count`
  // slots are distinct by construction. The tail is left unsorted, which is
  // fine because it is discarded.
  const shuffled = pool.slice();
  const ports: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const swapWith = index + randomIndex(random, available - index);
    const held = shuffled[index];
    shuffled[index] = shuffled[swapWith];
    shuffled[swapWith] = held;
    ports.push(shuffled[index]);
  }
  return { ports, available, excluded };
}

/** The hex and binary spellings of a port, as the result table shows them. */
export function formatPortHex(port: number): string {
  if (!isValidPort(port)) {
    throw new PortError(`端口号必须是 0 到 65535 之间的整数，收到 "${port}"`);
  }
  return `0x${port.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * 16 bits in four-bit groups, e.g. 8080 -> "0001 1111 1001 0000".
 *
 * The grouping is not decoration: a port is a 16-bit big-endian field in the
 * TCP and UDP headers, and nibbles are how it is read off a packet dump. The
 * padding is mandatory — without it 80 would render as "1010000", which is a
 * different-looking 7-bit number.
 */
export function formatPortBinary(port: number): string {
  if (!isValidPort(port)) {
    throw new PortError(`端口号必须是 0 到 65535 之间的整数，收到 "${port}"`);
  }
  const bits = port.toString(2).padStart(16, '0');
  return `${bits.slice(0, 4)} ${bits.slice(4, 8)} ${bits.slice(8, 12)} ${bits.slice(12, 16)}`;
}

export interface PortDescription {
  port: number;
  portClass: PortClass;
  /** IANA service name, or null. */
  service: string | null;
  /** The registry's own name for the port, which may not be the familiar one. */
  ianaName: string | null;
  /** True when the port is in the common-defaults exclusion list. */
  commonlyOccupied: boolean;
  hex: string;
  binary: string;
}

/** Everything the result table shows for one port. */
export function describePort(port: number): PortDescription {
  const info = serviceInfo(port);
  return {
    port,
    portClass: classifyPort(port),
    service: info?.name ?? null,
    ianaName: info?.ianaName ?? null,
    commonlyOccupied: isCommonlyOccupied(port),
    hex: formatPortHex(port),
    binary: formatPortBinary(port),
  };
}

/** One port per line — the form to paste into a config file. */
export function portsToText(ports: readonly number[]): string {
  return ports.join('\n');
}

/** Tab-separated detail, for a spreadsheet or an issue comment. */
export function portsToTsv(ports: readonly number[]): string {
  const lines = ['端口\t范围\t十六进制\t二进制\t服务'];
  for (const port of ports) {
    const described = describePort(port);
    lines.push(
      [
        described.port,
        described.portClass.label,
        described.hex,
        described.binary,
        described.service ?? '',
      ].join('\t'),
    );
  }
  return lines.join('\n');
}
