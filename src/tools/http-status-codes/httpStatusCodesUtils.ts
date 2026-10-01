/**
 * HTTP status code data and the filtering logic over it.
 *
 * Pure: no React, no clock, no DOM. The whole lookup is a function of
 * `(code, query, category)`, which is what lets `scripts/check-http-status-codes.mjs`
 * verify every single entry against two independent references instead of
 * trusting the table by eye.
 *
 * ## Why the data carries its own source and kind
 *
 * A status code list is only useful if a reader can tell a real code from a
 * lookalike. "509" is not in the IANA registry at all, "449" is a Microsoft
 * private extension, "418" started as an April Fools' joke, and "422" was
 * renamed by RFC 9110. Without that context the number alone is misleading, so
 * every entry records the RFC it comes from and how binding it is.
 *
 * ## Why the category is stored instead of derived
 *
 * Storing `category` while also having `categoryOf()` derive it from the first
 * digit looks redundant — and it is, until one of the two is wrong. The check
 * script compares all of them exhaustively, so a typo in either direction is a
 * failing assertion rather than a quietly mis-sorted row. Deriving it at render
 * time only would hide exactly the mistake worth catching.
 */

/** The five status-code classes. Always spelled with the `xx` suffix. */
export type StatusCategory = '1xx' | '2xx' | '3xx' | '4xx' | '5xx';

/**
 * How normative an entry is.
 *
 * - `standard`   — defined by an IETF standards-track RFC and registered by IANA.
 * - `deprecated` — registered and/or historically defined, but now deprecated,
 *                  obsoleted or removed from the spec that introduced it.
 * - `reserved`   — the number is deliberately held and carries no semantics.
 * - `nonstandard`— never registered by IANA: a vendor extension or a joke code.
 */
export type StatusKind = 'standard' | 'deprecated' | 'reserved' | 'nonstandard';

export interface HttpStatusEntry {
  /** The three-digit code. */
  code: number;
  /**
   * English name, spelled exactly as the registry (or, for nonstandard codes,
   * the defining document) spells it. The check script pins the important ones
   * verbatim, including the odd apostrophe in `I'm a teapot`.
   */
  name: string;
  /** Simplified Chinese explanation, written for a developer reading logs. */
  zh: string;
  category: StatusCategory;
  /**
   * Where the code comes from, as a short citation such as
   * `RFC 9110 §15.5.5`. Nonstandard codes say so instead of inventing an RFC.
   */
  source: string;
  kind: StatusKind;
  /**
   * Why the code is deprecated/reserved/nonstandard, or how its name changed.
   * Omitted when there is nothing surprising to say.
   */
  note?: string;
}

/** Chinese labels for the five classes, plus a one-line meaning. */
export const CATEGORY_META: Record<
  StatusCategory,
  { label: string; summary: string }
> = {
  '1xx': {
    label: '信息响应',
    summary: '请求已收到，处理仍在继续（Informational）。',
  },
  '2xx': {
    label: '成功',
    summary: '请求已成功接收、理解并接受（Success）。',
  },
  '3xx': {
    label: '重定向',
    summary: '需要客户端进一步操作才能完成请求（Redirection）。',
  },
  '4xx': {
    label: '客户端错误',
    summary: '请求本身有语法错误或无法被满足（Client Error）。',
  },
  '5xx': {
    label: '服务端错误',
    summary: '服务器在处理一个看似有效的请求时失败（Server Error）。',
  },
};

/** Display order of the classes; also the order of the filter tabs. */
export const CATEGORY_ORDER: StatusCategory[] = ['1xx', '2xx', '3xx', '4xx', '5xx'];

/** Chinese labels for the `kind` badge. */
export const KIND_LABELS: Record<StatusKind, string> = {
  standard: '标准',
  deprecated: '已废弃',
  reserved: '保留',
  nonstandard: '非标准',
};

/**
 * The registry.
 *
 * Completeness rule: every code the IANA HTTP Status Code Registry assigns is
 * present, plus the two nonstandard codes that are common enough in the wild to
 * be worth a row (449, 509). Nothing else is invented. The one registry entry
 * deliberately left out is 104 `Upload Resumption Supported`, which at the time
 * of writing is only a TEMPORARY registration that expires 2026-11-13 and comes
 * from an Internet-Draft rather than an RFC — the page's "收录口径" note says so.
 *
 * 418 is listed under its RFC 2324 name rather than IANA's placeholder
 * `(Unused)`, because the joke name is the one people actually search for.
 */
export const HTTP_STATUS_CODES: HttpStatusEntry[] = [
  // 1xx — Informational
  {
    code: 100,
    name: 'Continue',
    zh: '服务器已收到请求的起始部分，客户端应继续发送剩余内容；若请求已发完，可忽略此响应。',
    category: '1xx',
    source: 'RFC 9110 §15.2.1',
    kind: 'standard',
  },
  {
    code: 101,
    name: 'Switching Protocols',
    zh: '服务器同意按 Upgrade 请求头切换协议，并通过响应中的 Upgrade 头指明切换到了哪个协议。',
    category: '1xx',
    source: 'RFC 9110 §15.2.2',
    kind: 'standard',
  },
  {
    code: 102,
    name: 'Processing',
    zh: 'WebDAV 早期用法：服务器已收到请求并正在处理，但暂时没有可返回的状态。',
    category: '1xx',
    source: 'RFC 2518 §10.1',
    kind: 'deprecated',
    note: 'RFC 4918 废止了 RFC 2518 并从 WebDAV 中移除了这个码，它已不应再被使用；IANA 注册表仍保留该条目。',
  },
  {
    code: 103,
    name: 'Early Hints',
    zh: '在最终响应之前先返回部分响应头（通常是 Link），让客户端提前预加载资源或预连接。',
    category: '1xx',
    source: 'RFC 8297',
    kind: 'standard',
  },

  // 2xx — Success
  {
    code: 200,
    name: 'OK',
    zh: '请求成功。具体含义取决于方法：GET 取回资源、POST/PUT 返回处理结果、TRACE 回显收到的请求。',
    category: '2xx',
    source: 'RFC 9110 §15.3.1',
    kind: 'standard',
  },
  {
    code: 201,
    name: 'Created',
    zh: '请求成功并创建了新资源，通常出现在 POST 或 PUT 之后；新资源的地址由 Location 头或响应体给出。',
    category: '2xx',
    source: 'RFC 9110 §15.3.2',
    kind: 'standard',
  },
  {
    code: 202,
    name: 'Accepted',
    zh: '请求已被接受但尚未处理完。这是非承诺性响应，适合异步任务与批处理。',
    category: '2xx',
    source: 'RFC 9110 §15.3.3',
    kind: 'standard',
  },
  {
    code: 203,
    name: 'Non-Authoritative Information',
    zh: '返回的元信息来自资源的副本（代理或镜像），并非源服务器给出的权威版本。',
    category: '2xx',
    source: 'RFC 9110 §15.3.4',
    kind: 'standard',
  },
  {
    code: 204,
    name: 'No Content',
    zh: '请求成功但响应体为空，客户端可保持当前页面不变；常用于 PUT/DELETE 与 CORS 预检请求。',
    category: '2xx',
    source: 'RFC 9110 §15.3.5',
    kind: 'standard',
  },
  {
    code: 205,
    name: 'Reset Content',
    zh: '请求成功并要求客户端重置文档视图，例如清空表单以便重新输入。',
    category: '2xx',
    source: 'RFC 9110 §15.3.6',
    kind: 'standard',
  },
  {
    code: 206,
    name: 'Partial Content',
    zh: '服务器只返回了区间请求（Range）中的一部分内容，响应会带 Content-Range。',
    category: '2xx',
    source: 'RFC 9110 §15.3.7',
    kind: 'standard',
  },
  {
    code: 207,
    name: 'Multi-Status',
    zh: 'WebDAV：一次批量操作涉及多个资源，响应体用 XML 逐个给出各自的状态码。',
    category: '2xx',
    source: 'RFC 4918',
    kind: 'standard',
  },
  {
    code: 208,
    name: 'Already Reported',
    zh: 'WebDAV 绑定：该成员已经在同一响应的前面部分报告过，避免对同一集合重复枚举。',
    category: '2xx',
    source: 'RFC 5842',
    kind: 'standard',
  },
  {
    code: 226,
    name: 'IM Used',
    zh: '服务器完成了 GET，响应体是对当前实例应用一次或多次实例操纵（delta 编码）后的结果。',
    category: '2xx',
    source: 'RFC 3229',
    kind: 'standard',
  },

  // 3xx — Redirection
  {
    code: 300,
    name: 'Multiple Choices',
    zh: '请求有多个可选响应，需要用户或用户代理自行选择；因为没有标准化的自动选择方式，实际很少使用。',
    category: '3xx',
    source: 'RFC 9110 §15.4.1',
    kind: 'standard',
  },
  {
    code: 301,
    name: 'Moved Permanently',
    zh: '目标资源已永久迁移到新 URL，后续请求都应改用新地址；浏览器与搜索引擎会更新记录。',
    category: '3xx',
    source: 'RFC 9110 §15.4.2',
    kind: 'standard',
  },
  {
    code: 302,
    name: 'Found',
    zh: '目标资源的 URL 只是临时变更，后续请求仍应使用原地址；历史上不少实现会把 POST 改写成 GET。',
    category: '3xx',
    source: 'RFC 9110 §15.4.3',
    kind: 'standard',
  },
  {
    code: 303,
    name: 'See Other',
    zh: '请客户端改用 GET 去另一个 URI 获取结果，常用于 POST 之后跳转到结果页（PRG 模式）。',
    category: '3xx',
    source: 'RFC 9110 §15.4.4',
    kind: 'standard',
  },
  {
    code: 304,
    name: 'Not Modified',
    zh: '配合条件请求使用：资源没有变化，客户端可以继续使用缓存副本，响应不应携带消息体。',
    category: '3xx',
    source: 'RFC 9110 §15.4.5',
    kind: 'standard',
    note: '缓存与校验的完整规则见 RFC 9111（HTTP Caching）。',
  },
  {
    code: 305,
    name: 'Use Proxy',
    zh: '要求客户端通过代理访问目标资源；由于会带来安全隐患，已被废弃，不应再使用。',
    category: '3xx',
    source: 'RFC 9110 §15.4.6',
    kind: 'deprecated',
    note: 'RFC 9110 明确说明该码已废弃（deprecated）。',
  },
  {
    code: 306,
    name: '(Unused)',
    zh: '早期规范中定义、现已被保留但不再使用的状态码，没有任何语义。',
    category: '3xx',
    source: 'RFC 9110 §15.4.7',
    kind: 'reserved',
    note: 'IANA 注册表把它登记为 (Unused)，RFC 9110 说明它保留但不再使用。',
  },
  {
    code: 307,
    name: 'Temporary Redirect',
    zh: '临时重定向，并明确规定不得改变请求方法：POST 仍以 POST 发往新地址。',
    category: '3xx',
    source: 'RFC 9110 §15.4.8',
    kind: 'standard',
  },
  {
    code: 308,
    name: 'Permanent Redirect',
    zh: '永久重定向，与 301 类似但不允许改变请求方法，因此 POST 会以 POST 重发到新地址。',
    category: '3xx',
    source: 'RFC 9110 §15.4.9',
    kind: 'standard',
    note: '最初由 RFC 7538 定义，现由 RFC 9110 接管。',
  },

  // 4xx — Client Error
  {
    code: 400,
    name: 'Bad Request',
    zh: '请求语法有误、消息体无法解析或参数不合法，服务器拒绝处理。',
    category: '4xx',
    source: 'RFC 9110 §15.5.1',
    kind: 'standard',
  },
  {
    code: 401,
    name: 'Unauthorized',
    zh: '请求缺少有效的身份认证凭据，响应必须带 WWW-Authenticate 说明认证方式。',
    category: '4xx',
    source: 'RFC 9110 §15.5.2',
    kind: 'standard',
    note: '名字有误导性：它表示"未认证"，不是"无权限"；后者是 403。',
  },
  {
    code: 402,
    name: 'Payment Required',
    zh: '为未来的收费场景预留的状态码，目前基本未被实际使用。',
    category: '4xx',
    source: 'RFC 9110 §15.5.3',
    kind: 'standard',
  },
  {
    code: 403,
    name: 'Forbidden',
    zh: '服务器理解请求但拒绝执行；与 401 的区别是身份已经明确，再认证也不会改变结果。',
    category: '4xx',
    source: 'RFC 9110 §15.5.4',
    kind: 'standard',
  },
  {
    code: 404,
    name: 'Not Found',
    zh: '服务器找不到目标资源；也常被用来掩盖 403，以免泄露资源是否存在。',
    category: '4xx',
    source: 'RFC 9110 §15.5.5',
    kind: 'standard',
  },
  {
    code: 405,
    name: 'Method Not Allowed',
    zh: '目标资源不支持该请求方法，响应必须带 Allow 头列出可用方法。',
    category: '4xx',
    source: 'RFC 9110 §15.5.6',
    kind: 'standard',
  },
  {
    code: 406,
    name: 'Not Acceptable',
    zh: '服务器无法生成符合 Accept 等请求头要求的响应表示。',
    category: '4xx',
    source: 'RFC 9110 §15.5.7',
    kind: 'standard',
  },
  {
    code: 407,
    name: 'Proxy Authentication Required',
    zh: '需要先向代理完成身份认证，响应会带 Proxy-Authenticate 头。',
    category: '4xx',
    source: 'RFC 9110 §15.5.8',
    kind: 'standard',
  },
  {
    code: 408,
    name: 'Request Timeout',
    zh: '服务器在等待请求的过程中超时，客户端可以稍后重发。',
    category: '4xx',
    source: 'RFC 9110 §15.5.9',
    kind: 'standard',
  },
  {
    code: 409,
    name: 'Conflict',
    zh: '请求与资源当前状态冲突，例如并发编辑导致版本不一致。',
    category: '4xx',
    source: 'RFC 9110 §15.5.10',
    kind: 'standard',
  },
  {
    code: 410,
    name: 'Gone',
    zh: '资源曾经存在但已被永久删除，而且服务器不打算提供新的地址。',
    category: '4xx',
    source: 'RFC 9110 §15.5.11',
    kind: 'standard',
  },
  {
    code: 411,
    name: 'Length Required',
    zh: '请求缺少 Content-Length 头，服务器拒绝接收长度无法确定的消息体。',
    category: '4xx',
    source: 'RFC 9110 §15.5.12',
    kind: 'standard',
  },
  {
    code: 412,
    name: 'Precondition Failed',
    zh: '请求头里的前置条件（If-Match、If-Unmodified-Since 等）不成立。',
    category: '4xx',
    source: 'RFC 9110 §15.5.13',
    kind: 'standard',
  },
  {
    code: 413,
    name: 'Content Too Large',
    zh: '请求内容超过了服务器允许的大小上限。',
    category: '4xx',
    source: 'RFC 9110 §15.5.14',
    kind: 'standard',
    note: '名称变更：RFC 9110 起叫 Content Too Large，RFC 7231 叫 Payload Too Large，RFC 2616 叫 Request Entity Too Large；旧名至今仍在广泛使用。',
  },
  {
    code: 414,
    name: 'URI Too Long',
    zh: '请求的 URI 超过了服务器能处理的长度，常见于过长的查询字符串。',
    category: '4xx',
    source: 'RFC 9110 §15.5.15',
    kind: 'standard',
  },
  {
    code: 415,
    name: 'Unsupported Media Type',
    zh: '请求体的媒体类型不受支持，服务器拒绝处理该内容格式。',
    category: '4xx',
    source: 'RFC 9110 §15.5.16',
    kind: 'standard',
  },
  {
    code: 416,
    name: 'Range Not Satisfiable',
    zh: 'Range 请求头指定的区间无法满足，例如起点已经超出资源长度。',
    category: '4xx',
    source: 'RFC 9110 §15.5.17',
    kind: 'standard',
  },
  {
    code: 417,
    name: 'Expectation Failed',
    zh: '服务器无法满足 Expect 请求头中的期望，通常是 Expect: 100-continue。',
    category: '4xx',
    source: 'RFC 9110 §15.5.18',
    kind: 'standard',
  },
  {
    code: 418,
    name: "I'm a teapot",
    zh: '玩笑状态码：服务器拒绝煮咖啡，因为它本质上是一把茶壶。',
    category: '4xx',
    source: 'RFC 2324 §2.3.2',
    kind: 'nonstandard',
    note: '源自 1998 年愚人节 RFC 2324（超文本咖啡壶控制协议）。RFC 9110 因其被大量部署为玩笑而正式保留了这个号码，IANA 注册表中登记为 (Unused)。',
  },
  {
    code: 421,
    name: 'Misdirected Request',
    zh: '请求被发送到了无法为目标源生成响应的服务器，例如 HTTP/2 连接复用时 SNI 不匹配。',
    category: '4xx',
    source: 'RFC 9110 §15.5.20',
    kind: 'standard',
  },
  {
    code: 422,
    name: 'Unprocessable Content',
    zh: '请求内容的语法正确，但服务器无法处理其中的语义指令。',
    category: '4xx',
    source: 'RFC 9110 §15.5.21',
    kind: 'standard',
    note: '名称变更：RFC 9110 把 RFC 4918 的 Unprocessable Entity 改成了 Unprocessable Content；各框架里旧名 Unprocessable Entity 仍然非常常见。',
  },
  {
    code: 423,
    name: 'Locked',
    zh: 'WebDAV：目标资源已被锁定，当前请求无法修改它。',
    category: '4xx',
    source: 'RFC 4918',
    kind: 'standard',
  },
  {
    code: 424,
    name: 'Failed Dependency',
    zh: 'WebDAV：因为所依赖的前一个请求失败了，本次请求没有执行。',
    category: '4xx',
    source: 'RFC 4918',
    kind: 'standard',
  },
  {
    code: 425,
    name: 'Too Early',
    zh: '服务器不愿处理可能被重放的过早请求，典型场景是 TLS 1.3 的 0-RTT 数据。',
    category: '4xx',
    source: 'RFC 8470',
    kind: 'standard',
  },
  {
    code: 426,
    name: 'Upgrade Required',
    zh: '服务器拒绝用当前协议处理请求，响应会带 Upgrade 头指明所需的协议版本。',
    category: '4xx',
    source: 'RFC 9110 §15.5.22',
    kind: 'standard',
  },
  {
    code: 428,
    name: 'Precondition Required',
    zh: '要求请求必须携带前置条件，用于避免"丢失更新"式的并发覆盖。',
    category: '4xx',
    source: 'RFC 6585',
    kind: 'standard',
  },
  {
    code: 429,
    name: 'Too Many Requests',
    zh: '请求过于频繁被限流，响应可以带 Retry-After 指明何时可以重试。',
    category: '4xx',
    source: 'RFC 6585',
    kind: 'standard',
  },
  {
    code: 431,
    name: 'Request Header Fields Too Large',
    zh: '请求头总大小或单个头字段过大，服务器拒绝处理。',
    category: '4xx',
    source: 'RFC 6585',
    kind: 'standard',
  },
  {
    code: 449,
    name: 'Retry With',
    zh: '微软私有码：客户端提供的信息不足，无法满足请求，需要补充信息后重试。',
    category: '4xx',
    source: '非标准 · [MS-WDV] 2.2.6',
    kind: 'nonstandard',
    note: '微软 IIS/WebDAV 的私有扩展码，IANA 从未注册。微软规范的标题写作 449 Retry With，正文给出的 reason phrase 是 Reply With。',
  },
  {
    code: 451,
    name: 'Unavailable For Legal Reasons',
    zh: '因法律原因（法院命令、审查要求等）无法提供该资源；编号致敬小说《华氏451度》。',
    category: '4xx',
    source: 'RFC 7725',
    kind: 'standard',
  },

  // 5xx — Server Error
  {
    code: 500,
    name: 'Internal Server Error',
    zh: '服务器遇到了未预期的内部错误，无法完成请求。',
    category: '5xx',
    source: 'RFC 9110 §15.6.1',
    kind: 'standard',
  },
  {
    code: 501,
    name: 'Not Implemented',
    zh: '服务器不支持完成该请求所需的功能，例如不认识所用的请求方法，或完全不支持代理所需的功能。',
    category: '5xx',
    source: 'RFC 9110 §15.6.2',
    kind: 'standard',
  },
  {
    code: 502,
    name: 'Bad Gateway',
    zh: '作为网关或代理的服务器从上游收到了无效响应。',
    category: '5xx',
    source: 'RFC 9110 §15.6.3',
    kind: 'standard',
  },
  {
    code: 503,
    name: 'Service Unavailable',
    zh: '服务器暂时无法处理请求（过载或停机维护），可以带 Retry-After 说明何时恢复。',
    category: '5xx',
    source: 'RFC 9110 §15.6.4',
    kind: 'standard',
  },
  {
    code: 504,
    name: 'Gateway Timeout',
    zh: '作为网关或代理的服务器未能在限定时间内收到上游的响应。',
    category: '5xx',
    source: 'RFC 9110 §15.6.5',
    kind: 'standard',
  },
  {
    code: 505,
    name: 'HTTP Version Not Supported',
    zh: '服务器不支持请求中使用的 HTTP 主版本。',
    category: '5xx',
    source: 'RFC 9110 §15.6.6',
    kind: 'standard',
  },
  {
    code: 506,
    name: 'Variant Also Negotiates',
    zh: '内容协商时，被选中的变体自身又要求做协商，构成循环，属于服务器配置错误。',
    category: '5xx',
    source: 'RFC 2295',
    kind: 'standard',
  },
  {
    code: 507,
    name: 'Insufficient Storage',
    zh: 'WebDAV：服务器存储空间不足，无法保存请求所要求的结果。',
    category: '5xx',
    source: 'RFC 4918',
    kind: 'standard',
  },
  {
    code: 508,
    name: 'Loop Detected',
    zh: 'WebDAV 绑定：处理请求时检测到无限循环。',
    category: '5xx',
    source: 'RFC 5842',
    kind: 'standard',
  },
  {
    code: 509,
    name: 'Bandwidth Limit Exceeded',
    zh: '非标准码：托管服务商用来表示账号的带宽或流量已经超出限制。',
    category: '5xx',
    source: '非标准 · IANA 未分配',
    kind: 'nonstandard',
    note: 'IANA 注册表中 509 一直是 Unassigned（未分配）；cPanel/Apache 托管环境广泛使用这个名称，Node.js 的 http.STATUS_CODES 也收录了它。',
  },
  {
    code: 510,
    name: 'Not Extended',
    zh: '要求客户端提供更多扩展信息才能继续；现已随所属的 HTTP 扩展实验一并废止。',
    category: '5xx',
    source: 'RFC 2774（IANA 标注 OBSOLETED）',
    kind: 'deprecated',
    note: 'IANA 注册表把 510 标注为 OBSOLETED：RFC 2774 已随 "HTTP 实验转为 Historic" 的状态变更而作废。',
  },
  {
    code: 511,
    name: 'Network Authentication Required',
    zh: '客户端需要先通过网络的认证，例如公共 Wi-Fi 的强制门户（captive portal）。',
    category: '5xx',
    source: 'RFC 6585',
    kind: 'standard',
  },
];

/** The class a code belongs to, or `null` when it is not a valid status code. */
export function categoryOf(code: number): StatusCategory | null {
  // Non-integers, NaN and out-of-range values all fall out here rather than
  // producing a bogus "NaNxx" class.
  if (!Number.isInteger(code) || code < 100 || code > 599) return null;
  return `${Math.floor(code / 100)}xx` as StatusCategory;
}

/**
 * Maps full-width characters to their ASCII equivalents.
 *
 * Chinese input methods routinely produce full-width digits, so a user typing
 * `４０４` on a Chinese keyboard would otherwise get "no results" for a code
 * that plainly exists. Full-width punctuation and the ideographic space are
 * folded too, so they cannot silently break the whitespace splitting below.
 */
export function normalizeWidth(input: string): string {
  let output = '';
  for (const character of input) {
    const point = character.codePointAt(0) ?? 0;
    if (point >= 0xff01 && point <= 0xff5e) {
      output += String.fromCodePoint(point - 0xfee0);
    } else if (point === 0x3000) {
      output += ' ';
    } else {
      output += character;
    }
  }
  return output;
}

/**
 * Splits a query into lower-cased terms.
 *
 * Whitespace separates terms and **all** of them must match, so `404 found`
 * narrows instead of widening. Chinese has no word boundaries, so a one-character
 * Chinese term behaves exactly like a longer one — both are plain substrings.
 */
export function queryTerms(query: string): string[] {
  return normalizeWidth(query).trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Whether one entry satisfies every term of the query.
 *
 * Matching is plain `String.prototype.includes`, never a `RegExp` built from the
 * query: `.*+` is a perfectly reasonable thing to paste into a search box and an
 * invalid regular expression, so compiling the query would throw. Substring
 * matching also means the source citation and the Chinese label are searchable,
 * not just the code.
 */
export function matchesStatusQuery(entry: HttpStatusEntry, query: string): boolean {
  const terms = queryTerms(query);
  if (terms.length === 0) return true;

  const fields = [
    String(entry.code),
    entry.name,
    entry.zh,
    entry.category,
    CATEGORY_META[entry.category].label,
    entry.source,
    KIND_LABELS[entry.kind],
    entry.note ?? '',
  ].map((field) => field.toLowerCase());

  return terms.every((term) => fields.some((field) => field.includes(term)));
}

/**
 * The entries to show for a query and a class filter, sorted by code.
 *
 * The class filter and the search are combined with AND: the tabs are a scope,
 * not a separate view. The returned array is a fresh copy, so a caller cannot
 * sort or splice the module's own table by accident.
 */
export function searchStatusCodes(
  query: string,
  category: StatusCategory | 'all' = 'all',
): HttpStatusEntry[] {
  const pool =
    category === 'all'
      ? HTTP_STATUS_CODES
      : HTTP_STATUS_CODES.filter((entry) => entry.category === category);

  const trimmed = query.trim();
  const matched =
    trimmed === '' ? pool : pool.filter((entry) => matchesStatusQuery(entry, trimmed));

  return matched.slice().sort((left, right) => left.code - right.code);
}

/** How many entries each class has. Used for the tab labels and the summary. */
export function countByCategory(
  entries: HttpStatusEntry[],
): Record<StatusCategory, number> {
  const counts: Record<StatusCategory, number> = {
    '1xx': 0,
    '2xx': 0,
    '3xx': 0,
    '4xx': 0,
    '5xx': 0,
  };
  for (const entry of entries) counts[entry.category] += 1;
  return counts;
}

/**
 * The text copied to the clipboard for an entry.
 *
 * Only the number: the click-to-copy gesture exists to paste a code into source
 * or a test assertion, where `404 Not Found` would be a syntax error. The English
 * name is already on screen for anyone who needs it.
 */
export function statusCodeText(entry: HttpStatusEntry): string {
  return String(entry.code);
}
