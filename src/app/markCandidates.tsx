import type { ComponentType } from 'react';

/**
 * Candidate marks for the product logo, kept together so they can be compared
 * side by side (see scripts/check-tools.mjs workflow / the logo lab page).
 *
 * All are drawn on a 24×24 grid and use Fluent 2 brand-family blues, so they
 * sit naturally next to the components. Each is monochrome-capable: the fills
 * use a gradient but read fine as flat shapes at 16px.
 */

export interface MarkProps {
  size?: number;
  /** Unique suffix so multiple marks on one page do not share a gradient id. */
  uid?: string;
}

interface MarkDef {
  key: string;
  label: string;
  note: string;
  Component: ComponentType<MarkProps>;
}

const BRAND = {
  light: '#7cb3ff',
  mid: '#2f6fed',
  deep: '#1a4bb8',
  edge: '#123a91',
};

function Defs({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0%" stopColor={BRAND.light} />
        <stop offset="45%" stopColor={BRAND.mid} />
        <stop offset="100%" stopColor={BRAND.deep} />
      </linearGradient>
    </defs>
  );
}

/** A — rounded-square tile holding a geometric "W". */
function MarkMonogram({ size = 24, uid = 'a' }: MarkProps) {
  const id = `mark-a-${uid}`;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="W 字标">
      <Defs id={id} />
      <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill={`url(#${id})`} />
      <path
        d="M6.2 7.6 L8.55 16.4 L12 9.6 L15.45 16.4 L17.8 7.6"
        fill="none"
        stroke="#fff"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** B — grid of tool tiles ("many small tools"). */
function MarkGrid({ size = 24, uid = 'b' }: MarkProps) {
  const id = `mark-b-${uid}`;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="工具网格">
      <Defs id={id} />
      <rect x="2" y="2" width="9" height="9" rx="2.4" fill={`url(#${id})`} />
      <rect x="13" y="2" width="9" height="9" rx="2.4" fill={`url(#${id})`} opacity="0.72" />
      <rect x="2" y="13" width="9" height="9" rx="2.4" fill={`url(#${id})`} opacity="0.72" />
      <rect x="13" y="13" width="9" height="9" rx="2.4" fill={`url(#${id})`} opacity="0.45" />
    </svg>
  );
}

/** C — a wheat ear reduced to four grains (keeps the name, drops the clutter). */
function MarkEar({ size = 24, uid = 'c' }: MarkProps) {
  const id = `mark-c-${uid}`;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="麦穗">
      <Defs id={id} />
      <path
        d="M12 21.5V9.5"
        stroke={`url(#${id})`}
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
      <g fill={`url(#${id})`}>
        <ellipse cx="9.4" cy="12.6" rx="1.5" ry="3.2" transform="rotate(38 9.4 12.6)" />
        <ellipse cx="14.6" cy="12.6" rx="1.5" ry="3.2" transform="rotate(-38 14.6 12.6)" />
        <ellipse cx="10" cy="8.4" rx="1.4" ry="3" transform="rotate(56 10 8.4)" />
        <ellipse cx="14" cy="8.4" rx="1.4" ry="3" transform="rotate(-56 14 8.4)" />
      </g>
      <ellipse cx="12" cy="4.6" rx="1.6" ry="2.6" fill={`url(#${id})`} />
    </svg>
  );
}

/** D — abstract spark, reads as "fast utility" and scales to favicon size. */
function MarkSpark({ size = 24, uid = 'd' }: MarkProps) {
  const id = `mark-d-${uid}`;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="闪光">
      <Defs id={id} />
      <path
        d="M13.4 1.8 4.6 13.1c-.5.65-.05 1.6.78 1.6h4.2l-1.4 7.5 8.9-11.4c.5-.65.05-1.6-.78-1.6h-4.3z"
        fill={`url(#${id})`}
      />
    </svg>
  );
}

/** E — rounded square with a wrench: unambiguous "tool". */
function MarkWrench({ size = 24, uid = 'e' }: MarkProps) {
  const id = `mark-e-${uid}`;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="扳手">
      <Defs id={id} />
      <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill={`url(#${id})`} />
      <path
        d="M15.2 4.4a4.6 4.6 0 0 0-4.5 5.7l-6 6a1.4 1.4 0 0 0 2 2l6-6a4.6 4.6 0 0 0 5.7-4.5l-2.4 2.4-1.9-.5-.5-1.9z"
        fill="#fff"
      />
    </svg>
  );
}

/** F — stacked layers: "a collection of tools". */
function MarkLayers({ size = 24, uid = 'f' }: MarkProps) {
  const id = `mark-f-${uid}`;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="分层集合">
      <Defs id={id} />
      <path d="M12 2.4 21 7.2 12 12 3 7.2z" fill={`url(#${id})`} />
      <path d="M12 12 21 7.2v4.2L12 16.2 3 11.4V7.2z" fill={`url(#${id})`} opacity="0.66" />
      <path d="M12 16.2 21 11.4v4.2L12 20.4 3 15.6v-4.2z" fill={`url(#${id})`} opacity="0.4" />
    </svg>
  );
}

export const MARK_CANDIDATES: MarkDef[] = [
  { key: 'monogram', label: 'A · W 字标', note: '最简洁，缩到 16px 也清晰，适合做 favicon', Component: MarkMonogram },
  { key: 'grid', label: 'B · 工具网格', note: '直白表达「多个小工具」', Component: MarkGrid },
  { key: 'ear', label: 'C · 精简麦穗', note: '保留麦子含义，去掉杂乱感', Component: MarkEar },
  { key: 'spark', label: 'D · 闪光', note: '表达「快速、即时」，无边框更轻', Component: MarkSpark },
  { key: 'wrench', label: 'E · 扳手', note: '「工具」含义最明确', Component: MarkWrench },
  { key: 'layers', label: 'F · 分层集合', note: '表达「一个入口、多层工具」', Component: MarkLayers },
];
