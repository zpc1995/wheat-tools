import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Divider,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
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
  ArrowSync16Regular,
  Checkmark16Regular,
  Copy16Regular,
  Globe16Regular,
  Location16Regular,
  Search16Regular,
  Shield16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import {
  lookupBothFamilies,
  lookupIp,
  lookupMany,
  mapLink,
  type IpDetails,
  type IpFamily,
  type OwnAddress,
} from './ipUtils';

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  hero: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    padding: '26px 20px 18px',
  },
  ip: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: 'clamp(22px, 3.6vw, 36px)',
    fontWeight: 600,
    letterSpacing: '0.5px',
    userSelect: 'all',
    textAlign: 'center',
    overflowWrap: 'anywhere',
  },
  heroMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    width: '100%',
  },
  families: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '1px',
    width: '100%',
    backgroundColor: tokens.colorNeutralStroke3,
  },
  familyCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '18px 16px',
    backgroundColor: tokens.colorNeutralBackground1,
    minWidth: 0,
  },
  familyHead: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  familyIp: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: 'clamp(16px, 2vw, 21px)',
    fontWeight: 600,
    userSelect: 'all',
    overflowWrap: 'anywhere',
  },
  familyMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    flexWrap: 'wrap',
  },
  familyGeo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    marginTop: '2px',
  },
  cell: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '10px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  cellLabel: {
    color: tokens.colorNeutralForeground3,
  },
  cellValue: {
    overflowWrap: 'anywhere',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 14px',
    flexWrap: 'wrap',
  },
  spacer: {
    flex: '1 1 auto',
  },
  hint: {
    color: tokens.colorNeutralForeground3,
  },
  center: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    padding: '40px 20px',
  },
  mono: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
  },
});

export function IpLookupTool() {
  const styles = useStyles();
  const toasterId = useId('ip-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [own, setOwn] = useState<Partial<Record<IpFamily, OwnAddress>>>({});
  const [geo, setGeo] = useState<Partial<Record<IpFamily, IpDetails>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [manualResult, setManualResult] = useState<IpDetails | null>(null);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
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
    async (value: string) => {
      const ok = await copyText(value);
      if (ok) {
        setCopied(value);
        window.setTimeout(() => setCopied(null), 1400);
        notify('已复制');
      } else {
        notify('复制失败');
      }
    },
    [notify],
  );

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setOwn({});
    setGeo({});

    let addresses;
    try {
      addresses = await lookupBothFamilies();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setLoading(false);
      return;
    }

    // Show both addresses as soon as they are known; geography loads after so
    // a slow geo lookup never delays the addresses themselves.
    const found: Partial<Record<IpFamily, OwnAddress>> = {};
    if (addresses.ipv4) found.IPv4 = addresses.ipv4;
    if (addresses.ipv6) found.IPv6 = addresses.ipv6;
    setOwn(found);
    setLoading(false);

    if (Object.keys(found).length === 0) {
      setError(
        '无法探测到任何公网地址：IPv4 与 IPv6 的探测服务都不可达，可能是网络受限或这些域名被拦截。',
      );
      return;
    }

    const enriched = await lookupMany(
      Object.values(found).map((item) => ({ family: item.family, ip: item.ip })),
    );
    setGeo(enriched);
  }, []);

  // Auto-query on open: the tool's whole purpose is to show the current IP.
  useEffect(() => {
    void run();
  }, [run]);

  const runManual = useCallback(async () => {
    const address = manual.trim();
    if (!address) return;
    setManualLoading(true);
    setManualError(null);
    try {
      setManualResult(await lookupIp(address));
    } catch (caught) {
      setManualResult(null);
      setManualError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setManualLoading(false);
    }
  }, [manual]);

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        <MessageBar intent="info">
          <MessageBarBody>
            <MessageBarTitle>此工具会向第三方发起网络请求</MessageBarTitle>
            本站是纯静态页面、没有后端，因此查询出口 IP 必须由浏览器直接请求第三方接口
            （ipwho.is）。该请求会把你的 IP 暴露给该服务，并受其隐私政策约束；
            其余工具均在本地运行，不产生任何网络请求。
          </MessageBarBody>
        </MessageBar>

        <section className="wt-surface" aria-label="公网 IP">
          <div className="wt-surface__header">
            <Globe16Regular />
            <Text as="h2" size={300} weight="semibold">
              我的公网 IP
            </Text>
            <span className={styles.spacer} />
            <Button
              appearance="secondary"
              icon={<ArrowSync16Regular />}
              onClick={() => void run()}
              disabled={loading}
            >
              重新查询
            </Button>
          </div>

          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            {loading ? (
              <div className={styles.center}>
                <Spinner size="small" />
                <Text>正在查询…</Text>
              </div>
            ) : error ? (
              <div className={styles.center} style={{ flexDirection: 'column' }}>
                <Text weight="semibold">查询失败</Text>
                <Caption1 className={styles.hint}>{error}</Caption1>
                <Button appearance="primary" onClick={() => void run()}>
                  重试
                </Button>
              </div>
            ) : (
              <>
                <div className={styles.families}>
                  {(['IPv4', 'IPv6'] as const).map((family) => {
                    const address = own[family] ?? null;
                    const details = geo[family] ?? null;

                    return (
                      <div key={family} className={styles.familyCard}>
                        <div className={styles.familyHead}>
                          <Badge
                            appearance="tint"
                            color={address ? (family === 'IPv6' ? 'success' : 'brand') : 'informative'}
                            size="medium"
                          >
                            {family}
                          </Badge>
                          {address ? (
                            <Badge appearance="tint" color="success" size="small">
                              可用
                            </Badge>
                          ) : (
                            <Badge appearance="tint" color="warning" size="small">
                              不可用
                            </Badge>
                          )}
                        </div>

                        {address ? (
                          <>
                            <Text className={styles.familyIp}>{address.ip}</Text>
                            <div className={styles.familyMeta}>
                              <Button
                                appearance="subtle"
                                size="small"
                                icon={
                                  copied === address.ip ? (
                                    <Checkmark16Regular />
                                  ) : (
                                    <Copy16Regular />
                                  )
                                }
                                onClick={() => copy(address.ip)}
                                aria-label={`复制 ${family} 地址`}
                              >
                                复制
                              </Button>
                              {details?.latitude != null &&
                                details?.longitude != null && (
                                  <Button
                                    as="a"
                                    appearance="subtle"
                                    size="small"
                                    href={mapLink(
                                      details.latitude,
                                      details.longitude,
                                    )}
                                    target="_blank"
                                    rel="noreferrer"
                                    icon={<Location16Regular />}
                                  >
                                    地图
                                  </Button>
                                )}
                              <Caption1 className={styles.hint}>
                                来源 {address.source}
                              </Caption1>
                            </div>

                            {details ? (
                              <div className={styles.familyGeo}>
                                <span>
                                  {details.flagEmoji ? `${details.flagEmoji} ` : ''}
                                  {[details.country, details.city]
                                    .filter(Boolean)
                                    .join(' · ') || '—'}
                                </span>
                                <span className={styles.hint}>
                                  {[details.isp, details.org]
                                    .filter(Boolean)
                                    .join(' · ') || '—'}
                                </span>
                                <span className={styles.hint}>
                                  {details.asn ? `AS${details.asn}` : ''}
                                  {details.timezoneId
                                    ? `${details.asn ? ' · ' : ''}${details.timezoneId}`
                                    : ''}
                                </span>
                              </div>
                            ) : (
                              <Caption1 className={styles.hint}>
                                正在获取归属地…
                              </Caption1>
                            )}
                          </>
                        ) : (
                          <Caption1 className={styles.hint}>
                            {family === 'IPv6'
                              ? '本机当前无法经 IPv6 访问外网。可能没有 IPv6 出口，也可能 IPv6 存在但不通——浏览器层面无法区分。'
                              : '本机当前无法经 IPv4 访问外网。'}
                          </Caption1>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className={styles.row}>
                  <Caption1 className={styles.hint}>
                    <Shield16Regular /> 地址来自「实际连接」：单栈探测域名只有对应协议的
                    DNS 记录，能连通即证明该协议可用，因此这里不做推断。
                    归属地数据来自 ipwho.is，通常精确到城市级，可能因运营商出口与你实际位置不符。
                  </Caption1>
                </div>
              </>
            )}
          </div>
        </section>

        {/* Manual lookup: the only way to inspect an IPv6 address from a
            v4-only machine, and useful on its own. */}
        <section className="wt-surface" aria-label="查询指定 IP">
          <div className="wt-surface__header">
            <Search16Regular />
            <Text as="h2" size={300} weight="semibold">
              查询指定 IP
            </Text>
            <span className={styles.spacer} />
            <Caption1 className={styles.hint}>支持 IPv4 与 IPv6</Caption1>
          </div>
          <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
            <div className={styles.row}>
              <input
                className="wt-inline-input"
                value={manual}
                onChange={(event) => setManual(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void runManual();
                }}
                placeholder="例如 8.8.8.8 或 2001:4860:4860::8888"
                aria-label="要查询的 IP 地址"
                spellCheck={false}
              />
              <Button
                appearance="primary"
                icon={<Search16Regular />}
                onClick={() => void runManual()}
                disabled={!manual.trim() || manualLoading}
              >
                查询
              </Button>
            </div>

            {manualLoading && (
              <div className={styles.center}>
                <Spinner size="small" />
                <Text>查询中…</Text>
              </div>
            )}

            {manualError && !manualLoading && (
              <div className={styles.row}>
                <Caption1 className={styles.hint}>{manualError}</Caption1>
              </div>
            )}

            {manualResult && !manualLoading && (
              <>
                <Divider />
                <div className={styles.row}>
                  <Text className={styles.mono} weight="semibold">
                    {manualResult.ip}
                  </Text>
                  <Badge
                    appearance="tint"
                    color={manualResult.type === 'IPv6' ? 'success' : 'brand'}
                    size="small"
                  >
                    {manualResult.type}
                  </Badge>
                  <span className={styles.spacer} />
                  <Tooltip content="复制" relationship="label" withArrow>
                    <Button
                      appearance="subtle"
                      size="small"
                      icon={
                        copied === manualResult.ip ? (
                          <Checkmark16Regular />
                        ) : (
                          <Copy16Regular />
                        )
                      }
                      onClick={() => copy(manualResult.ip)}
                      aria-label="复制查询结果 IP"
                    />
                  </Tooltip>
                </div>
                <div className={styles.grid}>
                  {[
                    {
                      label: '国家 / 地区',
                      value: `${manualResult.country}${
                        manualResult.countryCode
                          ? ` (${manualResult.countryCode})`
                          : ''
                      }`,
                    },
                    { label: '城市', value: manualResult.city ?? '—' },
                    { label: '运营商 (ISP)', value: manualResult.isp ?? '—' },
                    {
                      label: 'ASN',
                      value: manualResult.asn ? `AS${manualResult.asn}` : '—',
                    },
                    { label: '组织', value: manualResult.org ?? '—' },
                    { label: '时区', value: manualResult.timezoneId ?? '—' },
                  ].map((cell) => (
                    <div key={cell.label} className={styles.cell}>
                      <Caption1 className={styles.cellLabel}>
                        {cell.label}
                      </Caption1>
                      <Text className={styles.cellValue} size={300}>
                        {cell.value}
                      </Text>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
