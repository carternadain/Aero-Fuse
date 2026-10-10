"""Today's Brief: the handful of things worth knowing today, ranked, in one sentence each.

Pulls from data the app already computes (holdings, Exit Desk, alerts, earnings,
goals, stars) so the Home screen can lead with "what matters" instead of every panel.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import exits
import extras
import market_data


def _money(v: float) -> str:
    return f"{'+' if v >= 0 else '−'}${abs(v):,.0f}"


def build(holdings: list[dict], goals: list[dict]) -> dict:
    hit = market_data._get("brief", 180)
    if hit is not None:
        return hit  # type: ignore[return-value]
    items: list[dict] = []  # {prio, icon, tone, text, sub?, go?}
    now = datetime.now(timezone.utc)

    # 1) today's move and who drove it
    by_sym: dict[str, float] = {}
    total = 0.0
    for h in holdings:
        if h.get("value") and h.get("change_1d") is not None and h["kind"] != "option":
            d = h["value"] - h["value"] / (1 + h["change_1d"] / 100)
            by_sym[h.get("display", h["symbol"])] = by_sym.get(h.get("display", h["symbol"]), 0) + d
            total += d
    if by_sym:
        top = max(by_sym.items(), key=lambda kv: abs(kv[1]))
        share = abs(top[1]) / abs(total) if total else 0
        items.append({"prio": 50, "icon": "move", "tone": "up" if total >= 0 else "down", "money": True,
                      "text": f"Holdings {_money(total)} today" + (f", mostly {top[0]} ({_money(top[1])})" if share > 0.4 else f"; biggest mover {top[0]} ({_money(top[1])})"),
                      "go": {"tab": "home", "anchor": "sec-heatmap"}})

    # 2) Exit Desk: plan hits first, then anything running hot
    try:
        desk = exits.desk(holdings)
    except Exception as e:
        print(f"[brief] exit desk error: {e}")
        desk = {"rows": [], "backdrop": {}}
    for r in desk["rows"]:
        for hit in r["hits"]:
            items.append({"prio": 95, "icon": "target", "tone": hit["tone"], "text": f"{r['display']}: {hit['text']}",
                          "go": {"tab": "markets", "sub": "mine", "anchor": "sec-exits"}})
    hot = [r for r in desk["rows"] if (r["heat"]["overall"] or 0) >= 70]
    if hot:
        names = ", ".join(f"{r['display']} ({r['heat']['overall']:.0f})" for r in hot[:3])
        items.append({"prio": 80, "icon": "flame", "tone": "amber",
                      "text": f"Running hot: {names}" + (f" +{len(hot) - 3} more" if len(hot) > 3 else ""),
                      "sub": "Running hot: stretched vs. its own history", "go": {"tab": "markets", "sub": "mine", "anchor": "sec-exits"}})
    cold = [r for r in desk["rows"] if r["heat"]["overall"] is not None and r["heat"]["overall"] < 25]
    if cold:
        items.append({"prio": 40, "icon": "snow", "tone": "cyan",
                      "text": "Washed out: " + ", ".join(f"{r['display']} ({r['heat']['overall']:.0f})" for r in cold[:3]),
                      "go": {"tab": "markets", "sub": "mine", "anchor": "sec-exits"}})
    for r in desk["rows"]:
        o = r.get("option")
        if o and o.get("dte") is not None and o["dte"] <= 60:
            items.append({"prio": 90 if o["dte"] <= 21 else 75, "icon": "clock", "tone": "down",
                          "text": f"{r['display']} expires in {o['dte']} days" + (f", {o['time_value_share']:.0f}% of its price is time value" if o.get("time_value_share") else ""),
                          "go": {"tab": "markets", "sub": "mine", "anchor": "sec-exits"}})

    # 3) alerts fired in the last day
    cutoff = (now - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    fired = [a for a in extras.alerts() if a.get("triggered_at") and a["triggered_at"] >= cutoff]
    for a in fired[-2:]:
        items.append({"prio": 85, "icon": "bell", "tone": "amber",
                      "text": f"Alert hit: {a['symbol']} {'above' if a['op'] == 'above' else 'below'} ${a['price']:,.2f}",
                      "ticker": {"symbol": a["symbol"], "kind": a["kind"]}})

    # 4) earnings this week for things you own (options count via their stock)
    import re
    owned = set()
    for h in holdings:
        if h["kind"] == "stock" and not h.get("note"):
            owned.add(h["symbol"])
        elif h["kind"] == "option":
            m = re.match(r"([A-Z.]{1,6})\d{6}[CP]", h["symbol"])
            if m:
                owned.add(m.group(1))
    soon = []
    for sym in owned:
        e = market_data.stock_earnings(sym) or {}
        d = e.get("next_earnings")
        if d:
            days = (datetime.strptime(d, "%Y-%m-%d").date() - now.date()).days
            if 0 <= days <= 7:
                soon.append((days, sym))
    if soon:
        soon.sort()
        items.append({"prio": 88, "icon": "calendar", "tone": "amber",
                      "text": "Earnings this week: " + ", ".join(f"{s} ({'today' if d == 0 else 'tomorrow' if d == 1 else f'in {d}d'})" for d, s in soon),
                      "sub": "Option prices usually swing around the report", "go": {"tab": "news", "anchor": "sec-earnings"}})

    # 5) mood shift
    fg = desk.get("backdrop", {}).get("fear_greed")
    if fg and fg.get("week_ago") is not None and abs(fg["value"] - fg["week_ago"]) >= 10:
        items.append({"prio": 45, "icon": "gauge", "tone": "flat",
                      "text": f"Crypto mood moved {fg['week_ago']} → {fg['value']} ({fg['label']}) this week",
                      "go": {"tab": "markets", "sub": "mine", "anchor": "sec-exits"}})

    # 6) goals behind pace
    behind = [g for g in goals if g.get("on_pace") is False and g.get("pct", 0) < 100]
    if behind:
        g = behind[0]
        items.append({"prio": 35, "icon": "flag", "tone": "amber",
                      "text": f"“{g['name']}” is behind pace ({g['pct']:.0f}% there)", "go": {"tab": "wealth", "anchor": "sec-goals"}})

    # 7) a starred ticker moving a lot
    for s in extras.starred():
        q = market_data.live_quote(s["symbol"], s["kind"])
        c = q.get("change_1d")
        if c is not None and abs(c) >= 6:
            items.append({"prio": 55, "icon": "star", "tone": "up" if c > 0 else "down",
                          "text": f"Starred {s['symbol']} {c:+.1f}% today", "ticker": {"symbol": s["symbol"], "kind": s["kind"]}})

    items.sort(key=lambda i: -i["prio"])
    out = {"items": items[:6], "more": max(0, len(items) - 6), "generated": int(now.timestamp())}
    market_data._set("brief", out)
    return out
