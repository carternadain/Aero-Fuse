"use client";

import { Star } from "lucide-react";
import type { Kind } from "@/lib/bus";
import { haptic } from "@/lib/bus";
import { isStarred, toggleStar, useStars } from "@/lib/stars";

/** ☆ toggle that pins a ticker to the Starred watchlist. Safe inside clickable rows. */
export default function StarButton({ symbol, kind, size = 14, className = "" }: {
  symbol: string; kind?: Kind; size?: number; className?: string;
}) {
  useStars(); // re-render when stars change anywhere
  const on = isStarred(symbol, kind);
  return (
    <button
      className={`icon-btn ${on ? "!text-amber" : ""} ${className}`}
      title={on ? "Remove from Starred" : "Add to Starred"}
      aria-pressed={on}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); haptic(); toggleStar(symbol, kind); }}
    >
      <Star size={size} fill={on ? "currentColor" : "none"} />
    </button>
  );
}
