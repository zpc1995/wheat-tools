import { makeStyles } from '@fluentui/react-components';

const useStyles = makeStyles({
  root: {
    display: 'block',
    flex: 'none',
  },
});

interface WheatIconProps {
  /** Rendered size in pixels; the art is drawn on a 24×24 grid. */
  size?: number;
  className?: string;
}

/** Grain centres, mirrored on the x axis, plus the rotation of each tip. */
const GRAINS: Array<{ x: number; y: number; angle: number }> = [
  { x: 10.0, y: 13.0, angle: 34 },
  { x: 14.0, y: 13.0, angle: -34 },
  { x: 9.6, y: 10.2, angle: 48 },
  { x: 14.4, y: 10.2, angle: -48 },
  { x: 10.0, y: 7.4, angle: 64 },
  { x: 14.0, y: 7.4, angle: -64 },
];

/**
 * 金黄麦穗 —— the product mark.
 *
 * Hand-drawn rather than taken from @fluentui/react-icons because Fluent has
 * no wheat glyph. Grains are arranged so each tip converges on the top of the
 * stem (a herringbone, like a real ear); without that the shape reads as a
 * generic blob at small sizes.
 *
 * The gold deliberately does not use `currentColor`: tying it to the theme
 * foreground would desaturate it in light mode.
 */
export function WheatIcon({ size = 22, className }: WheatIconProps) {
  const styles = useStyles();
  const gradientId = `wheat-gold-${size}`;

  return (
    <svg
      className={className ? `${styles.root} ${className}` : styles.root}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="金黄麦穗"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0%" stopColor="#FFE08A" />
          <stop offset="42%" stopColor="#F7B733" />
          <stop offset="100%" stopColor="#D68A05" />
        </linearGradient>
      </defs>

      {/* stem */}
      <path
        d="M12 21.6V3.6"
        stroke={`url(#${gradientId})`}
        strokeWidth="1.45"
        strokeLinecap="round"
        fill="none"
      />

      <g
        fill={`url(#${gradientId})`}
        stroke="#C97F04"
        strokeWidth="0.55"
        strokeOpacity="0.55"
      >
        {/* apex grain */}
        <ellipse cx="12" cy="3.85" rx="1.5" ry="2.05" />
        {GRAINS.map((grain) => (
          <ellipse
            key={`${grain.x}-${grain.y}`}
            cx={grain.x}
            cy={grain.y}
            rx="1.35"
            ry="3.05"
            transform={`rotate(${grain.angle} ${grain.x} ${grain.y})`}
          />
        ))}
      </g>
    </svg>
  );
}
