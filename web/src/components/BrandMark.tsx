import { useId } from "react";

/** circle centres of the mark's four openings (100-unit square) */
const HOLES = [
  [27.5, 27.5],
  [72.5, 27.5],
  [27.5, 72.5],
  [72.5, 72.5],
] as const;

/**
 * The Risk Forge mark from the brand board: a rounded square with four round openings,
 * the top-left and bottom-right joined through the centre so the solid part reads as an S.
 * "white" sits on dark or brand-blue surfaces, "gradient" on white.
 */
export default function BrandMark({ tone, className = "" }: { tone: "white" | "gradient"; className?: string }) {
  const id = useId().replace(/[^\w-]/g, "");
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}-g`} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2643ff" />
          <stop offset="0.55" stopColor="#0f20a2" />
          <stop offset="1" stopColor="#11004d" />
        </linearGradient>
        <mask id={`${id}-m`}>
          <rect width="100" height="100" rx="18" fill="#fff" />
          {/* the joined opening: the centre square, cut back by a 5-unit band around the two lone circles */}
          <rect x="27.5" y="27.5" width="45" height="45" fill="#000" />
          <circle cx="72.5" cy="27.5" r="25.2" fill="#fff" />
          <circle cx="27.5" cy="72.5" r="25.2" fill="#fff" />
          {HOLES.map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="20" fill="#000" />
          ))}
        </mask>
      </defs>
      <rect width="100" height="100" rx="18" fill={tone === "white" ? "#fff" : `url(#${id}-g)`} mask={`url(#${id}-m)`} />
    </svg>
  );
}
