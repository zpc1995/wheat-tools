import {
  Button,
  Caption1,
  Dropdown,
  MessageBar,
  MessageBarBody,
  Option,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { CopyRegular } from '@fluentui/react-icons';
import { useCallback, useMemo, useState } from 'react';
import {
  FONT_HEIGHT,
  FONT_LABEL,
  MAX_INPUT_CHARS,
  MAX_INPUT_LINES,
  MAX_SPACING,
  SUPPORTED_RANGE,
  artToText,
  renderAsciiArt,
  type ArtAlign,
} from './asciiArtUtils';

const useStyles = makeStyles({
  body: {
    flexDirection: 'column',
    gap: '10px',
    padding: '14px',
    minHeight: 0,
  },
  controls: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px',
    alignItems: 'flex-end',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  fieldLabel: {
    color: tokens.colorNeutralForeground3,
  },
  spacingField: {
    width: '104px',
  },
  padField: {
    width: '104px',
  },
  widthField: {
    width: '160px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    flexWrap: 'wrap',
  },
  input: {
    minHeight: '84px',
  },
  output: {
    minHeight: '240px',
  },
  note: {
    color: tokens.colorNeutralForeground3,
  },
  count: {
    fontVariantNumeric: 'tabular-nums',
    color: tokens.colorNeutralForeground3,
  },
});

const ALIGN_LABEL: Record<ArtAlign, string> = {
  left: '左对齐',
  center: '居中',
  right: '右对齐',
};

/** Parses a numeric field, treating an empty or malformed entry as "unset". */
function parseNumber(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function AsciiArtTextTool() {
  const styles = useStyles();
  const [input, setInput] = useState('Wheat Tools');
  const [spacing, setSpacing] = useState('1');
  const [align, setAlign] = useState<ArtAlign>('left');
  const [padChar, setPadChar] = useState(' ');
  const [width, setWidth] = useState('');
  const [copied, setCopied] = useState(false);

  const result = useMemo(
    () =>
      renderAsciiArt(input, {
        spacing: parseNumber(spacing) ?? 1,
        align,
        padChar,
        width: parseNumber(width),
      }),
    [input, spacing, align, padChar, width],
  );

  const output = useMemo(() => artToText(result), [result]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
    } catch {
      // Clipboard access can be denied (insecure context, user refusal). The
      // button stays in its "copy" state rather than claiming a copy happened.
      setCopied(false);
    }
  }, [output]);

  return (
    <div className="wt-surface">
      <div className={`wt-surface__body ${styles.body}`}>
        <Text as="h2" size={300} weight="semibold">
          输入文本
        </Text>
        <textarea
          className={`wt-code-area ${styles.input}`}
          aria-label="要转换的文本"
          value={input}
          spellCheck={false}
          placeholder="输入要变成艺术字的文本，例如 Wheat Tools"
          onChange={(event) => {
            setInput(event.target.value);
            setCopied(false);
          }}
        />

        <div className={styles.controls}>
          <div className={`${styles.field} ${styles.spacingField}`}>
            <Caption1 className={styles.fieldLabel}>字距（0–{MAX_SPACING}）</Caption1>
            <input
              className="wt-inline-input"
              type="number"
              min={0}
              max={MAX_SPACING}
              value={spacing}
              aria-label="字距"
              onChange={(event) => setSpacing(event.target.value)}
            />
          </div>
          <div className={styles.field}>
            <Caption1 className={styles.fieldLabel}>对齐</Caption1>
            <Dropdown
              aria-label="对齐方式"
              value={ALIGN_LABEL[align]}
              selectedOptions={[align]}
              onOptionSelect={(_, data) => {
                const next = data.optionValue;
                if (next === 'left' || next === 'center' || next === 'right') setAlign(next);
              }}
            >
              <Option value="left">左对齐</Option>
              <Option value="center">居中</Option>
              <Option value="right">右对齐</Option>
            </Dropdown>
          </div>
          <div className={`${styles.field} ${styles.padField}`}>
            <Caption1 className={styles.fieldLabel}>填充字符</Caption1>
            <input
              className="wt-inline-input"
              value={padChar}
              maxLength={1}
              aria-label="填充字符"
              onChange={(event) => setPadChar(event.target.value)}
            />
          </div>
          <div className={`${styles.field} ${styles.widthField}`}>
            <Caption1 className={styles.fieldLabel}>宽度（留空为不限）</Caption1>
            <input
              className="wt-inline-input"
              type="number"
              min={1}
              value={width}
              aria-label="输出宽度限制"
              onChange={(event) => setWidth(event.target.value)}
            />
          </div>
        </div>

        <Caption1 className={styles.note}>
          内置字体：{FONT_LABEL} · 支持字符：ASCII 可打印字符 {SUPPORTED_RANGE}（含空格）·
          {' '}{FONT_HEIGHT} 行高 · 单次最多 {MAX_INPUT_CHARS} 个字符、{MAX_INPUT_LINES} 行。
          只内置这一种字体，不提供字体选择；输出为纯文本，不含颜色或 HTML。
        </Caption1>

        {result.unsupported.length > 0 && (
          <MessageBar intent="warning">
            <MessageBarBody>
              已忽略 {result.unsupported.length} 个字体中没有的字符：
              {' '}{result.unsupported.map((char) => `“${char}”`).join('、')}
              。内置字体只覆盖 ASCII 可打印字符，中文、全角标点与 emoji 都画不出来，请改用
              A–Z、a–z、0–9 与半角标点。
            </MessageBarBody>
          </MessageBar>
        )}

        {result.truncated && (
          <MessageBar intent="warning">
            <MessageBarBody>
              输入超过上限，只渲染了前 {MAX_INPUT_CHARS} 个字符或前 {MAX_INPUT_LINES} 行。
            </MessageBarBody>
          </MessageBar>
        )}

        {result.overflow && (
          <MessageBar intent="info">
            <MessageBarBody>
              艺术字自然宽度为 {result.artWidth} 列，超过设定的宽度，因此没有按宽度裁剪
              （截断会把字形切成两半），对齐填充也就不起作用。
            </MessageBarBody>
          </MessageBar>
        )}

        <div className={styles.row}>
          <Text as="h2" size={300} weight="semibold">
            输出
          </Text>
          <div className={styles.row}>
            <Caption1 className={styles.count}>
              {result.lines.length} 行 · 最宽 {result.width} 列
            </Caption1>
            <Button
              icon={<CopyRegular />}
              appearance="subtle"
              size="small"
              disabled={output === ''}
              onClick={copy}
            >
              {copied ? '已复制' : '复制'}
            </Button>
          </div>
        </div>

        <textarea
          className={`wt-code-area ${styles.output}`}
          aria-label="ASCII 艺术字输出"
          value={output}
          readOnly
          wrap="off"
          spellCheck={false}
          placeholder="输入文本后这里会显示 ASCII 艺术字"
        />

        <Caption1 className={styles.note}>
          请用等宽字体查看输出才对得齐。字母之间按固定字距拼接，没有实现 FIGlet 的横向
          smushing（相邻字形重叠压紧），所以列数可预测，但与 figlet 的默认输出不完全逐字相同。
        </Caption1>
      </div>
    </div>
  );
}
