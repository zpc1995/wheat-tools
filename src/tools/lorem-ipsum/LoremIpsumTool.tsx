import {
  Button,
  Caption1,
  Checkbox,
  Divider,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Option,
  Select,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowClockwiseRegular,
  CopyRegular,
  DocumentTextRegular,
} from '@fluentui/react-icons';
import { useCallback, useMemo, useState } from 'react';
import { copyText } from '../json-formatter/jsonUtils';
import {
  MAX_COUNT,
  clampCount,
  describeLorem,
  generateLorem,
  seededRandom,
  stripHtmlTags,
  type LoremLanguage,
  type LoremTag,
  type LoremUnit,
} from './loremUtils';

const UNIT_LABELS: Record<LoremUnit, string> = {
  paragraph: '段落',
  sentence: '句子',
  word: '单词',
};

const UNIT_HINTS: Record<LoremUnit, string> = {
  paragraph: '每段 3–6 句，段间空一行',
  sentence: '每句以句末标点结束',
  word: '只输出单词，不加标点（中文时数量按字符算）',
};

const useStyles = makeStyles({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  controls: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: '12px',
    padding: '14px 14px 4px',
  },
  span: {
    display: 'flex',
    gap: '12px',
  },
  spanTop: {
    alignItems: 'flex-start',
  },
  toggles: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '16px',
    padding: '4px 14px 14px',
  },
  hint: {
    display: 'block',
    color: tokens.colorNeutralForeground3,
  },
  outputHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    flexWrap: 'wrap',
    padding: '0 14px 10px',
  },
  stats: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '16px',
    color: tokens.colorNeutralForeground3,
  },
  statValue: {
    // Tabular figures: the counts change on every regeneration, and without
    // them the whole row jitters as digits change width.
    fontVariantNumeric: 'tabular-nums',
    color: tokens.colorNeutralForeground1,
  },
  outputArea: {
    minHeight: '320px',
    maxHeight: '52vh',
  },
  outputWrap: {
    padding: '0 14px 14px',
    width: '100%',
  },
  status: {
    minHeight: '20px',
    color: tokens.colorNeutralForeground3,
  },
});

export function LoremIpsumTool() {
  const styles = useStyles();

  const [unit, setUnit] = useState<LoremUnit>('paragraph');
  const [count, setCount] = useState(3);
  const [language, setLanguage] = useState<LoremLanguage>('latin');
  const [classicOpening, setClassicOpening] = useState(true);
  const [html, setHtml] = useState(false);
  const [tag, setTag] = useState<LoremTag>('p');
  const [seed, setSeed] = useState(1);
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  const [copying, setCopying] = useState(false);

  // The seed is passed *into* the generator rather than kept inside it, which
  // is what makes "regenerate" reproducible: the same seed always yields the
  // same text, and a different seed is a visible, reportable change.
  const output = useMemo(
    () =>
      generateLorem(seededRandom(seed), {
        unit,
        count: clampCount(count),
        language,
        classicOpening: classicOpening && language === 'latin',
        html,
        tag,
      }),
    [unit, count, language, classicOpening, html, tag, seed],
  );

  const plain = useMemo(
    () => (html ? stripHtmlTags(output) : output),
    [html, output],
  );
  const stats = useMemo(() => describeLorem(plain, language), [plain, language]);

  const regenerate = useCallback(() => {
    setSeed((value) => value + 1);
    setCopied('idle');
  }, []);

  const onCopy = useCallback(async () => {
    setCopying(true);
    const ok = await copyText(output);
    setCopying(false);
    setCopied(ok ? 'ok' : 'failed');
  }, [output]);

  const effectiveCount = clampCount(count);
  const countLabel =
    effectiveCount === count ? undefined : `超出上限，已按 ${effectiveCount} 生成`;

  return (
    <div className="wt-surface">
      <div className="wt-surface__header">
        <DocumentTextRegular />
        <Text weight="semibold">生成选项</Text>
      </div>

      <div className="wt-surface__body" style={{ flexDirection: 'column' }}>
        <div className={styles.controls}>
          <Field label="生成粒度" orientation="vertical">
            <Select
              value={unit}
              onChange={(_, data) => {
                setUnit(data.value as LoremUnit);
                setCopied('idle');
              }}
              aria-label="生成粒度"
              style={{ minWidth: 140 }}
            >
              {(Object.keys(UNIT_LABELS) as LoremUnit[]).map((key) => (
                <Option key={key} value={key} text={UNIT_LABELS[key]}>
                  {UNIT_LABELS[key]}
                </Option>
              ))}
            </Select>
          </Field>

          <div className={`${styles.span} ${styles.spanTop}`}>
            <Field
              label="数量"
              orientation="vertical"
              validationMessage={countLabel}
              validationState={countLabel ? 'warning' : 'none'}
            >
              <Input
                type="number"
                min={0}
                max={MAX_COUNT}
                step={1}
                value={String(count)}
                onChange={(_, data) => {
                  const next = Number(data.value);
                  setCount(Number.isFinite(next) ? next : 0);
                  setCopied('idle');
                }}
                aria-label={`数量（${UNIT_LABELS[unit]}，最大 ${MAX_COUNT}）`}
                style={{ width: 150 }}
              />
            </Field>

            <Field label="词库" orientation="vertical" hint="中文占位不是拉丁文对译">
              <Select
                value={language}
                onChange={(_, data) => {
                  setLanguage(data.value as LoremLanguage);
                  setCopied('idle');
                }}
                aria-label="词库"
                style={{ minWidth: 150 }}
              >
                <Option value="latin" text="拉丁文">
                  拉丁文（lorem ipsum）
                </Option>
                <Option value="chinese" text="中文占位">
                  中文占位文字
                </Option>
              </Select>
            </Field>

            <Button
              appearance="primary"
              icon={<ArrowClockwiseRegular />}
              onClick={regenerate}
            >
              换一批
            </Button>
          </div>
        </div>

        <div className={styles.toggles}>
          <Checkbox
            checked={classicOpening}
            disabled={language === 'chinese'}
            onChange={(_, data) => {
              setClassicOpening(Boolean(data.checked));
              setCopied('idle');
            }}
            label="以经典开头起始"
          />
          <Checkbox
            checked={html}
            onChange={(_, data) => {
              setHtml(Boolean(data.checked));
              setCopied('idle');
            }}
            label="用 HTML 标签包裹段落"
          />
          <Select
            value={tag}
            disabled={!html}
            onChange={(_, data) => {
              setTag(data.value as LoremTag);
              setCopied('idle');
            }}
            aria-label="HTML 标签"
            style={{ minWidth: 110 }}
          >
            <Option value="p" text="<p>">
              &lt;p&gt;
            </Option>
            <Option value="div" text="<div>">
              &lt;div&gt;
            </Option>
          </Select>
          <Caption1 className={styles.hint}>种子 {seed}（同一种子结果完全相同）</Caption1>
        </div>

        <Caption1 className={styles.hint} style={{ padding: '0 14px 12px' }}>
          {UNIT_HINTS[unit]}
          {language === 'chinese'
            ? '；中文占位用的是中文项目常见的“这里是占位文字，请替换成真实内容”写法，不是拉丁文的翻译'
            : '；勾选经典开头后，文本以 Lorem ipsum dolor sit amet, consectetur adipiscing elit 起始'}
        </Caption1>

        {language === 'chinese' && classicOpening && (
          <div style={{ padding: '0 14px 12px' }}>
            <MessageBar intent="info">
              <MessageBarBody>
                中文占位没有对应的经典开头固定句，经典开头已自动忽略。
              </MessageBarBody>
            </MessageBar>
          </div>
        )}

        <Divider />

        <div className={styles.outputHeader} style={{ paddingTop: 12 }}>
          <Text as="h2" size={300} weight="semibold">
            生成结果
          </Text>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className={styles.stats}>
              <Caption1>
                {UNIT_LABELS[unit]}{' '}
                <span className={styles.statValue}>
                  {unit === 'paragraph'
                    ? stats.paragraphs
                    : unit === 'sentence'
                      ? stats.sentences
                      : // Chinese word mode counts characters, so the leading
                        // stat would just repeat the 字符 one below it.
                        language === 'chinese'
                        ? stats.characters
                        : stats.words}
                </span>
              </Caption1>
              <Caption1>
                字符 <span className={styles.statValue}>{stats.characters}</span>
              </Caption1>
              {unit !== 'word' && (
                <Caption1>
                  {language === 'chinese' ? '句子' : '单词'}{' '}
                  <span className={styles.statValue}>
                    {language === 'chinese' ? stats.sentences : stats.words}
                  </span>
                </Caption1>
              )}
            </div>
            <Button
              icon={copying ? <Spinner size="tiny" /> : <CopyRegular />}
              onClick={onCopy}
              disabled={copying || output === ''}
            >
              复制
            </Button>
          </div>
        </div>

        <div className={styles.outputWrap}>
          <textarea
            className={`wt-code-area ${styles.outputArea}`}
            value={output}
            readOnly
            spellCheck={false}
            // `white-space: pre-wrap` is set below instead of the shared
            // `pre`: a 10000-word single line would otherwise extend far past
            // the box with no way to read it.
            style={{ whiteSpace: 'pre-wrap' }}
            aria-label="生成的占位文本"
            onFocus={(event) => event.currentTarget.select()}
          />
          <Caption1 className={styles.status} aria-live="polite">
            {copied === 'ok'
              ? `已复制 ${stats.characters} 个字符`
              : copied === 'failed'
                ? '复制失败：浏览器拒绝了剪贴板访问，请手动全选复制'
                : ''}
          </Caption1>
        </div>
      </div>
    </div>
  );
}
