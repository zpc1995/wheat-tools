import { makeStyles } from '@fluentui/react-components';

const useStyles = makeStyles({
  root: {
    display: 'block',
    flex: 'none',
  },
});

interface BrandMarkProps {
  /** Rendered size in pixels; the art is drawn on a 24×24 grid. */
  size?: number;
  className?: string;
}

/**
 * Product mark: a geometric "W" on a rounded brand-blue tile.
 *
 * Chosen over the earlier wheat-ear marks because it stays legible at 16px
 * (browser tab / favicon size), where detailed glyphs collapse into noise, and
 * it ties directly to the `wheat.chat` name.
 *
 * A fixed blue gradient is used rather than `currentColor`: the mark is the one
 * place that should not follow the theme foreground, and a flat blue is
 * predictable against both light and dark chrome.
 */
export function BrandMark({ size = 32, className }: BrandMarkProps) {
  const styles = useStyles();
  const gradientId = `brand-mark-${size}`;

  return (
    <svg
      className={className ? `${styles.root} ${className}` : styles.root}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="麦工具"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#7cb3ff" />
          <stop offset="45%" stopColor="#2f6fed" />
          <stop offset="100%" stopColor="#1a4bb8" />
        </linearGradient>
      </defs>
      <rect
        x="1.5"
        y="1.5"
        width="21"
        height="21"
        rx="6"
        fill={`url(#${gradientId})`}
      />
      <path
        d="M6.2 7.6 L8.55 16.4 L12 9.6 L15.45 16.4 L17.8 7.6"
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
