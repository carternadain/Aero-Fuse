"""News fetching: CryptoPanic if a key is set, otherwise Google News RSS (free, no key)."""

import os
import time
import xml.etree.ElementTree as ET

import requests

CRYPTOPANIC_KEY = os.getenv("CRYPTOPANIC_API_KEY", "")
CACHE_TTL = 600  # seconds

_cache: dict[str, tuple[float, list[dict]]] = {}

MACRO_QUERY = "Federal Reserve OR FOMC OR CPI inflation OR jobs report market"


def _from_cache(key: str) -> list[dict] | None:
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return hit[1]
    return None


def _store(key: str, items: list[dict]):
    _cache[key] = (time.time(), items)


def fetch_cryptopanic(symbols: list[str]) -> list[dict]:
    crypto = [s for s in symbols if s in ("BTC", "SOL", "ETH", "XRP", "DOGE", "ADA", "AVAX", "LINK")]
    if not crypto:
        return []
    resp = requests.get(
        "https://cryptopanic.com/api/developer/v2/posts/",
        params={"auth_token": CRYPTOPANIC_KEY, "currencies": ",".join(crypto), "public": "true"},
        timeout=10,
    )
    resp.raise_for_status()
    items = []
    for post in resp.json().get("results", [])[:25]:
        items.append({
            "id": f"cp-{post.get('id')}",
            "title": post.get("title", ""),
            "url": post.get("url", ""),
            "source": (post.get("source") or {}).get("title", "CryptoPanic"),
            "published": post.get("published_at", ""),
            "symbols": [c.get("code") for c in post.get("currencies", []) if c.get("code")],
        })
    return items


def fetch_google_news(query: str, tag: str) -> list[dict]:
    resp = requests.get(
        "https://news.google.com/rss/search",
        params={"q": query, "hl": "en-US", "gl": "US", "ceid": "US:en"},
        timeout=10,
        headers={"User-Agent": "Mozilla/5.0"},
    )
    resp.raise_for_status()
    root = ET.fromstring(resp.content)
    items = []
    for i, item in enumerate(root.iter("item")):
        if i >= 8:
            break
        title = item.findtext("title") or ""
        items.append({
            "id": f"gn-{tag}-{abs(hash(title)) % 10**10}",
            "title": title,
            "url": item.findtext("link") or "",
            "source": (item.findtext("source") or "Google News"),
            "published": item.findtext("pubDate") or "",
            "symbols": [tag] if tag != "MACRO" else [],
        })
    return items


def get_news(symbols: list[str]) -> list[dict]:
    key = "news:" + ",".join(sorted(symbols))
    cached = _from_cache(key)
    if cached is not None:
        return cached

    items: list[dict] = []
    seen_titles: set[str] = set()

    if CRYPTOPANIC_KEY:
        try:
            items.extend(fetch_cryptopanic(symbols))
        except Exception as e:
            print(f"[news] CryptoPanic error: {e}")

    queries = {
        "BTC": "Bitcoin price", "SOL": "Solana crypto", "SOFI": "SoFi stock",
        "MSFT": "Microsoft stock", "RDW": "Redwire stock",
    }
    for sym in symbols:
        q = queries.get(sym, f"{sym} stock")
        try:
            for it in fetch_google_news(q, sym):
                if it["title"] not in seen_titles:
                    seen_titles.add(it["title"])
                    items.append(it)
        except Exception as e:
            print(f"[news] Google News error for {sym}: {e}")

    _store(key, items)
    return items


def get_macro_news() -> list[dict]:
    cached = _from_cache("macro")
    if cached is not None:
        return cached
    try:
        items = fetch_google_news(MACRO_QUERY, "MACRO")
    except Exception as e:
        print(f"[news] macro error: {e}")
        items = []
    _store("macro", items)
    return items


def clear_cache():
    _cache.clear()
