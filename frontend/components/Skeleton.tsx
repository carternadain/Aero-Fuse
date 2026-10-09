/** Shimmering placeholder block (see .skeleton in globals.css). */
export default function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} aria-hidden />;
}
