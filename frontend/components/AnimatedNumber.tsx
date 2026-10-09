"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Rolls smoothly from the previous value to the new one (ease-out, ~0.7s), like a
 * scoreboard. `instant` skips the tween, e.g. while the user is scrubbing a chart.
 */
export default function AnimatedNumber({
  value, format, instant = false, duration = 700, className,
}: {
  value: number;
  format: (n: number) => string;
  instant?: boolean;
  duration?: number;
  className?: string;
}) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (instant || reduce || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now(), a = from.current, b = value;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - k, 3); // easeOutCubic
      const v = a + (b - a) * e;
      from.current = v;
      setShown(v);
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [value, instant, duration]);

  return <span className={className}>{format(shown)}</span>;
}
