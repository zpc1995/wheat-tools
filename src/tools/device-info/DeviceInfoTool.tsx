import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Divider,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Text,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowClockwiseRegular,
  CheckmarkCircleRegular,
  CopyRegular,
  DismissCircleRegular,
  ShieldCheckmarkRegular,
} from '@fluentui/react-icons';
import { copyText } from '../json-formatter/jsonUtils';
import { readBattery, readDeviceEnvironment, readOrigin } from './deviceProbe';
import {
  SUPPORT_LABELS,
  checkConsistency,
  collectInfo,
  countBySupport,
  reportToJson,
  reportToText,
  type DeviceEnvironment,
  type InfoGroup,
  type SupportLevel,
} from './deviceInfoUtils';

const useStyles = makeStyles({
  column: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    minWidth: 0,
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
    width: '100%',
  },
  spacer: {
    flex: '1 1 auto',
  },
  notes: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '12px 14px 0',
    width: '100%',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '14px 14px 4px',
    width: '100%',
    minWidth: 0,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    tableLayout: 'fixed',
  },
  headCell: {
    textAlign: 'left',
    padding: '6px 10px',
    color: tokens.colorNeutralForeground3,
    fontWeight: 600,
    fontSize: '12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    whiteSpace: 'nowrap',
  },
  cell: {
    padding: '7px 10px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    verticalAlign: 'top',
    overflowWrap: 'anywhere',
  },
  label: {
    fontWeight: 600,
    color: tokens.colorNeutralForeground1,
  },
  value: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontVariantNumeric: 'tabular-nums',
    fontSize: '13px',
    color: tokens.colorNeutralForeground1,
  },
  api: {
    fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    fontSize: '12px',
    color: tokens.colorNeutralForeground3,
  },
  note: {
    display: 'block',
    marginTop: '4px',
    color: tokens.colorNeutralForeground3,
    fontSize: '12px',
    lineHeight: 1.55,
  },
  checkRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-start',
    padding: '4px 0',
  },
  checkOk: {
    color: tokens.colorPaletteGreenForeground1,
    flex: 'none',
    marginTop: '2px',
  },
  checkBad: {
    color: tokens.colorPaletteRedForeground1,
    flex: 'none',
    marginTop: '2px',
  },
  checkBody: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  checkDetail: {
    color: tokens.colorNeutralForeground3,
    fontSize: '12px',
    overflowWrap: 'anywhere',
  },
});

/**
 * Badge colour per standards status. Never colour-only: the badge text carries
 * the same information, so the distinction survives a monochrome screenshot and
 * a colour-blind reader.
 */
const SUPPORT_APPEARANCE: Record<
  SupportLevel,
  'informative' | 'warning' | 'danger' | 'subtle'
> = {
  standard: 'informative',
  nonstandard: 'warning',
  deprecated: 'danger',
  unknown: 'subtle',
};

export function DeviceInfoTool() {
  const styles = useStyles();
  const [env, setEnv] = useState<DeviceEnvironment | null>(null);
  const [copied, setCopied] = useState<'json' | 'text' | null>(null);

  const sample = useCallback(() => {
    // The synchronous readings paint immediately; the battery arrives later and
    // triggers one more sample so its row is filled in.
    setEnv(readDeviceEnvironment());
    void readBattery().then((battery) => {
      if (battery) setEnv(readDeviceEnvironment(battery));
    });
  }, []);

  useEffect(() => {
    let alive = true;
    setEnv(readDeviceEnvironment());
    void readBattery().then((battery) => {
      if (alive && battery) setEnv(readDeviceEnvironment(battery));
    });
    return () => {
      alive = false;
    };
  }, []);

  const groups: InfoGroup[] = useMemo(
    () => (env ? collectInfo(env) : []),
    [env],
  );
  const checks = useMemo(() => (env ? checkConsistency(env) : []), [env]);
  const failed = checks.filter((entry) => !entry.ok).length;
  const nonstandard = countBySupport(groups, 'nonstandard');

  const onCopy = useCallback(
    async (kind: 'json' | 'text') => {
      if (!env) return;
      const context = { origin: readOrigin(), generatedAtMs: Date.now() };
      const payload =
        kind === 'json'
          ? reportToJson(env, context)
          : reportToText(env, context);
      // Only claim a copy that actually happened: clipboard access can be
      // denied outright in a non-secure context.
      setCopied((await copyText(payload)) ? kind : null);
    },
    [env],
  );

  return (
    <div className="wt-surface">
      <div className="wt-surface__header">
        <div className={styles.toolbar}>
          <Tooltip content="重新读取当前环境" relationship="label" withArrow>
            <Button
              appearance="subtle"
              size="small"
              icon={<ArrowClockwiseRegular />}
              onClick={sample}
              aria-label="重新读取设备信息"
            />
          </Tooltip>
          <Button
            appearance="subtle"
            size="small"
            icon={<CopyRegular />}
            onClick={() => void onCopy('json')}
            disabled={!env}
          >
            {copied === 'json' ? '已复制 JSON' : '复制 JSON'}
          </Button>
          <Button
            appearance="subtle"
            size="small"
            icon={<CopyRegular />}
            onClick={() => void onCopy('text')}
            disabled={!env}
          >
            {copied === 'text' ? '已复制文本' : '复制文本'}
          </Button>
          <span className={styles.spacer} />
          <Caption1>
            {groups.reduce((sum, group) => sum + group.items.length, 0)} 项，其中{' '}
            {nonstandard} 项非标准
          </Caption1>
        </div>
      </div>

      {/* `wt-surface__body` is a flex row by default, so the direction has to be
          set explicitly or every section lays out side by side. */}
      <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
        <div className={styles.column}>
          <div className={styles.notes}>
            <MessageBar intent="warning">
              <MessageBarBody>
                <MessageBarTitle>这些信息合起来能识别你的设备</MessageBarTitle>
                屏幕尺寸、像素比、时区、语言、显卡型号、User Agent
                等字段单独看都很普通，组合起来却足以把一台设备从人群里挑出来。请不要随意把下面的内容粘贴到公开的论坛、工单或聊天群里；要贴就贴其中的某几行。
              </MessageBarBody>
            </MessageBar>

            <MessageBar intent="info" icon={<ShieldCheckmarkRegular />}>
              <MessageBarBody>
                <MessageBarTitle>本工具不做指纹</MessageBarTitle>
                指纹是把一堆设备特征拼起来、算成一个稳定标识符用来跨站点追踪用户的技术。它和「查看自己的设备信息」完全不是一回事，所以这里不做：不把任何内容画进画布再读回像素，不做音频处理，不枚举字体和媒体设备，不计算任何哈希，也不发起任何网络请求——数据只在你的浏览器里读出并显示给你。唯一与指纹沾边的是显卡型号那两行（它们本来就是指纹的常用原料），本工具也仅做本地展示，不参与任何拼接或计算。
              </MessageBarBody>
            </MessageBar>

            <Divider />
          </div>

          {env === null ? (
            <div className={styles.section}>
              <Caption1>正在读取…</Caption1>
            </div>
          ) : (
            <>
              <div className={styles.section}>
                <Text as="h2" size={300} weight="semibold">
                  自洽性核对
                  {failed === 0
                    ? ` · ${checks.length}/${checks.length} 通过`
                    : ` · ${checks.length - failed}/${checks.length} 通过`}
                </Text>
                <Caption1>
                  设备信息没有外部参照物可以比对，但一组正确的读数必须彼此自洽。下面这些关系如果有一条不成立，说明读数里至少有一个是错的。
                </Caption1>
                {checks.map((entry) => (
                  <div className={styles.checkRow} key={entry.id}>
                    {entry.ok ? (
                      <CheckmarkCircleRegular
                        className={styles.checkOk}
                        aria-label="通过"
                      />
                    ) : (
                      <DismissCircleRegular
                        className={styles.checkBad}
                        aria-label="不一致"
                      />
                    )}
                    <span className={styles.checkBody}>
                      <Text size={300}>
                        {entry.ok ? '通过' : '不一致'}：{entry.label}
                      </Text>
                      <Caption1 className={styles.checkDetail}>
                        {entry.detail}
                      </Caption1>
                    </span>
                  </div>
                ))}
              </div>

              <Divider />

              {groups.map((group) => (
                <div className={styles.section} key={group.id}>
                  <Text as="h2" size={300} weight="semibold">
                    {group.title}
                  </Text>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.headCell} style={{ width: '22%' }}>
                          项目
                        </th>
                        <th className={styles.headCell} style={{ width: '34%' }}>
                          值
                        </th>
                        <th className={styles.headCell} style={{ width: '30%' }}>
                          来源 API
                        </th>
                        <th className={styles.headCell} style={{ width: '14%' }}>
                          标准性
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((item) => (
                        <tr key={item.id}>
                          <td className={`${styles.cell} ${styles.label}`}>
                            {item.label}
                          </td>
                          <td className={`${styles.cell} ${styles.value}`}>
                            {item.value}
                            {item.note && (
                              <span className={styles.note}>{item.note}</span>
                            )}
                          </td>
                          <td className={`${styles.cell} ${styles.api}`}>
                            {item.api}
                          </td>
                          <td className={styles.cell}>
                            <Badge
                              appearance="tint"
                              color={SUPPORT_APPEARANCE[item.support]}
                              size="small"
                            >
                              {SUPPORT_LABELS[item.support]}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </>
          )}

          <div className={styles.section} style={{ paddingBottom: 16 }}>
            <Caption1>
              「非标准」表示该属性不在任何 W3C/IETF 标准里，实际上是某个浏览器（通常是
              Chromium 系）的私有扩展：换一个浏览器就读不到，值也可能随时变化，不要据此写死逻辑。
            </Caption1>
          </div>
        </div>
      </div>
    </div>
  );
}
