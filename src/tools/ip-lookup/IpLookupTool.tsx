import { useCallback, useEffect, useMemo, useState } from 'react';
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
  lookupIp,
  lookupOwnAddress,
  mapLink,
  probeIpv6,
  type IpDetails,
  type Ipv6Status,
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

  const [details, setDetails] = useState<IpDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [own, setOwn] = useState<OwnAddress | null>(null);
  const [ipv6, setIpv6] = useState<Ipv6Status>({ state: 'checking' });
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
    setIpv6({ state: 'checking' });
    setOwn(null);

    try {
      // Step 1: learn the address whose protocol the browser actually used.
      // This is what decides IPv4 vs IPv6, so it must come first.
      const address = await lookupOwnAddress();
      setOwn(address);

      // Arriving over IPv6 already proves IPv6 works; over IPv4 it does not,
      // so the status starts as "checking" and the effect below probes.
      setIpv6(
        address.family === 'IPv6'
          ? { state: 'native', ip: address.ip }
          : { state: 'checking' },
      );

      // Step 2: enrich that exact address with geography/ASN details.
      setDetails(await lookupIp(address.ip));
    } catch (caught) {
      setDetails(null);
      setError(caught instanceof Error ? caught.message : String(caught));
      setLoading(false);
      setIpv6({ state: 'unavailable' });
      return;
    }

    setLoading(false);
  }, []);

  // Auto-query on open: the tool's whole purpose is to show the current IP.
  useEffect(() => {
    void run();
  }, [run]);

  // Only IPv4 arrivals need the extra IPv6 reachability check.
  useEffect(() => {
    if (!own || own.family === 'IPv6') return undefined;
    let cancelled = false;
    void (async () => {
      const result = await probeIpv6();
      if (!cancelled) setIpv6(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [own]);

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

  const cells = useMemo(() => {
    if (!details) return [];
    const location = [details.city, details.region, details.country]
      .filter(Boolean)
      .join(' · ');

    return [
      {
        label: '国家 / 地区',
        value:
          details.country +
          (details.countryCode ? ` (${details.countryCode})` : ''),
      },
      { label: '省 / 州', value: details.region ?? '—' },
      { label: '城市', value: details.city ?? '—' },
      { label: '邮编', value: details.postal ?? '—' },
      { label: '完整位置', value: location || '—' },
      { label: '所属大洲', value: details.continent ?? '—' },
      { label: '运营商 (ISP)', value: details.isp ?? '—' },
      { label: '组织', value: details.org ?? '—' },
      { label: 'ASN', value: details.asn ? `AS${details.asn}` : '—' },
      { label: '网络域名', value: details.domain ?? '—' },
      {
        label: '时区',
        value: details.timezoneId
          ? `${details.timezoneId}${
              details.timezoneUtc ? ` (UTC${details.timezoneUtc})` : ''
            }${details.timezoneAbbr ? ` ${details.timezoneAbbr}` : ''}`
          : '—',
      },
      {
        label: '国际区号',
        value: details.callingCode ? `+${details.callingCode}` : '—',
      },
      { label: '首都', value: details.capital ?? '—' },
      {
        label: '经纬度',
        value:
          details.latitude !== null && details.longitude !== null
            ? `${details.latitude.toFixed(4)}, ${details.longitude.toFixed(4)}`
            : '—',
      },
    ];
  }, [details]);

  const isIpv6Primary = own
    ? own.family === 'IPv6'
    : Boolean(details && (details.type === 'IPv6' || details.ip.includes(':')));

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
            <Text size={300} weight="semibold">
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
            {loading && !details ? (
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
            ) : details ? (
              <>
                <div className={styles.hero}>
                  <Text className={styles.ip}>{details.ip}</Text>
                  <div className={styles.heroMeta}>
                    <Badge
                      appearance="tint"
                      color={isIpv6Primary ? 'success' : 'brand'}
                      size="small"
                    >
                      {details.type}
                    </Badge>
                    {details.flagEmoji && (
                      <Text size={500}>{details.flagEmoji}</Text>
                    )}
                    <Button
                      appearance="secondary"
                      size="small"
                      icon={
                        copied === details.ip ? (
                          <Checkmark16Regular />
                        ) : (
                          <Copy16Regular />
                        )
                      }
                      onClick={() => copy(details.ip)}
                    >
                      复制 IP
                    </Button>
                    {details.latitude !== null && details.longitude !== null && (
                      <Button
                        as="a"
                        appearance="secondary"
                        size="small"
                        href={mapLink(details.latitude, details.longitude)}
                        target="_blank"
                        rel="noreferrer"
                        icon={<Location16Regular />}
                      >
                        地图
                      </Button>
                    )}
                  </div>
                </div>

                <Divider />

                {/* The returned family depends on the caller's connectivity,
                    which is worth stating instead of leaving the user to
                    guess why they never see an IPv6 address. */}
                <div className={styles.row}>
                  <Caption1 className={styles.cellLabel}>协议来源</Caption1>
                  <Caption1 className={styles.hint}>
                    {isIpv6Primary
                      ? '地址取自实际连接：浏览器是经 IPv6 连出去的，所以这是你的公网 IPv6 地址。'
                      : '地址取自实际连接：浏览器是经 IPv4 连出去的，所以这是你的公网 IPv4 地址。'}
                    {own ? `（来源：${own.source}）` : ''}
                  </Caption1>
                </div>

                <div className={styles.row}>
                  <Caption1 className={styles.cellLabel}>IPv6</Caption1>
                  {ipv6.state === 'checking' ? (
                    <>
                      <Spinner size="tiny" />
                      <Caption1 className={styles.hint}>探测中…</Caption1>
                    </>
                  ) : ipv6.state === 'native' ? (
                    <>
                      <Badge appearance="tint" color="success" size="small">
                        当前即通过 IPv6 接入
                      </Badge>
                      <Caption1 className={styles.hint}>
                        上面的地址就是你的公网 IPv6 地址，无需额外探测。
                      </Caption1>
                    </>
                  ) : ipv6.state === 'reachable' ? (
                    <>
                      <Badge appearance="tint" color="success" size="small">
                        可经 IPv6 访问
                      </Badge>
                      <Caption1 className={`${styles.hint} ${styles.mono}`}>
                        {ipv6.address}
                      </Caption1>
                    </>
                  ) : (
                    <>
                      <Badge appearance="tint" color="warning" size="small">
                        无法确认
                      </Badge>
                      <Caption1 className={styles.hint}>
                        你当前的连接是 IPv4。额外探测 IPv6 未成功，但这有两种可能：
                        本机确实没有 IPv6 出口，或探测接口（ident.me）未开放跨域。
                        浏览器里无法区分这两者，所以这里不写成「你没有 IPv6」。
                      </Caption1>
                    </>
                  )}
                </div>

                <Divider />

                <div className={styles.grid}>
                  {cells.map((cell) => (
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

                <div className={styles.row}>
                  <Caption1 className={styles.hint}>
                    <Shield16Regular /> 数据来自 ipwho.is 的公开接口，
                    地理位置通常精确到城市级别，可能因运营商出口而与你实际所在位置不符。
                  </Caption1>
                </div>
              </>
            ) : null}
          </div>
        </section>

        {/* Manual lookup: the only way to inspect an IPv6 address from a
            v4-only machine, and useful on its own. */}
        <section className="wt-surface" aria-label="查询指定 IP">
          <div className="wt-surface__header">
            <Search16Regular />
            <Text size={300} weight="semibold">
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
