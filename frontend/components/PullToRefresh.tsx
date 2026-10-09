"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

const TRIGGER = 72; // px of pull needed to refresh

/**
 * Pull-to-refresh for phones. Installed home-screen web apps on iOS have no native
 * pull-to-refresh (and the page sets overscroll-behavior: none), so this adds one:
 * drag down from the very top and release past the threshold to reload.
 */
export default function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const startY = useRef<number | null>(null);
  const pullRef = useRef(0);

  useEffect(() => {
    if (!window.matchMedia?.("(pointer: coarse)").matches) return; // touch devices only
    const down = (e: TouchEvent) => {
      startY.current = window.scrollY <= 0 && !document.body.style.overflow ? e.touches[0].clientY : null;
    };
    const move = (e: TouchEvent) => {
      if (startY.current == null) return;
      const d = e.touches[0].clientY - startY.current;
      pullRef.current = d <= 0 ? 0 : Math.min(120, d * 0.5); // resistance
      setPull(pullRef.current);
    };
    const up = () => {
      if (startY.current == null) return;
      startY.current = null;
      if (pullRef.current >= TRIGGER) {
        setBusy(true);
        setPull(TRIGGER);
        setTimeout(() => window.location.reload(), 150);
      } else {
        setPull(0);
      }
      pullRef.current = 0;
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up);
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
    };
  }, []);

  if (pull <= 2 && !busy) return null;
  const ready = pull >= TRIGGER;
  return (
    <div className="fixed left-1/2 -translate-x-1/2 z-[60] pointer-events-none"
         style={{ top: `calc(env(safe-area-inset-top) + ${Math.max(8, pull - 28)}px)` }}>
      <div className={`w-9 h-9 rounded-full bg-panel border border-edge2 shadow-lg flex items-center justify-center ${ready ? "text-up" : "text-dim"}`}>
        <RefreshCw size={16} className={busy ? "animate-spin" : ""}
                   style={{ transform: busy ? undefined : `rotate(${pull * 3}deg)` }} />
      </div>
    </div>
  );
}
