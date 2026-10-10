"use client";

import { useEffect, useState } from "react";
import { Minus, Newspaper, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import type { NewsItem, NewsResponse } from "@/lib/types";
import { api, timeAgo } from "@/lib/api";
import { openTicker } from "@/lib/bus";

type MineItem = NewsItem & { moves?: Record<string, number | null> };
let mineCache: { items: MineItem[]; symbols: string[] } | null = null;

const SENTIMENT_STYLES: Record<string, string> = {
  bullish: "bg-up/15 text-up border-up/40",
  bearish: "bg-down/15 text-down border-down/40",
  neutral: "bg-edge text-dim border-edge2",
};

function NewsRow({ item }: { item: MineItem }) {
  const SentimentIcon =
    item.sentiment === "bullish" ? TrendingUp : item.sentiment === "bearish" ? TrendingDown : Minus;
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      className="block px-3 py-2.5 border-b border-edge hover:bg-panel2 transition-colors"
    >
      <div className="flex items-start gap-2">
        <span
          className={`shrink-0 mt-0.5 inline-flex items-center gap-1 px-1.5 py-px rounded-md border text-[9px] font-bold uppercase ${SENTIMENT_STYLES[item.sentiment] ?? SENTIMENT_STYLES.neutral}`}
        >
          <SentimentIcon size={9} strokeWidth={2.5} />
          {item.sentiment === "bullish" ? "Bull" : item.sentiment === "bearish" ? "Bear" : "Neutral"}
        </span>
        <div className="min-w-0">
          <p className="text-xs leading-snug text-txt">{item.title}</p>
          {item.summary && <p className="mt-1 text-[11px] leading-snug text-dim italic">{item.summary}</p>}
          <p className="mt-1 text-[10px] text-faint flex flex-wrap items-center gap-1.5">
            {item.symbols.map((s) => {
              const mv = item.moves?.[s];
              return (
                <span key={s} role="button" tabIndex={0}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); openTicker({ symbol: s }); }}
                      className="inline-flex items-center gap-1 px-1.5 py-px rounded-md border border-edge2 text-cyan font-bold hover:border-cyan/60">
                  {s}
                  {mv != null && <span className={mv >= 0 ? "text-up" : "text-down"}>{mv >= 0 ? "+" : ""}{mv.toFixed(1)}%</span>}
                </span>
              );
            })}
            <span>{item.source} · {timeAgo(item.published)}</span>
          </p>
        </div>
      </div>
    </a>
  );
}

export default function NewsFeed({
  news,
  onRefresh,
  loading,
}: {
  news: NewsResponse | null;
  onRefresh: () => void;
  loading: boolean;
}) {
  const [tab, setTab] = useState<"mine" | "watchlist" | "macro">("mine");
  const [mine, setMine] = useState(mineCache);
  const [mineLoading, setMineLoading] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (tab !== "mine" || (mineCache && !reload)) return;
    setMineLoading(true);
    api.get<{ items: MineItem[]; symbols: string[] }>("/api/news/holdings")
      .then((r) => { mineCache = r; setMine(r); }).catch(() => {}).finally(() => setMineLoading(false));
  }, [tab, reload]);
  const items: MineItem[] = tab === "mine" ? mine?.items ?? [] : tab === "watchlist" ? news?.watchlist ?? [] : news?.macro ?? [];
  const busy = tab === "mine" ? mineLoading : loading;

  return (
    <section className="panel flex flex-col max-h-[640px]">
      <div className="panel-head">
        <span className="panel-title"><Newspaper size={14} />News for you</span>
        <div className="flex items-center gap-2">
          {news && !news.ai_enabled && (
            <span className="text-[9px] text-down font-semibold">AI off — add key</span>
          )}
          <button className="btn !py-1.5 !px-2" disabled={busy} title="Refresh headlines"
                  onClick={() => (tab === "mine" ? setReload((n) => n + 1) : onRefresh())}>
            <RefreshCw size={12} className={busy ? "animate-spin" : ""} />
          </button>
        </div>
      </div>
      <div className="flex border-b border-edge text-[11px]">
        {(["mine", "watchlist", "macro"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 font-bold transition-colors ${
              tab === t ? "text-up border-b-2 border-up" : "text-dim hover:text-txt"
            }`}
          >
            {t === "mine" ? "My holdings" : t === "watchlist" ? "Watchlist" : "Macro / Fed"}
          </button>
        ))}
      </div>
      <div className="overflow-y-auto">
        {items.length === 0 && (
          <p className="p-4 text-xs text-dim">{busy ? "Loading headlines…" : "No headlines."}</p>
        )}
        {items.map((item) => (
          <NewsRow key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}
