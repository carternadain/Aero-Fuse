"use client";

import { useEffect, useState } from "react";
import type { CryptoContext as Ctx } from "@/lib/types";
import { api } from "@/lib/api";

function fngColor(v: number): string {
  if (v >= 75) return "var(--color-up)";      // extreme greed
  if (v >= 55) return "var(--color-cyan)";
  if (v >= 45) return "var(--color-amber)";
  if (v >= 25) return "var(--color-warn)";
  return "var(--color-down)";                  // extreme fear
}

function mcap(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(0)}B`;
  return `$${n}`;
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col px-4 py-2 min-w-[110px]">
      <span className="text-[9px] uppercase tracking-wide text-faint">{label}</span>
      <span className="text-sm font-bold tabular-nums">{children}</span>
    </div>
  );
}

export default function CryptoContext() {
  const [c, setC] = useState<Ctx | null>(null);

  useEffect(() => {
    api.get<Ctx>("/api/context/crypto").then(setC).catch(() => {});
  }, []);

  if (!c) return null;

  return (
    <div className="panel flex flex-wrap items-center divide-x divide-edge">
      <Cell label="Fear & Greed">
        {c.fng_value != null ? (
          <span className="flex items-center gap-2">
            <span style={{ color: fngColor(c.fng_value) }}>{c.fng_value}</span>
            <span className="text-[10px] font-semibold" style={{ color: fngColor(c.fng_value) }}>
              {c.fng_label}
            </span>
          </span>
        ) : "—"}
      </Cell>
      <Cell label="BTC Dominance">
        <span className="text-txt">{c.btc_dominance != null ? `${c.btc_dominance}%` : "—"}</span>
      </Cell>
      <Cell label="Alt read">
        <span className={c.alt_read === "Alts leading" ? "text-up" : "text-dim"}>{c.alt_read ?? "—"}</span>
      </Cell>
      <Cell label="Total Mcap">
        <span className="text-txt">{mcap(c.total_mcap)}</span>
      </Cell>
      <Cell label="Mcap 24h">
        <span className={`${(c.mcap_change_24h ?? 0) >= 0 ? "text-up" : "text-down"}`}>
          {c.mcap_change_24h != null ? `${c.mcap_change_24h >= 0 ? "+" : ""}${c.mcap_change_24h}%` : "—"}
        </span>
      </Cell>
    </div>
  );
}
