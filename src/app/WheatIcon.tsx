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

/** Single-hue green ramp: light tip, deep base. */
const RAMP: [string, string, string] = ['#B7E79A', '#4E9F3D', '#2C6E2A'];
const EDGE = '#1F5520';

/**
 * 麦穗 —— the product mark.
 *
 * Hand-drawn rather than taken from @fluentui/react-icons because Fluent has
 * no wheat glyph. Two deliberate choices:
 *
 * 1. Geometry: every grain's tip converges on the top of the stem (a
 *    herringbone, like a real ear). Simply stacking ellipses reads as a
 *    bunch of grapes instead.
 * 2. Colour: a single-hue green ramp. An earlier high-saturation gold looked
 *    brassy and fought the blue-tinted neutral surfaces, so the mark is now
 *    green with lightness doing the shading.
 *
 * The fill intentionally does not use `currentColor`: tying it to the theme
 * foreground would flatten it to grey.
 */
export function WheatIcon({ size = 22, className }: WheatIconProps) {
  const styles = useStyles();
  const gradientId = `wheat-green-${size}`;

  return (
    <svg
      className={className ? `${styles.root} ${className}` : styles.root}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="麦穗"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0%" stopColor={RAMP[0]} />
          <stop offset="42%" stopColor={RAMP[1]} />
          <stop offset="100%" stopColor={RAMP[2]} />
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
        stroke={EDGE}
        strokeWidth="0.5"
        strokeOpacity="0.5"
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
