"""Claude API integration — headline sentiment scoring and trade-signal evaluation.

Uses claude-sonnet-4-6 with structured JSON output so responses are always
machine-parseable (the future Toobit bot consumes evaluate_signal directly).
"""

import json
import os

import anthropic

MODEL = "claude-sonnet-4-6"

_client: anthropic.Anthropic | None = None


def get_client() -> anthropic.Anthropic | None:
    global _client
    if not os.getenv("ANTHROPIC_API_KEY"):
        return None
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


SENTIMENT_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "sentiment": {"type": "string", "enum": ["bullish", "bearish", "neutral"]},
                    "summary": {"type": "string"},
                },
                "required": ["id", "sentiment", "summary"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["items"],
    "additionalProperties": False,
}

SENTIMENT_SYSTEM = (
    "You are a market sentiment analyst for a swing trader who trades SOL/USD crypto "
    "and holds long-dated call options on SOFI, RDW, and MSFT. For each headline, classify "
    "sentiment as bullish, bearish, or neutral FROM THE PERSPECTIVE OF THE TICKER(S) the "
    "headline concerns, and write a one-line summary of why it matters (or doesn't) to a "
    "swing trader. Be decisive — only use neutral when the headline genuinely has no "
    "directional implication."
)


def score_headlines(headlines: list[dict]) -> dict[str, dict]:
    """Returns {headline_id: {sentiment, summary}}. Empty dict if no API key."""
    client = get_client()
    if client is None or not headlines:
        return {}

    payload = [
        {"id": h["id"], "title": h["title"], "symbols": h.get("symbols", [])}
        for h in headlines
    ]
    try:
        response = client.messages.create(
            model=MODEL,
            max_tokens=4096,
            thinking={"type": "disabled"},
            output_config={
                "effort": "low",
                "format": {"type": "json_schema", "schema": SENTIMENT_SCHEMA},
            },
            system=SENTIMENT_SYSTEM,
            messages=[{
                "role": "user",
                "content": "Score these headlines:\n" + json.dumps(payload, indent=2),
            }],
        )
        text = next(b.text for b in response.content if b.type == "text")
        data = json.loads(text)
        return {item["id"]: {"sentiment": item["sentiment"], "summary": item["summary"]}
                for item in data["items"]}
    except anthropic.APIError as e:
        print(f"[claude] sentiment error: {e}")
        return {}


EVAL_SCHEMA = {
    "type": "object",
    "properties": {
        "take_trade": {"type": "boolean"},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "confluence_score": {"type": "integer"},
        "reasons": {"type": "array", "items": {"type": "string"}},
        "warnings": {"type": "array", "items": {"type": "string"}},
        "suggested_sl": {"type": ["number", "null"]},
        "suggested_tp1": {"type": ["number", "null"]},
    },
    "required": ["take_trade", "confidence", "confluence_score", "reasons", "warnings",
                 "suggested_sl", "suggested_tp1"],
    "additionalProperties": False,
}

EVAL_SYSTEM = """You are the trade-evaluation engine for a disciplined swing trader. Apply these rules strictly:

1. CONFLUENCE REQUIRED: only recommend taking a trade when BOTH NeuroWave AND Kryptonite fired the same direction on the same asset within the recent window. A single-indicator signal is an automatic skip unless conviction is high AND a liquidity sweep just occurred at a key level.
2. LIQUIDITY SWEEPS: a recent sweep of a marked liquidity level in the opposite direction (stop hunt) followed by reversal is strong confluence. Entering AFTER the sweep is preferred.
3. TARGETS: TP1 = 1.618 fib extension, TP2 = 2.618, TP3 = 3.618. SL goes beyond the liquidity sweep wick.
4. MINIMUM 2:1 RR to TP1, target 3:1+. If RR < 2 the trade is a skip, no exceptions.
5. HTF ALIGNMENT: the 4H/daily trend should agree with the trade direction.
6. SENTIMENT: strongly bearish news sentiment is a warning against longs (and vice versa).
7. QUALITY OVER QUANTITY: the trader targets a 70%+ win rate by skipping aggressively. When in doubt, skip — say so plainly.

confluence_score is 0-10. Be conservative: most signals should score under 7 and be skipped."""


def evaluate_signal(signal: dict, recent_signals: list[dict], levels: list[dict],
                    sentiment_summary: str = "") -> dict:
    """Confluence-rules evaluation of a signal. The future bot gates entries on take_trade."""
    client = get_client()
    if client is None:
        return {
            "take_trade": False, "confidence": "low", "confluence_score": 0,
            "reasons": [], "warnings": ["ANTHROPIC_API_KEY not set — cannot evaluate"],
            "suggested_sl": None, "suggested_tp1": None,
        }

    context = {
        "new_signal": signal,
        "recent_signals_same_asset": recent_signals,
        "key_levels": [lv for lv in levels if lv["asset"] == signal.get("asset", "").upper()],
        "news_sentiment": sentiment_summary or "unavailable",
    }
    response = client.messages.create(
        model=MODEL,
        max_tokens=2048,
        thinking={"type": "adaptive"},
        output_config={"format": {"type": "json_schema", "schema": EVAL_SCHEMA}},
        system=EVAL_SYSTEM,
        messages=[{
            "role": "user",
            "content": "Evaluate this signal against the rules:\n" + json.dumps(context, indent=2),
        }],
    )
    text = next(b.text for b in response.content if b.type == "text")
    return json.loads(text)
