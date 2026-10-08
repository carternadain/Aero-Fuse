"use client";

import { useEffect, useRef, useState } from "react";
import { Palette } from "lucide-react";

const PALETTES = [
  { key: "calm", name: "Calm", hint: "Blue up · soft orange down", up: "#6cb4ff", down: "#f4a261" },
  { key: "mono", name: "Mono", hint: "No color: ▲▼ and +/− only", up: "#f2ede4", down: "#a59c8e" },
  { key: "classic", name: "Classic", hint: "Green up · red down", up: "#2ae79c", down: "#ff7a6f" },
] as const;

type Key = (typeof PALETTES)[number]["key"];

export default function PalettePicker() {
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

  return (
    <div className="relative" ref={ref}>
      <button className="icon-btn !text-dim hover:!text-txt" onClick={() => setOpen(!open)} title="Gain / loss colors">
        <Palette size={15} />
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-50 w-56 panel !overflow-visible p-1.5 shadow-xl">
          <p className="px-2 pt-1 pb-1.5 text-[10px] text-faint">Colors for gains and losses</p>
          {PALETTES.map((p) => (
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
          ))}
        </div>
      )}
    </div>
  );
}
