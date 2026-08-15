"""Long-term buy / overbought scoring — the 'cool math'.

Pure functions over a list of daily closes (oldest → newest). Used identically
for crypto (CoinGecko history) and stocks (yfinance history), so the score means
the same thing everywhere.

The composite Long-Term Score is 0–100:
    high  → oversold / good long-term accumulation zone
    low   → extended / overbought

It blends three classic mean-reversion signals:
    35%  RSI(14)                  — momentum exhaustion
    35%  distance from 200-day MA — how stretched from the long-term trend
    30%  52-week range position   — where price sits in its yearly range
"""

from __future__ import annotations


def clamp(x: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, x))


def sma(closes: list[float], n: int) -> float | None:
    if len(closes) < n:
        return None
    return sum(closes[-n:]) / n


def rsi(closes: list[float], period: int = 14) -> float | None:
    """Wilder's RSI. Returns None if not enough data."""
    if len(closes) < period + 1:
        return None
    gains, losses = 0.0, 0.0
    # Seed with the first `period` changes.
    for i in range(1, period + 1):
        change = closes[i] - closes[i - 1]
        if change >= 0:
            gains += change
        else:
            losses -= change
    avg_gain = gains / period
    avg_loss = losses / period
    # Wilder smoothing over the rest.
    for i in range(period + 1, len(closes)):
        change = closes[i] - closes[i - 1]
        gain = max(change, 0.0)
        loss = max(-change, 0.0)
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def _label(score: float) -> str:
    if score >= 75:
        return "Accumulate"
    if score >= 60:
        return "Buy zone"
    if score >= 40:
        return "Neutral"
    if score >= 25:
        return "Overbought"
    return "Extremely overbought"


def long_term_score(closes: list[float]) -> dict | None:
    """Composite 0–100 long-term buy score from daily closes (oldest→newest).

    Returns None if there isn't enough history to be meaningful.
    """
    closes = [float(c) for c in closes if c is not None]
    if len(closes) < 30:
        return None

    price = closes[-1]
    r = rsi(closes, 14)
    sma200 = sma(closes, 200)
    sma50 = sma(closes, 50)

    # Use up to a year of data for the 52-week range.
    window = closes[-365:]
    hi, lo = max(window), min(window)

    parts: list[tuple[float, float]] = []  # (score, weight)

    # 1) RSI — invert so low RSI (oversold) scores high.
    if r is not None:
        parts.append((clamp(100.0 - r), 0.35))

    # 2) Distance from the 200-day MA. ~+25% above ⇒ 0, ~-25% below ⇒ 100.
    vs_200 = None
    if sma200:
        vs_200 = (price - sma200) / sma200
        parts.append((clamp(50.0 - vs_200 * 200.0), 0.35))

    # 3) Position within the 52-week range. Near the low ⇒ buy.
    range_pos = None
    if hi > lo:
        range_pos = (price - lo) / (hi - lo)
        parts.append((clamp((1.0 - range_pos) * 100.0), 0.30))

    if not parts:
        return None

    total_w = sum(w for _, w in parts)
    score = round(sum(s * w for s, w in parts) / total_w, 1)

    # Trend context from the 50/200 cross.
    if sma50 and sma200:
        trend = "uptrend" if sma50 >= sma200 else "downtrend"
    else:
        trend = "unknown"

    return {
        "score": score,
        "label": _label(score),
        "rsi": round(r, 1) if r is not None else None,
        "vs_200dma_pct": round(vs_200 * 100, 1) if vs_200 is not None else None,
        "range_pos": round(range_pos * 100, 1) if range_pos is not None else None,
        "trend": trend,
    }


def label_for(score: float | None) -> str | None:
    return _label(score) if score is not None else None


def band(score: float | None) -> str:
    """Coarse alert band: only the two ends are noteworthy for notifications."""
    if score is None:
        return "unknown"
    if score >= 75:
        return "accumulate"
    if score <= 25:
        return "overbought"
    return "neutral"


def score_series(closes: list[float]) -> list[float | None]:
    """Point-in-time long-term score at each day (aligned to `closes`).

    Computes the same composite score using only the data available up to each
    day, so the resulting line shows historically when the asset was in an
    accumulate zone (high) vs overbought (low). None until enough history exists.
    """
    closes = [float(c) for c in closes if c is not None]
    out: list[float | None] = []
    for i in range(len(closes)):
        s = long_term_score(closes[: i + 1])
        out.append(s["score"] if s else None)
    return out
