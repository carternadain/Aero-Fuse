"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

export default function TickerEditor({
  symbols,
  onSave,
}: {
  symbols: string[];
  onSave: (next: string[]) => void;
}) {
  const [adding, setAdding] = useState("");

  const add = () => {
    const t = adding.toUpperCase().trim();
    if (t && !symbols.includes(t)) onSave([...symbols, t]);
    setAdding("");
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 max-sm:gap-y-2.5">
      {symbols.map((s) => (
        <span
          key={s}
          className="inline-flex items-center gap-1 px-2 py-0.5 max-sm:min-h-8 max-sm:gap-3 rounded-md bg-panel2 border border-edge2 text-[11px] font-semibold text-dim"
        >
          {s}
          <button
            className="icon-btn"
            onClick={() => onSave(symbols.filter((x) => x !== s))}
            title={`Remove ${s}`}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <div className="inline-flex items-center gap-1">
        <input
          className="field !w-20 max-sm:!w-28 !py-1 !px-2 sm:text-[11px] uppercase"
          placeholder="TICKER" autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="off" enterKeyHint="go"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="btn !py-1 !px-1.5" onClick={add} title="Add ticker">
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}
