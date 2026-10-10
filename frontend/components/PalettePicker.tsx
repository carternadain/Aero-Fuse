"use client";

import { useEffect, useRef, useState } from "react";
import { Palette, PartyPopper } from "lucide-react";
import { setHolidayFxOff, useHolidayFx } from "@/lib/holidays";

const PALETTES = [
  { key: "calm", name: "Calm", hint: "Blue up · soft orange down", up: "#6cb4ff", down: "#f4a261" },
  { key: "mono", name: "Mono", hint: "No color: ▲▼ and +/− only", up: "#f2ede4", down: "#a59c8e" },
  { key: "classic", name: "Classic", hint: "Green up · red down", up: "#2ae79c", down: "#ff7a6f" },
] as const;

type Key = (typeof PALETTES)[number]["key"];

/** On/off switch for seasonal holiday effects; shared by the desktop popover and the phone menu. */
export function HolidayToggle({ className = "" }: { className?: string }) {
  const { off } = useHolidayFx();
  const on = !off;
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => setHolidayFxOff(on)}
      className={`w-full flex items-center gap-2.5 px-2 py-2.5 rounded-md text-left text-xs font-bold text-txt hover:bg-panel2/60 ${className}`}
    >
      <PartyPopper size={15} className="text-dim" />
      <span className="flex-1">Holiday effects</span>
      <span className="text-[10px] font-semibold text-dim">{on ? "On" : "Off"}</span>
      <span className={`relative w-8 h-[18px] rounded-full shrink-0 transition-colors ${on ? "bg-up" : "bg-edge2"}`} aria-hidden>
        <span className={`absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-txt transition-transform ${on ? "translate-x-[14px]" : ""}`} />
      </span>
    </button>
  );
}

/** `list` renders just the options (for the phone header's menu); the default is an icon with a popover. */
export default function PalettePicker({ variant = "icon" }: { variant?: "icon" | "list" }) {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState<Key>("calm");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCur((document.documentElement.dataset.palette as Key) || "calm");
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = (k: Key) => {
    setCur(k);
    if (k === "calm") delete document.documentElement.dataset.palette;
    else document.documentElement.dataset.palette = k;
    try { localStorage.setItem("palette", k); } catch { /* private mode */ }
    setOpen(false);
  };

  const options = PALETTES.map((p) => (
    <button
      key={p.key}
      onClick={() => pick(p.key)}
      className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left transition-colors ${
        cur === p.key ? "bg-panel2" : "hover:bg-panel2/60"
      }`}
    >
      <span className="flex shrink-0">
        <span className="w-3 h-3 rounded-full" style={{ background: p.up }} />
        <span className="w-3 h-3 rounded-full -ml-1 ring-2 ring-panel" style={{ background: p.down }} />
      </span>
      <span>
        <span className="block text-xs font-bold text-txt">{p.name}</span>
        <span className="block text-[10px] text-faint">{p.hint}</span>
      </span>
    </button>
  ));

  if (variant === "list") return <>{options}</>;

  return (
    <div className="relative" ref={ref}>
      <button className="icon-btn !text-dim hover:!text-txt" onClick={() => setOpen(!open)} title="Gain / loss colors">
        <Palette size={15} />
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-50 w-56 panel !overflow-visible p-1.5 shadow-xl">
          <p className="px-2 pt-1 pb-1.5 text-[10px] text-faint">Colors for gains and losses</p>
          {options}
          <HolidayToggle className="mt-1 border-t border-edge" />
        </div>
      )}
    </div>
  );
}
