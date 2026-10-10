"use client";

import Skeleton from "./Skeleton";
import { useCallback, useEffect, useState } from "react";
import { Layers } from "lucide-react";
import type { Zone, ZoneHolding, ZoneHorizon, ZonesResponse } from "@/lib/types";
import { api, fmtPnl } from "@/lib/api";
import { haptic, navigate } from "@/lib/bus";
import { fmtCents, isHidden } from "@/lib/privacy";
import { HORIZONS, HORIZON_KEY, SEL_KEY, ZONE_COLOR, ZONE_NAME, fmtRisk, isHorizon, zoneOf, type ZoneHoldingX } from "./CheckTicker";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Row({ h, risk, horizon, onPick }: { h: ZoneHoldingX; risk: number | null; horizon: ZoneHorizon; onPick: (h: ZoneHolding) => void }) {
  const z = zoneOf(risk);
  const c = z ? ZONE_COLOR[z] : "var(--color-dim)";
  // Crypto long term gets its cycle read ("Room to run (62% below its high)"); elsewhere the zone says it.
  const read = h.kind === "crypto" && horizon === "long"
    ? h.read?.long ?? (risk == null && h.risk ? "needs about a year of history" : null) : null;
  return (
    <button
      onClick={() => onPick(h)}
      className="w-full min-h-[44px] flex items-center gap-2 px-3 py-2 text-left hover:bg-panel2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cyan"
    >
      <span className="font-bold text-txt text-sm w-14 shrink-0 truncate">{h.symbol}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-semibold truncate" style={{ color: c }}>
          <span className="tabular-nums">Risk {risk != null ? fmtRisk(risk) : "—"}</span>{z && <> · {ZONE_NAME[z]}</>}
        </span>
        {read ? (
          <span className="block text-[11px] text-dim truncate">{cap(read)}</span>
        ) : (
          <span className="block text-[10px] text-faint tabular-nums truncate">
            {h.weight_pct.toFixed(1)}% of holdings{isHidden() ? "" : ` · ${fmtCents(h.value)}`}
          </span>
        )}
      </span>
      <span className="shrink-0 text-right">
        {h.gain_pct != null && (
          <span className={`block tabular-nums text-[12px] font-bold ${h.gain_pct >= 0 ? "text-up" : "text-down"}`}>{fmtPnl(h.gain_pct)}</span>
        )}
        {read && <span className="block text-[10px] text-faint tabular-nums">{h.weight_pct.toFixed(1)}%<span className="sr-only"> of holdings</span></span>}
      </span>
    </button>
  );
}

export default function HoldingsRisk() {
  const [data, setData] = useState<ZonesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [horizon, setHorizon] = useState<ZoneHorizon>(() => {
    try { const h = localStorage.getItem(HORIZON_KEY); if (isHorizon(h)) return h; } catch { /* unavailable */ }
    return "long";
  });

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    api
      .get<ZonesResponse>("/api/zones")
      .then(setData)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const chooseHorizon = (h: ZoneHorizon) => {
    haptic();
    setHorizon(h);
    try { localStorage.setItem(HORIZON_KEY, h); } catch { /* unavailable */ }
  };

  const pick = (h: ZoneHolding) => {
    haptic();
    try { localStorage.setItem(SEL_KEY, JSON.stringify({ kind: h.kind, symbol: h.symbol })); } catch { /* unavailable */ }
    navigate({ tab: "markets", sub: "check" });
  };

  const rows = (data?.holdings ?? [])
    .map((h) => ({ h, r: h.risk?.[horizon] ?? null }))
    .sort((a, b) => (a.r == null ? 1 : 0) - (b.r == null ? 1 : 0) || (b.r ?? 0) - (a.r ?? 0));
  const count = (z: Zone) => rows.filter((x) => zoneOf(x.r) === z).length;
  const summary: { z: Zone; n: number; text: string }[] = [
    { z: "sell", n: count("sell"), text: "to take profits" },
    { z: "hold", n: count("hold"), text: "hold" },
    { z: "buy", n: count("buy"), text: "to add more" },
  ];

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title"><Layers size={14} /> Your holdings</span>
        <div role="group" aria-label="Time horizon" className="seg inline-flex rounded-lg border border-edge2 text-[12px]">
          {HORIZONS.map((hz) => (
            <button key={hz.key} onClick={() => chooseHorizon(hz.key)} aria-pressed={horizon === hz.key}
                    className={`h-10 px-3 font-bold focus-visible:outline-2 focus-visible:outline-cyan ${horizon === hz.key ? "bg-panel2 text-txt" : "text-dim hover:text-txt"}`}>
              {hz.label}
            </button>
          ))}
        </div>
      </div>

      {loading && !data && <div className="p-3 space-y-2"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>}
      {failed && !data && (
        <div className="px-3 py-6 text-center">
          <p className="text-dim text-xs">Couldn&apos;t load your holdings.</p>
          <button className="btn min-h-10 mt-2" onClick={load}>Try again</button>
        </div>
      )}

      {data && (data.holdings.length === 0 ? (
        <div className="px-3 py-5 flex flex-wrap items-center gap-3">
          <p className="text-xs text-dim">Add holdings in Wealth to see their risk.</p>
          <button className="btn min-h-10" onClick={() => navigate({ tab: "wealth", anchor: "sec-wealth" })}>Go to Wealth</button>
        </div>
      ) : (
        <>
          <p className="px-3 pt-3 pb-1 text-[13px] text-dim tabular-nums">
            {summary.filter((s) => s.n > 0).map((s, i) => (
              <span key={s.z}>{i > 0 && " · "}<span className="font-bold" style={{ color: ZONE_COLOR[s.z] }}>{s.n}</span> {s.text}</span>
            ))}
          </p>
          <div className="divide-y divide-edge">
            {rows.map(({ h, r }) => <Row key={`${h.kind}-${h.symbol}`} h={h} risk={r} horizon={horizon} onPick={pick} />)}
          </div>
          <p className="px-3 py-3 text-[10.5px] text-faint border-t border-edge">Tap a holding to check it.</p>
        </>
      ))}
    </section>
  );
}
