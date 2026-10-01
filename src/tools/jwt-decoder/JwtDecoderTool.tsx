import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Divider,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
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
  Broom16Regular,
  Checkmark16Regular,
  Copy16Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import { JsonTree, type JsonValue } from '../json-formatter/JsonTree';
import {
  CLAIM_NOTES,
  SAMPLE_JWT,
  auditHeader,
  checkExpiry,
  decodeJwt,
  extractTimeClaims,
} from './jwtUtils';

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px',
  },
  spacer: {
    flex: '1 1 auto',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  rows: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  row: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '10px',
    padding: '8px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none' },
  },
  rowLabel: {
    flex: 'none',
    width: '150px',
    color: tokens.colorNeutralForeground3,
  },
  rowValue: {
    flex: '1 1 auto',
    minWidth: 0,
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12.5px',
  },
  tree: {
    padding: '10px 14px',
    maxHeight: '360px',
    overflow: 'auto',
    width: '100%',
  },
  token: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12.5px',
    overflowWrap: 'anywhere',
    userSelect: 'all',
    lineHeight: 1.9,
    padding: '12px 14px',
    width: '100%',
  },
  /** Distinct colours for the three segments, echoed from the decoded panels. */
  header: { color: tokens.colorPaletteRedForeground1 },
  payload: { color: tokens.colorPaletteGreenForeground2 },
  signature: { color: tokens.colorPaletteBlueForeground2 },
});

export function JwtDecoderTool() {
  const styles = useStyles();
  const toasterId = useId('jwt-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [token, setToken] = useState('');
  const [tab, setTab] = useState<'payload' | 'header'>('payload');
  const [copied, setCopied] = useState<string | null>(null);

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

  const decoded = useMemo(() => decodeJwt(token), [token]);

  const timeClaims = useMemo(
    () => (decoded.ok ? extractTimeClaims(decoded.parts.payload) : []),
    [decoded],
  );

  const expiry = useMemo(
    () => (decoded.ok ? checkExpiry(decoded.parts.payload) : null),
    [decoded],
  );

  const headerNotes = useMemo(
    () => (decoded.ok ? auditHeader(decoded.parts.header) : []),
    [decoded],
  );

  /** Known claims present in the payload, for the annotation panel. */
  const annotations = useMemo(() => {
    if (!decoded.ok) return [];
    return Object.entries(CLAIM_NOTES)
      .filter(([key]) => key in decoded.parts.payload)
      .map(([key, note]) => ({ key, note }));
  }, [decoded]);

  const segments = useMemo(() => {
    const parts = token.trim().split('.');
    return parts.length === 3 ? parts : null;
  }, [token]);

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <div className={styles.toolbar}>
          <Button
            appearance="secondary"
            onClick={() => setToken(SAMPLE_JWT)}
          >
            载入示例
          </Button>
          <Tooltip content="只解码，不验签" relationship="description" withArrow>
            <Badge appearance="tint" color="warning" size="medium">
              仅解码 · 不验证签名
            </Badge>
          </Tooltip>
          <span className={styles.spacer} />
          <Tooltip content="清空" relationship="label" withArrow>
            <Button
              appearance="subtle"
              icon={<Broom16Regular />}
              onClick={() => setToken('')}
              disabled={!token}
              aria-label="清空"
            />
          </Tooltip>
        </div>

        {/* The single most important thing to communicate about this tool. */}
        <MessageBar intent="warning">
          <MessageBarBody>
            <MessageBarTitle>
              <Warning16Regular /> 解码成功不代表令牌可信
            </MessageBarTitle>
            JWT 的 header 与 payload 只是 Base64URL 编码，并没有加密——
            任何人都能读取，也能在不知道密钥的情况下修改内容。
            因此「能解开」完全不能说明令牌是真的。真正的验签必须在持有密钥的服务端完成，
            并且必须校验算法、签发者与受众。本工具只帮你查看内容与时间声明。
          </MessageBarBody>
        </MessageBar>

        <section className="wt-surface" aria-label="JWT 输入">
          <div className="wt-surface__header">
            <Text as="h2" size={300} weight="semibold">
              JWT
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>
              三段分别对应 Header · Payload · Signature
            </Caption1>
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <textarea
              className="wt-code-area"
              style={{ minHeight: '110px' }}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="粘贴 JWT（形如 xxxxx.yyyyy.zzzzz）"
              aria-label="JWT 输入"
              spellCheck={false}
            />
            {segments && (
              <div className={styles.token}>
                <span className={styles.header}>{segments[0]}</span>
                <span className={styles.hint}>.</span>
                <span className={styles.payload}>{segments[1]}</span>
                <span className={styles.hint}>.</span>
                <span className={styles.signature}>{segments[2]}</span>
              </div>
            )}
          </div>
        </section>

        {!decoded.ok && token.trim() && (
          <MessageBar intent="error">
            <MessageBarBody>{decoded.error}</MessageBarBody>
          </MessageBar>
        )}

        {decoded.ok && (
          <>
            {expiry && (
              <MessageBar
                intent={
                  expiry.state === 'expired' || expiry.state === 'not-yet-valid'
                    ? 'error'
                    : expiry.state === 'none'
                      ? 'warning'
                      : 'success'
                }
              >
                <MessageBarBody>
                  <MessageBarTitle>时间声明</MessageBarTitle>
                  {expiry.message}
                </MessageBarBody>
              </MessageBar>
            )}

            {headerNotes.length > 0 && (
              <MessageBar intent="warning">
                <MessageBarBody>
                  <MessageBarTitle>算法相关提醒</MessageBarTitle>
                  {headerNotes.join('；')}
                </MessageBarBody>
              </MessageBar>
            )}

            <section className="wt-surface" aria-label="解码内容">
              <div className="wt-surface__header">
                <Text as="h2" size={300} weight="semibold">
                  解码内容
                </Text>
                <span className={styles.spacer} />
                <TabList
                  size="small"
                  selectedValue={tab}
                  onTabSelect={(_, data) =>
                    setTab(data.value as 'payload' | 'header')
                  }
                >
                  <Tab value="payload">Payload</Tab>
                  <Tab value="header">Header</Tab>
                </TabList>
                <Tooltip content="复制 JSON" relationship="label" withArrow>
                  <Button
                    appearance="subtle"
                    icon={
                      copied === 'json' ? (
                        <Checkmark16Regular />
                      ) : (
                        <Copy16Regular />
                      )
                    }
                    onClick={() =>
                      copy(
                        JSON.stringify(
                          tab === 'payload'
                            ? decoded.parts.payload
                            : decoded.parts.header,
                          null,
                          2,
                        ),
                        'json',
                      )
                    }
                    aria-label="复制 JSON"
                  />
                </Tooltip>
              </div>
              <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
                <div className={styles.tree}>
                  <JsonTree
                    value={
                      (tab === 'payload'
                        ? decoded.parts.payload
                        : decoded.parts.header) as JsonValue
                    }
                    defaultExpandDepth={4}
                  />
                </div>
              </div>
            </section>

            <section className="wt-surface" aria-label="时间声明">
              <div className="wt-surface__header">
                <Text as="h2" size={300} weight="semibold">
                  时间声明（时间戳 → 可读时间）
                </Text>
                <span className={styles.spacer} />
                <Caption1 className={styles.hint}>
                  按本机时间比较
                </Caption1>
              </div>
              <div className={`wt-surface__body ${styles.rows}`}>
                {timeClaims.length > 0 ? (
                  timeClaims.map((claim) => (
                    <div key={claim.name} className={styles.row}>
                      <span className={styles.rowLabel}>{claim.name}</span>
                      <span className={`${styles.rowValue} ${styles.mono}`}>
                        {claim.value} → {claim.iso}
                      </span>
                      <Badge
                        appearance="tint"
                        color={claim.state === 'past' ? 'informative' : 'success'}
                        size="small"
                      >
                        {claim.relative}
                      </Badge>
                    </div>
                  ))
                ) : (
                  <div className={styles.row}>
                    <Caption1 className={styles.hint}>
                      Payload 中没有 exp / iat / nbf 等时间声明
                    </Caption1>
                  </div>
                )}
              </div>
            </section>

            {annotations.length > 0 && (
              <section className="wt-surface" aria-label="声明说明">
                <div className="wt-surface__header">
                  <Text as="h2" size={300} weight="semibold">
                    标准声明含义
                  </Text>
                  <span className={styles.spacer} />
                  <Caption1 className={styles.hint}>
                    仅列出现有字段
                  </Caption1>
                </div>
                <div className={`wt-surface__body ${styles.rows}`}>
                  {annotations.map((item) => (
                    <div key={item.key} className={styles.row}>
                      <span className={`${styles.rowLabel} ${styles.mono}`}>
                        {item.key}
                      </span>
                      <span className={styles.rowValue}>
                        <Caption1 className={styles.hint}>{item.note}</Caption1>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="wt-surface" aria-label="签名段">
              <div className="wt-surface__header">
                <Text as="h2" size={300} weight="semibold">
                  Signature
                </Text>
                <span className={styles.spacer} />
                <Caption1 className={styles.hint}>
                  未验证；如需验签请在服务端进行
                </Caption1>
              </div>
              <div className={`wt-surface__body ${styles.rows}`}>
                <div className={styles.row}>
                  <span className={`${styles.rowValue} ${styles.mono}`}>
                    {decoded.parts.signature || '(空)'}
                  </span>
                  <Tooltip content="复制签名段" relationship="label" withArrow>
                    <Button
                      appearance="subtle"
                      size="small"
                      icon={
                        copied === 'sig' ? (
                          <Checkmark16Regular />
                        ) : (
                          <Copy16Regular />
                        )
                      }
                      onClick={() => copy(decoded.parts.signature, 'sig')}
                      aria-label="复制签名段"
                    />
                  </Tooltip>
                </div>
              </div>
            </section>
          </>
        )}

        <Caption1 className={styles.hint} style={{ padding: '0 4px' }}>
          提示：令牌常含用户标识与权限信息，粘贴到任何在线工具都等于把它交给了第三方。
          本工具在浏览器本地解码，不会发送令牌。
        </Caption1>

        <Divider />
      </div>
    </>
  );
}
