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
 * Product mark: a geometric "W" on a rounded violet tile.
 *
 * Chosen over the earlier wheat-ear marks because it stays legible at 16px
 * (browser tab / favicon size), where detailed glyphs collapse into noise, and
 * it ties directly to the `wheat.chat` name.
 *
 * The gradient uses three stops from the same brand ramp as the rest of the UI,
 * so the icon and the interface cannot drift apart. Every stop keeps the white
 * W at or above 3:1 (the WCAG threshold for graphical objects): 3.63 at the
 * lightest end, 10.75 at the darkest. The lightest ramp shades are deliberately
 * avoided — stop 110 measures only 2.77, which would wash the mark out.
 *
 * A fixed gradient is used rather than `currentColor`: the mark is the one place
 * that should not follow the theme foreground, and these stops read predictably
 * against both light and dark chrome.
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
          <stop offset="0%" stopColor="#956ef2" />
          <stop offset="45%" stopColor="#5f1df8" />
          <stop offset="100%" stopColor="#4212b1" />
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
