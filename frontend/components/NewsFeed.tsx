"use client";

import { useState } from "react";
import { Minus, Newspaper, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import type { NewsItem, NewsResponse } from "@/lib/types";
import { timeAgo } from "@/lib/api";

const SENTIMENT_STYLES: Record<string, string> = {
  bullish: "bg-up/15 text-up border-up/40",
  bearish: "bg-down/15 text-down border-down/40",
  neutral: "bg-edge text-dim border-edge2",
};

function NewsRow({ item }: { item: NewsItem }) {
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
          <p className="mt-1 text-[10px] text-faint">
            {item.symbols.length > 0 && (
              <span className="text-cyan mr-2">{item.symbols.join(" ")}</span>
            )}
            {item.source} · {timeAgo(item.published)}
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
  const [tab, setTab] = useState<"watchlist" | "macro">("watchlist");
  const items = tab === "watchlist" ? news?.watchlist ?? [] : news?.macro ?? [];

  return (
    <section className="panel flex flex-col max-h-[640px]">
      <div className="panel-head">
        <span className="panel-title"><Newspaper size={14} />News &amp; Sentiment</span>
        <div className="flex items-center gap-2">
          {news && !news.ai_enabled && (
            <span className="text-[9px] text-down font-semibold">AI off — add key</span>
          )}
          <button className="btn !py-1.5 !px-2" onClick={onRefresh} disabled={loading} title="Refresh headlines">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>
      <div className="flex border-b border-edge text-[11px]">
        {(["watchlist", "macro"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 font-bold transition-colors ${
              tab === t ? "text-up border-b-2 border-up" : "text-dim hover:text-txt"
            }`}
          >
            {t === "watchlist" ? "Watchlist" : "Macro / Fed"}
          </button>
        ))}
      </div>
      <div className="overflow-y-auto">
        {items.length === 0 && (
          <p className="p-4 text-xs text-dim">{loading ? "Loading headlines…" : "No headlines."}</p>
        )}
        {items.map((item) => (
          <NewsRow key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}
