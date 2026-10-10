// Aero logo mark: an "A" without a crossbar, with an accent dot where the bar would be.
// Cropped tight to the mark so it sits next to text. Stroke follows currentColor.
export default function AeroMark({ className = "", size = 20 }: { className?: string; size?: number }) {
  return (
    <svg
      viewBox="116 106 280 300"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M146 376 L256 136 L366 376"
        fill="none"
        stroke="currentColor"
        strokeWidth={48}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="256" cy="300" r="25" className="fill-up" />
    </svg>
  );
}
