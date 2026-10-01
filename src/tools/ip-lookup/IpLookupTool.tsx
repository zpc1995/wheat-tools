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
  Shield16Regular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import { lookupPublicIp, mapLink, type IpDetails } from './ipUtils';

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
    fontSize: 'clamp(24px, 4vw, 38px)',
    fontWeight: 600,
    letterSpacing: '0.5px',
    userSelect: 'all',
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
    gap: '0',
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
});

export function IpLookupTool() {
  const styles = useStyles();
  const toasterId = useId('ip-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const [details, setDetails] = useState<IpDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetails(await lookupPublicIp());
    } catch (caught) {
      setDetails(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-query on open: the tool's whole purpose is to show the current IP.
  useEffect(() => {
    void run();
  }, [run]);

  const copyIp = useCallback(async () => {
    if (!details) return;
    const ok = await copyText(details.ip);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
      notify('已复制 IP 地址');
    } else {
      notify('复制失败');
    }
  }, [details, notify]);

  const cells = useMemo(() => {
    if (!details) return [];
    const location = [details.city, details.region, details.country]
      .filter(Boolean)
      .join(' · ');

    return [
      { label: '国家 / 地区', value: details.country + (details.countryCode ? ` (${details.countryCode})` : '') },
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
          ? `${details.timezoneId}${details.timezoneUtc ? ` (UTC${details.timezoneUtc})` : ''}${
              details.timezoneAbbr ? ` ${details.timezoneAbbr}` : ''
            }`
          : '—',
      },
      { label: '国际区号', value: details.callingCode ? `+${details.callingCode}` : '—' },
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

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />

      <div className={styles.stack}>
        {/* Disclosed up front: this app is otherwise entirely local, and this
            tool is the single exception. */}
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
                    <Badge appearance="tint" color="brand" size="small">
                      {details.type}
                    </Badge>
                    {details.flagEmoji && <Text size={500}>{details.flagEmoji}</Text>}
                    <Button
                      appearance="secondary"
                      size="small"
                      icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
                      onClick={copyIp}
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
                        在地图中查看
                      </Button>
                    )}
                  </div>
                </div>
                <Divider />
                <div className={styles.grid}>
                  {cells.map((cell) => (
                    <div key={cell.label} className={styles.cell}>
                      <Caption1 className={styles.cellLabel}>{cell.label}</Caption1>
                      <Text className={styles.cellValue} size={300}>
                        {cell.value}
                      </Text>
                    </div>
                  ))}
                </div>
                <div className={styles.cell}>
                  <Caption1 className={styles.hint}>
                    <Shield16Regular /> 数据来自 ipwho.is 的公开接口，
                    地理位置通常精确到城市级别，可能因运营商出口而与你所在位置不符。
                  </Caption1>
                </div>
              </>
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
}
