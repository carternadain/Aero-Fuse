"use client";

import { useEffect, useState } from "react";
import {
  Area,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { X } from "lucide-react";
import type { HistoryResponse } from "@/lib/types";
import { api, fmtPrice } from "@/lib/api";

export default function ScoreHistoryChart({
  kind,
  id,
  symbol,
  onClose,
}: {
  kind: "crypto" | "stock";
  id: string;
  symbol: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .get<HistoryResponse>(`/api/markets/history/${kind}/${id}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [kind, id]);

  const points = (data?.points ?? []).filter((p) => p.score != null);
  const latest = points[points.length - 1];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      onClick={onClose}
    >
      <div
        className="panel w-full max-w-3xl p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-extrabold text-txt">
              {symbol} <span className="text-amber">long-term score history</span>
            </h3>
            <p className="text-[11px] text-faint">
              Green band = accumulate zone · red band = overbought · white line = price
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        {loading && <p className="py-16 text-center text-dim text-sm">Loading history…</p>}
        {!loading && points.length < 2 && (
          <p className="py-16 text-center text-dim text-sm">
            Not enough history available (data source may be rate-limited — try again shortly).
          </p>
        )}

        {!loading && points.length >= 2 && (
          <>
            <div className="h-[340px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                  {/* Score zones */}
                  <ReferenceArea yAxisId="score" y1={75} y2={100} fill="var(--color-up)" fillOpacity={0.07} />
                  <ReferenceArea yAxisId="score" y1={0} y2={25} fill="var(--color-down)" fillOpacity={0.07} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 9, fill: "var(--color-faint)" }}
                    minTickGap={48}
                    tickFormatter={(d: string) => d.slice(2, 7)}
                  />
                  <YAxis
                    yAxisId="score"
                    domain={[0, 100]}
                    tick={{ fontSize: 9, fill: "var(--color-faint)" }}
                    width={28}
                  />
                  <YAxis yAxisId="price" orientation="right" hide domain={["dataMin", "dataMax"]} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-panel2)",
                      border: "1px solid var(--color-edge2)",
                      borderRadius: 10,
                      fontSize: 11,
                    }}
                    labelStyle={{ color: "var(--color-dim)" }}
                    formatter={(val, name) => {
                      const n = Number(val);
                      return name === "price"
                        ? [`$${fmtPrice(n)}`, "price"]
                        : [String(Math.round(n)), "score"];
                    }}
                  />
                  <Area
                    yAxisId="score"
                    type="monotone"
                    dataKey="score"
                    stroke="var(--color-cyan)"
                    strokeWidth={1.5}
                    fill="var(--color-cyan)"
                    fillOpacity={0.12}
                    isAnimationActive={false}
                  />
                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="price"
                    stroke="var(--color-txt)"
                    strokeWidth={1.25}
                    dot={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {latest && (
              <div className="flex items-center justify-center gap-6 text-xs text-dim tabular-nums">
                <span>Now: <span className="text-txt font-bold">${fmtPrice(latest.price)}</span></span>
                <span>Score: <span className="text-cyan font-bold">{latest.score}</span></span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
