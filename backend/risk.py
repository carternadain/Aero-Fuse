"""Portfolio risk rating — descriptive rules of thumb, not advice.

Buckets every dollar (live holdings + manual accounts), then scores how much of
the total sits in things that can drop hard or go to zero: options, leveraged
ETFs, small-cap crypto, and single-name concentration. Debt and a thin cash
cushion add to the score.
"""

STABLES = {"USDC", "USDT", "GUSD", "DAI", "PYUSD", "FDUSD", "TUSD"}
MAJOR_CRYPTO = {"BTC", "ETH", "IBIT", "FBTC", "BITB", "ETHA", "FETH"}   # incl. spot ETFs
BROAD_FUNDS = {"VOO", "VTI", "SPY", "IVV", "ITOT", "SCHB", "VT", "VXUS", "QQQ", "SCHD", "VUG",
               "BND", "BOND", "AGG", "VTEB", "SCHX", "SPLG", "VGT",
               "IWV", "VTHR", "ACWX", "IXUS", "VEU", "VTABX", "BNDX", "VGSLX", "VNQ", "FXAIX", "FSKAX"}
LEVERAGED = {"TSLL", "TQQQ", "SQQQ", "SOXL", "SOXS", "UPRO", "SPXL", "NVDL", "NVDU", "MSTU", "MSTX",
             "CONL", "TSLT", "TNA", "LABU", "FNGU", "BITX", "ETHU", "UVXY"}

BUCKET_LABELS = {
    "cash": "Cash & stablecoins",
    "retirement": "401(k) funds",
    "broad": "Index funds & ETFs",
    "stocks": "Single stocks",
    "crypto_major": "Bitcoin & Ethereum",
    "crypto_alt": "Altcoins",
    "options": "Options",
    "leveraged": "Leveraged ETFs",
    "other": "Other assets",
}
SPECULATIVE = {"options", "leveraged", "crypto_alt"}


def _bucket_holding(h: dict) -> str:
    sym, kind = h["symbol"].upper(), h["kind"]
    if kind == "stock" and sym in BROAD_FUNDS and "401" in (h.get("label") or ""):
        return "retirement"  # index funds held inside a 401(k) count as 401(k) funds
    if kind == "option":
        return "options"
    if kind == "crypto":
        if sym in STABLES:
            return "cash"
        return "crypto_major" if sym in MAJOR_CRYPTO else "crypto_alt"
    if sym in LEVERAGED:
        return "leveraged"
    if sym in MAJOR_CRYPTO:
        return "crypto_major"
    return "broad" if sym in BROAD_FUNDS else "stocks"


def _bucket_account(a: dict) -> str:
    return {"cash": "cash", "retirement": "retirement", "brokerage": "stocks",
            "crypto": "crypto_alt"}.get(a["category"], "other")


def rate(holdings: list[dict], accounts: list[dict], monthly_expenses: float | None) -> dict:
    buckets = {k: 0.0 for k in BUCKET_LABELS}
    positions: list[tuple[str, float]] = []
    for h in holdings:
        if h.get("value"):
            b = _bucket_holding(h)
            buckets[b] += h["value"]
            if b not in ("broad", "cash"):  # an S&P 500 fund isn't single-name concentration
                positions.append((h.get("display") or h["symbol"], h["value"]))
    liabilities = 0.0
    for a in accounts:
        if a["kind"] == "liability":
            liabilities += a["balance"]
        else:
            buckets[_bucket_account(a)] += a["balance"]

    assets = sum(buckets.values())
    if assets <= 0:
        return {"score": None, "label": "No data", "buckets": [], "findings": []}

    pct = {k: v / assets * 100 for k, v in buckets.items()}
    spec = sum(pct[k] for k in SPECULATIVE)
    crypto = pct["crypto_major"] + pct["crypto_alt"]
    debt_ratio = liabilities / assets * 100

    # Merge the same symbol held in several accounts before measuring concentration.
    merged: dict[str, float] = {}
    for name, v in positions:
        merged[name] = merged.get(name, 0) + v
    top_name, top_val = max(merged.items(), key=lambda kv: kv[1]) if merged else ("", 0.0)
    top_pct = top_val / assets * 100

    months_cash = (buckets["cash"] / monthly_expenses) if monthly_expenses else None

    score = spec * 1.1
    score += max(0.0, top_pct - 10) * 1.0
    score += 8 if crypto > 30 else 0
    score += debt_ratio * 1.5
    if months_cash is not None:
        score += 12 if months_cash < 3 else 0
    elif pct["cash"] < 5:
        score += 8
    score = round(min(100.0, score))

    if debt_ratio > 40:
        label = "Over-leveraged"
    elif score >= 75:
        label = "Very high risk"
    elif score >= 55:
        label = "High risk"
    elif score >= 35:
        label = "Aggressive"
    elif score >= 18:
        label = "Moderate"
    else:
        label = "Conservative"

    f: list[dict] = []
    def add(level: str, text: str):
        f.append({"level": level, "text": text})

    if pct["options"] + pct["leveraged"] >= 10:
        add("high", f"{pct['options'] + pct['leveraged']:.0f}% is in options and leveraged ETFs. These move "
                    "2–10× the underlying stock, and options can expire worth $0.")
    if pct["crypto_alt"] >= 15:
        add("high", f"{pct['crypto_alt']:.0f}% is in altcoins. Altcoins have historically dropped 70–90% in bear markets.")
    elif crypto >= 25:
        add("medium", f"Crypto is {crypto:.0f}% of your assets, so expect big swings in your net worth.")
    if top_pct >= 12:
        add("high" if top_pct >= 25 else "medium",
            f"{top_name} alone is {top_pct:.0f}% of everything you own, so that one position can move your whole net worth.")
    if months_cash is not None:
        add("high" if months_cash < 3 else "good",
            f"Cash covers about {months_cash:.1f} months of expenses (common target: 3–6).")
    else:
        add("medium" if pct["cash"] < 10 else "good",
            f"Cash is {pct['cash']:.0f}% of assets. Log a month of spending in the Budget tracker to see how many months that covers.")
    if liabilities == 0:
        add("good", "No debt or margin recorded, so you're not borrowing to invest.")
    elif debt_ratio > 20:
        add("high", f"Debt is {debt_ratio:.0f}% of your assets.")
    else:
        add("good", f"Debt is low at {debt_ratio:.0f}% of assets.")
    safe = pct["retirement"] + pct["broad"]
    if safe >= 30:
        add("good", f"{safe:.0f}% sits in diversified index and 401(k) funds, which is a solid core.")

    order = {"high": 0, "medium": 1, "good": 2}
    f.sort(key=lambda x: order[x["level"]])
    return {
        "score": score,
        "label": label,
        "speculative_pct": round(spec, 1),
        "crypto_pct": round(crypto, 1),
        "top_position": {"name": top_name, "pct": round(top_pct, 1)},
        "debt_ratio": round(debt_ratio, 1),
        "months_cash": round(months_cash, 1) if months_cash is not None else None,
        "buckets": [
            {"key": k, "label": BUCKET_LABELS[k], "value": round(v, 2), "pct": round(pct[k], 1),
             "speculative": k in SPECULATIVE}
            for k, v in sorted(buckets.items(), key=lambda kv: -kv[1]) if v > 0
        ],
        "findings": f,
    }
