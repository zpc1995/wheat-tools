import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Checkbox,
  Divider,
  Dropdown,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Option,
  Tab,
  TabList,
  Text,
  Tooltip,
  makeStyles,
  tokens,
  Toast,
  ToastTitle,
  Toaster,
  useId,
  useToastController,
} from '@fluentui/react-components';
import {
  Add16Regular,
  ArrowClockwise16Regular,
  Checkmark16Regular,
  Copy16Regular,
  Delete16Regular,
  Dismiss16Regular,
  Globe16Regular,
  Send16Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import { JsonTree, type JsonValue } from '../json-formatter/JsonTree';
import {
  DEFAULT_REQUEST,
  METHODS,
  REQUEST_PRESETS,
  buildUrl,
  collectHeaders,
  describeStatus,
  explainError,
  formatMs,
  formatSize,
  isSameOrigin,
  makeRow,
  prepareBody,
  prettyBody,
  readResponseBody,
  readResponseHeaders,
  toCurl,
  type ErrorExplanation,
  type HttpMethod,
  type KeyValue,
  type RequestSpec,
  type ResponseInfo,
} from './httpUtils';

/** History is kept in memory only; URLs often carry tokens or query secrets. */
const MAX_HISTORY = 12;

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  urlRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    padding: '12px 14px',
    flexWrap: 'wrap',
    width: '100%',
  },
  method: {
    minWidth: '118px',
  },
  url: {
    flex: '1 1 320px',
    minWidth: '220px',
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '14px',
  },
  spacer: {
    flex: '1 1 auto',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  kvTable: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  kvHead: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 14px',
    color: tokens.colorNeutralForeground4,
    fontSize: '12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  kvRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  kvInput: {
    flex: '1 1 0',
    minWidth: 0,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '13px',
  },
  kvCheck: {
    flex: 'none',
  },
  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    width: '100%',
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '10px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  statValue: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '16px',
    fontVariantNumeric: 'tabular-nums',
    overflowWrap: 'anywhere',
  },
  body: {
    padding: '12px 14px',
    width: '100%',
    maxHeight: '420px',
    overflow: 'auto',
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12.5px',
    lineHeight: 1.65,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    userSelect: 'text',
  },
  causes: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '14px',
    width: '100%',
  },
  cause: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-start',
  },
  history: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    maxHeight: '240px',
    overflowY: 'auto',
  },
  historyRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '7px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  historyUrl: {
    flex: '1 1 auto',
    minWidth: 0,
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12.5px',
    overflowWrap: 'anywhere',
  },
});

export function HttpClientTool() {
  const styles = useStyles();
  const toasterId = useId('http-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [spec, setSpec] = useState<RequestSpec>(DEFAULT_REQUEST);
  const [params, setParams] = useState<KeyValue[]>([]);
  const [headers, setHeaders] = useState<KeyValue[]>([]);
  const [headerBlock, setHeaderBlock] = useState('');
  const [formRows, setFormRows] = useState<KeyValue[]>([]);
  const [requestTab, setRequestTab] = useState<'params' | 'headers' | 'body'>('params');
  const [responseTab, setResponseTab] = useState<'body' | 'tree' | 'headers'>('body');
  const [response, setResponse] = useState<ResponseInfo | null>(null);
  const [failure, setFailure] = useState<ErrorExplanation | null>(null);
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<Array<{ spec: RequestSpec; status: number | null; elapsed: number | null; at: number }>>([]);
  const [copied, setCopied] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const notify = useCallback(
    (message: string) => {
      dispatchToast(
        <Toast>
          <ToastTitle>{message}</ToastTitle>
        </Toast>,
        { timeout: 1400 },
      );
    },
    [dispatchToast],
  );

  const copy = useCallback(
    async (value: string, key: string) => {
      const ok = await copyText(value);
      if (ok) {
        setCopied(key);
        window.setTimeout(() => setCopied(null), 1400);
        notify('已复制');
      } else {
        notify('复制失败');
      }
    },
    [notify],
  );

  const fullUrl = useMemo(() => buildUrl(spec.url, params), [spec.url, params]);
  const crossOrigin = useMemo(
    () => (spec.url ? !isSameOrigin(fullUrl) : false),
    [fullUrl, spec.url],
  );

  const curl = useMemo(
    () => toCurl(spec, formRows, fullUrl),
    [spec, formRows, fullUrl],
  );

  const headerErrors = useMemo(
    () => collectHeaders(headers, headerBlock).rejected,
    [headers, headerBlock],
  );

  const send = useCallback(async () => {
    if (!fullUrl.trim()) {
      notify('请填写请求地址');
      return;
    }

    const prepared = prepareBody(spec, formRows);
    if (prepared.error) {
      setFailure({
        title: '请求未发送',
        causes: [prepared.error],
        howToCheck: ['修正上方内容后重试'],
      });
      setResponse(null);
      return;
    }

    const { headers: headerMap } = collectHeaders(headers, headerBlock);
    if (prepared.contentType && !Object.keys(headerMap).some((k) => k.toLowerCase() === 'content-type')) {
      headerMap['Content-Type'] = prepared.contentType;
    }

    // Timeout is enforced with an abort signal, since fetch has no timeout of
    // its own and would otherwise hang until the browser gives up.
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = window.setTimeout(() => controller.abort(), spec.timeoutMs);

    setSending(true);
    setFailure(null);
    setResponse(null);

    const startedAt = performance.now();

    try {
      const result = await fetch(fullUrl, {
        method: spec.method,
        headers: headerMap,
        body: prepared.body,
        redirect: spec.redirect,
        signal: controller.signal,
        // Credentials are never sent implicitly: a tool that silently attaches
        // cookies to arbitrary origins is a CSRF vector.
        credentials: 'omit',
        cache: 'no-store',
      });

      const elapsedMs = performance.now() - startedAt;
      const body = await readResponseBody(result);
      const { headers: responseHeaders, hiddenHeaders } = readResponseHeaders(result);

      setResponse({
        status: result.status,
        statusText: result.statusText,
        ok: result.ok,
        url: result.url,
        opaque: result.type === 'opaque',
        headers: responseHeaders,
        hiddenHeaders,
        bodyText: body.text,
        bodyBytes: body.bytes,
        binary: body.binary,
        contentType: result.headers.get('content-type') ?? '',
        redirected: result.redirected,
        elapsedMs,
      });

      setHistory((previous) =>
        [
          { spec, status: result.status, elapsed: elapsedMs, at: Date.now() },
          ...previous,
        ].slice(0, MAX_HISTORY),
      );
    } catch (error) {
      const elapsedMs = performance.now() - startedAt;
      setFailure(explainError(error, { method: spec.method, url: fullUrl }));
      setHistory((previous) =>
        [
          { spec, status: null, elapsed: elapsedMs, at: Date.now() },
          ...previous,
        ].slice(0, MAX_HISTORY),
      );
    } finally {
      window.clearTimeout(timer);
      setSending(false);
      abortRef.current = null;
    }
  }, [fullUrl, spec, formRows, headers, headerBlock, notify]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Abort any in-flight request when the tool unmounts, so a slow request
  // cannot resolve into a component that no longer exists.
  useEffect(() => () => abortRef.current?.abort(), []);

  const addRow = (setter: React.Dispatch<React.SetStateAction<KeyValue[]>>) => () =>
    setter((previous) => [...previous, makeRow()]);

  const updateRow = (
    setter: React.Dispatch<React.SetStateAction<KeyValue[]>>,
    id: string,
    patch: Partial<KeyValue>,
  ) =>
    setter((previous) =>
      previous.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );

  const removeRow = (
    setter: React.Dispatch<React.SetStateAction<KeyValue[]>>,
    id: string,
  ) => setter((previous) => previous.filter((row) => row.id !== id));

  const renderKvTable = (
    rows: KeyValue[],
    setter: React.Dispatch<React.SetStateAction<KeyValue[]>>,
    keyPlaceholder: string,
    valuePlaceholder: string,
  ) => (
    <div className={styles.kvTable}>
      <div className={styles.kvHead}>
        <span style={{ width: 24 }} />
        <span style={{ flex: '1 1 0' }}>{keyPlaceholder}</span>
        <span style={{ flex: '1 1 0' }}>{valuePlaceholder}</span>
        <span style={{ width: 32 }} />
      </div>
      {rows.map((row) => (
        <div key={row.id} className={styles.kvRow}>
          <Checkbox
            className={styles.kvCheck}
            checked={row.enabled}
            onChange={(_, data) =>
              updateRow(setter, row.id, { enabled: Boolean(data.checked) })
            }
            aria-label="启用该项"
          />
          <input
            className={`wt-inline-input ${styles.kvInput}`}
            value={row.key}
            onChange={(event) => updateRow(setter, row.id, { key: event.target.value })}
            placeholder={keyPlaceholder}
            aria-label={keyPlaceholder}
            spellCheck={false}
          />
          <input
            className={`wt-inline-input ${styles.kvInput}`}
            value={row.value}
            onChange={(event) => updateRow(setter, row.id, { value: event.target.value })}
            placeholder={valuePlaceholder}
            aria-label={valuePlaceholder}
            spellCheck={false}
          />
          <Tooltip content="删除该行" relationship="label" withArrow>
            <Button
              appearance="subtle"
              size="small"
              icon={<Delete16Regular />}
              onClick={() => removeRow(setter, row.id)}
              aria-label="删除该行"
            />
          </Tooltip>
        </div>
      ))}
      <div className={styles.kvRow}>
        <Button
          appearance="subtle"
          size="small"
          icon={<Add16Regular />}
          onClick={addRow(setter)}
        >
          添加一行
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        {/* The single most important thing to state, before anything else: a
            browser cannot read most cross-origin responses, and the failure
            gives no reason. Users otherwise conclude the tool is broken. */}
        <MessageBar intent="warning">
          <MessageBarBody>
            <MessageBarTitle>
              <Warning16Regular /> 浏览器只能读取「允许跨域」的响应
            </MessageBarTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span>
                出于安全限制，页面脚本要读取跨域响应，必须由对方服务器返回{' '}
                <code>Access-Control-Allow-Origin</code> 等允许跨域的响应头。
                如果对方没有返回，请求就会失败——而浏览器故意不把失败原因告诉脚本。
              </span>
              <span>
                这意味着在 JavaScript 里，CORS 被拒、域名解析失败、服务器拒绝连接
                这三种情况的表象完全一致（都只是 <code>Failed to fetch</code>），
                没有任何 API 能区分它们。所以本工具不会猜测原因，而是列出可能性
                并告诉你怎么确认。
              </span>
              <span>
                想在浏览器里正常使用，请把地址指向你控制、且允许跨域的接口；
                或者先用下方生成的 curl 命令在命令行确认服务端本身是否正常——
                若 curl 能通而这里不能，基本可以确定是 CORS。
              </span>
            </div>
          </MessageBarBody>
        </MessageBar>

        <section className="wt-surface" aria-label="请求">
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.urlRow}>
              <Dropdown
                className={styles.method}
                value={spec.method}
                selectedOptions={[spec.method]}
                onOptionSelect={(_, data) =>
                  setSpec((current) => ({
                    ...current,
                    method: data.optionValue as HttpMethod,
                  }))
                }
                aria-label="请求方法"
              >
                {METHODS.map((method) => (
                  <Option key={method} value={method} text={method}>
                    {method}
                  </Option>
                ))}
              </Dropdown>

              <input
                className={`wt-inline-input ${styles.url}`}
                value={spec.url}
                onChange={(event) =>
                  setSpec((current) => ({ ...current, url: event.target.value }))
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !sending) void send();
                }}
                placeholder="https://api.example.com/endpoint"
                aria-label="请求地址"
                spellCheck={false}
              />

              {sending ? (
                <Button
                  appearance="secondary"
                  icon={<Dismiss16Regular />}
                  onClick={cancel}
                >
                  取消
                </Button>
              ) : (
                <Button
                  appearance="primary"
                  icon={<Send16Regular />}
                  onClick={() => void send()}
                >
                  发送
                </Button>
              )}
            </div>

            {spec.url && crossOrigin && (
              <div className={styles.urlRow} style={{ paddingTop: 0 }}>
                <Badge appearance="tint" color="warning" size="small">
                  跨域请求
                </Badge>
                <Caption1 className={styles.hint}>
                  能否读到响应取决于对方是否返回 CORS 头；若失败请用下方 curl 对照
                </Caption1>
              </div>
            )}

            <Divider />

            <div className={styles.urlRow} style={{ paddingBottom: 4 }}>
              <Caption1 className={styles.hint}>超时</Caption1>
              <Dropdown
                style={{ minWidth: 110 }}
                value={`${spec.timeoutMs / 1000} 秒`}
                selectedOptions={[String(spec.timeoutMs)]}
                onOptionSelect={(_, data) =>
                  setSpec((current) => ({
                    ...current,
                    timeoutMs: Number(data.optionValue),
                  }))
                }
                aria-label="超时时间"
              >
                {[3000, 5000, 10000, 15000, 30000, 60000].map((ms) => (
                  <Option key={ms} value={String(ms)} text={`${ms / 1000} 秒`}>
                    {ms / 1000} 秒
                  </Option>
                ))}
              </Dropdown>

              <Caption1 className={styles.hint}>重定向</Caption1>
              <Dropdown
                style={{ minWidth: 130 }}
                value={spec.redirect === 'follow' ? '自动跟随' : '不跟随（看 3xx）'}
                selectedOptions={[spec.redirect]}
                onOptionSelect={(_, data) =>
                  setSpec((current) => ({
                    ...current,
                    redirect: data.optionValue as RequestRedirect,
                  }))
                }
                aria-label="重定向处理"
              >
                <Option value="follow" text="自动跟随">
                  自动跟随
                </Option>
                <Option value="manual" text="不跟随（看 3xx）">
                  不跟随（看 3xx）
                </Option>
              </Dropdown>

              <span className={styles.spacer} />

              <Tooltip content="复制可复现该请求的 curl 命令" relationship="label" withArrow>
                <Button
                  appearance="subtle"
                  size="small"
                  icon={copied === 'curl' ? <Checkmark16Regular /> : <Copy16Regular />}
                  onClick={() => copy(curl, 'curl')}
                  aria-label="复制 curl 命令"
                >
                  curl
                </Button>
              </Tooltip>
            </div>
          </div>
        </section>

        <section className="wt-surface" aria-label="请求配置">
          <div className="wt-surface__header">
            <TabList
              selectedValue={requestTab}
              onTabSelect={(_, data) =>
                setRequestTab(data.value as 'params' | 'headers' | 'body')
              }
            >
              <Tab value="params">
                参数{params.filter((r) => r.enabled && r.key.trim()).length > 0 &&
                  ` (${params.filter((r) => r.enabled && r.key.trim()).length})`}
              </Tab>
              <Tab value="headers">
                请求头{headers.filter((r) => r.enabled && r.key.trim()).length > 0 &&
                  ` (${headers.filter((r) => r.enabled && r.key.trim()).length})`}
              </Tab>
              <Tab value="body">请求体</Tab>
            </TabList>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>{fullUrl}</Caption1>
          </div>

          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            {headerErrors.length > 0 && (
              <div style={{ padding: '10px 14px', width: '100%' }}>
                <MessageBar intent="warning">
                  <MessageBarBody>
                    {headerErrors.length} 个请求头不会被发送：
                    {headerErrors.map((item) => `${item.key}（${item.reason}）`).join('；')}
                  </MessageBarBody>
                </MessageBar>
              </div>
            )}

            {requestTab === 'params' &&
              renderKvTable(params, setParams, '参数名', '参数值')}

            {requestTab === 'headers' && (
              <>
                {renderKvTable(headers, setHeaders, 'Header 名', 'Header 值')}
                <div style={{ padding: '0 14px 14px', width: '100%' }}>
                  <Caption1 className={styles.hint}>
                    也可以直接粘贴整段请求头（每行「名称: 值」，支持 # 注释）：
                  </Caption1>
                  <textarea
                    className="wt-code-area"
                    style={{ minHeight: '90px', marginTop: 6 }}
                    value={headerBlock}
                    onChange={(event) => setHeaderBlock(event.target.value)}
                    placeholder={'Content-Type: application/json\nAuthorization: Bearer xxx'}
                    aria-label="请求头文本块"
                    spellCheck={false}
                  />
                </div>
              </>
            )}

            {requestTab === 'body' && (
              <div style={{ padding: '12px 14px', width: '100%' }}>
                <TabList
                  size="small"
                  selectedValue={spec.bodyMode}
                  onTabSelect={(_, data) =>
                    setSpec((current) => ({
                      ...current,
                      bodyMode: data.value as RequestSpec['bodyMode'],
                    }))
                  }
                >
                  <Tab value="none">无</Tab>
                  <Tab value="json">JSON</Tab>
                  <Tab value="form">表单</Tab>
                  <Tab value="text">纯文本</Tab>
                </TabList>

                {spec.bodyMode === 'none' && (
                  <Caption1 className={styles.hint} style={{ display: 'block', marginTop: 10 }}>
                    该请求不携带请求体。
                  </Caption1>
                )}

                {spec.bodyMode === 'form' &&
                  renderKvTable(formRows, setFormRows, '字段名', '字段值')}

                {(spec.bodyMode === 'json' || spec.bodyMode === 'text') && (
                  <textarea
                    className="wt-code-area"
                    style={{ marginTop: 10 }}
                    value={spec.body}
                    onChange={(event) =>
                      setSpec((current) => ({ ...current, body: event.target.value }))
                    }
                    placeholder={
                      spec.bodyMode === 'json' ? '{\n  "key": "value"\n}' : '请求体内容…'
                    }
                    aria-label="请求体"
                    spellCheck={false}
                  />
                )}

                {spec.bodyMode === 'json' && (
                  <Caption1 className={styles.hint} style={{ display: 'block', marginTop: 6 }}>
                    JSON 会被校验并重新序列化后发送，Content-Type 自动设为 application/json。
                  </Caption1>
                )}
              </div>
            )}
          </div>
        </section>

        {failure && (
          <MessageBar intent="error">
            <MessageBarBody>
              <MessageBarTitle>{failure.title}</MessageBarTitle>
              <div className={styles.causes}>
                <Caption1 style={{ color: tokens.colorNeutralForeground1 }}>
                  可能的原因（无法从脚本判断是哪一种）：
                </Caption1>
                {failure.causes.map((cause) => (
                  <div key={cause} className={styles.cause}>
                    <Warning16Regular style={{ flex: 'none', marginTop: 2 }} />
                    <Caption1>{cause}</Caption1>
                  </div>
                ))}
                <Caption1
                  style={{ color: tokens.colorNeutralForeground1, marginTop: 6 }}
                >
                  如何确认：
                </Caption1>
                {failure.howToCheck.map((item) => (
                  <div key={item} className={styles.cause}>
                    <Checkmark16Regular style={{ flex: 'none', marginTop: 2 }} />
                    <Caption1>{item}</Caption1>
                  </div>
                ))}
              </div>
            </MessageBarBody>
          </MessageBar>
        )}

        {response && (
          <>
            <section className="wt-surface" aria-label="响应">
              <div className="wt-surface__header">
                <Globe16Regular />
                <Text as="h2" size={300} weight="semibold">
                  响应
                </Text>
                <Badge
                  appearance="tint"
                  size="small"
                  color={
                    describeStatus(response.status).tone === 'success'
                      ? 'success'
                      : describeStatus(response.status).tone === 'client' ||
                          describeStatus(response.status).tone === 'server'
                        ? 'danger'
                        : 'warning'
                  }
                >
                  {response.status} {response.statusText || describeStatus(response.status).label}
                </Badge>
                {response.opaque && (
                  <Badge appearance="tint" color="warning" size="small">
                    opaque 响应，内容不可读
                  </Badge>
                )}
                <span className={styles.spacer} />
                <TabList
                  size="small"
                  selectedValue={responseTab}
                  onTabSelect={(_, data) =>
                    setResponseTab(data.value as 'body' | 'tree' | 'headers')
                  }
                >
                  <Tab value="body">正文</Tab>
                  <Tab value="tree">结构</Tab>
                  <Tab value="headers">
                    响应头 ({response.headers.length})
                  </Tab>
                </TabList>
                {!response.binary && response.bodyText && (
                  <Tooltip content="复制正文" relationship="label" withArrow>
                    <Button
                      appearance="subtle"
                      size="small"
                      icon={
                        copied === 'body' ? <Checkmark16Regular /> : <Copy16Regular />
                      }
                      onClick={() =>
                        copy(
                          prettyBody(response.bodyText, response.contentType),
                          'body',
                        )
                      }
                      aria-label="复制正文"
                    />
                  </Tooltip>
                )}
              </div>

              <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
                <div className={`${styles.stats}`}>
                  {[
                    ['耗时', formatMs(response.elapsedMs)],
                    ['体积', formatSize(response.bodyBytes)],
                    ['Content-Type', response.contentType || '（未提供）'],
                    ['最终地址', response.url || fullUrl],
                    ['重定向', response.redirected ? '已跟随' : '未发生'],
                  ].map(([label, value]) => (
                    <div key={label} className={styles.stat}>
                      <Caption1 className={styles.hint}>{label}</Caption1>
                      <span className={styles.statValue}>{value}</span>
                    </div>
                  ))}
                </div>

                <Divider />

                {responseTab === 'body' &&
                  (response.binary ? (
                    <div className={styles.body}>
                      <Caption1 className={styles.hint}>
                        响应看起来是二进制内容（含较多控制字符），未以文本显示。
                        共 {formatSize(response.bodyBytes)}，可用「下载」保存或改用文件类工具查看。
                      </Caption1>
                    </div>
                  ) : response.bodyText ? (
                    <div className={styles.body}>
                      {prettyBody(response.bodyText, response.contentType)}
                    </div>
                  ) : (
                    <div className={styles.body}>
                      <Caption1 className={styles.hint}>
                        响应正文为空（{response.status === 204 ? '204 No Content' : '服务端未返回内容'}）。
                      </Caption1>
                    </div>
                  ))}

                {responseTab === 'tree' && (
                  <div className={styles.body}>
                    {(() => {
                      try {
                        const parsed = JSON.parse(response.bodyText) as JsonValue;
                        return <JsonTree value={parsed} defaultExpandDepth={4} />;
                      } catch {
                        return (
                          <Caption1 className={styles.hint}>
                            正文不是 JSON，无法以结构显示。
                          </Caption1>
                        );
                      }
                    })()}
                  </div>
                )}

                {responseTab === 'headers' && (
                  <div className={styles.kvTable}>
                    {response.headers.length === 0 ? (
                      <div className={styles.kvRow}>
                        <Caption1 className={styles.hint}>
                          没有可读取的响应头。
                        </Caption1>
                      </div>
                    ) : (
                      response.headers.map((header) => (
                        <div key={header.name} className={styles.kvRow}>
                          <span
                            className={styles.kvInput}
                            style={{ color: tokens.colorBrandForeground1 }}
                          >
                            {header.name}
                          </span>
                          <span className={styles.kvInput}>{header.value}</span>
                          <Tooltip content="复制该响应头" relationship="label" withArrow>
                            <Button
                              appearance="subtle"
                              size="small"
                              icon={<Copy16Regular />}
                              onClick={() =>
                                copy(`${header.name}: ${header.value}`, header.name)
                              }
                              aria-label="复制该响应头"
                            />
                          </Tooltip>
                        </div>
                      ))
                    )}
                    <div className={styles.kvRow}>
                      <Caption1 className={styles.hint}>
                        浏览器不向脚本暴露 set-cookie 等敏感响应头；
                        若服务端设置了 Cookie，这里看不到。
                      </Caption1>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </>
        )}

        <section className="wt-surface" aria-label="快捷请求">
          <div className="wt-surface__header">
            <Text as="h2" size={300} weight="semibold">
              快捷请求
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>
              前几个地址允许跨域，可直接看到完整响应
            </Caption1>
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.urlRow}>
              {REQUEST_PRESETS.map((preset) => (
                <Tooltip
                  key={preset.label}
                  content={preset.note}
                  relationship="description"
                  withArrow
                >
                  <Button
                    appearance={
                      preset.label === 'CORS 受限示例' ? 'outline' : 'secondary'
                    }
                    size="small"
                    onClick={() =>
                      setSpec((current) => ({ ...current, ...preset.spec }))
                    }
                  >
                    {preset.label}
                  </Button>
                </Tooltip>
              ))}
              <Tooltip content="清空参数、请求头与响应" relationship="label" withArrow>
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<ArrowClockwise16Regular />}
                  onClick={() => {
                    setParams([]);
                    setHeaders([]);
                    setHeaderBlock('');
                    setFormRows([]);
                    setResponse(null);
                    setFailure(null);
                  }}
                >
                  重置
                </Button>
              </Tooltip>
            </div>
          </div>
        </section>

        {history.length > 0 && (
          <section className="wt-surface" aria-label="本次会话历史">
            <div className="wt-surface__header">
              <Text as="h2" size={300} weight="semibold">
                本次会话历史
              </Text>
              <span className={styles.spacer} />
              <Tooltip
                content="只在内存中保留：请求地址常带 token 或参数，写进 localStorage 会留下长期痕迹"
                relationship="description"
                withArrow
              >
                <Caption1 className={styles.hint}>不写入本地存储</Caption1>
              </Tooltip>
              <Button
                appearance="subtle"
                size="small"
                onClick={() => setHistory([])}
              >
                清空
              </Button>
            </div>
            <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
              <div className={styles.history}>
                {history.map((entry, index) => (
                  <div key={`${entry.at}-${index}`} className={styles.historyRow}>
                    <Badge
                      appearance="tint"
                      size="small"
                      color={entry.status === null ? 'danger' : 'success'}
                    >
                      {entry.status ?? '失败'}
                    </Badge>
                    <span className={styles.historyUrl}>{entry.spec.url}</span>
                    {entry.elapsed !== null && (
                      <Caption1 className={styles.hint}>
                        {formatMs(entry.elapsed)}
                      </Caption1>
                    )}
                    <Button
                      appearance="subtle"
                      size="small"
                      onClick={() =>
                        setSpec((current) => ({
                          ...current,
                          ...entry.spec,
                        }))
                      }
                    >
                      载入
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="wt-surface" aria-label="curl 命令">
          <div className="wt-surface__header">
            <Text as="h2" size={300} weight="semibold">
              curl 对照命令
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>
              在命令行执行可排除 CORS 因素
            </Caption1>
            <Tooltip content="复制" relationship="label" withArrow>
              <Button
                appearance="subtle"
                size="small"
                icon={copied === 'curl2' ? <Checkmark16Regular /> : <Copy16Regular />}
                onClick={() => copy(curl, 'curl2')}
                aria-label="复制 curl 命令"
              />
            </Tooltip>
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.body}>{curl}</div>
          </div>
        </section>

        <Divider />
      </div>
    </>
  );
}
