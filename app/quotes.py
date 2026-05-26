from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta

import httpx

from app.config import get_settings


QuoteRow = dict[str, float | str | None]

_quote_cache: dict[str, QuoteRow] = {}
_cache_expiry: dict[str, datetime] = {}


def _optional_float(value: object) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value))
    except (TypeError, ValueError):
        return None


def _normalize_ticker(ticker: str) -> str:
    return ticker.strip().upper()


def _finnhub_symbol(ticker: str) -> str:
    return _normalize_ticker(ticker).replace(".", "-")


def _round_optional(value: object) -> float | None:
    number = _optional_float(value)
    if number is None:
        return None
    return round(number, 2)


def _finnhub_api_key() -> str:
    return (
        os.getenv("FINNHUB_API_KEY")
        or os.getenv("FINNHUB_KEY")
        or get_settings().finnhub_api_key
        or ""
    ).strip()


def _empty_quote(ticker: str, error: str | None) -> QuoteRow:
    return {
        "ticker": ticker,
        "price": None,
        "change": None,
        "change_pct": None,
        "high": None,
        "low": None,
        "open": None,
        "prev_close": None,
        "error": error,
    }


async def get_stock_quote(ticker: str) -> QuoteRow:
    sym = _normalize_ticker(ticker)
    api_key = _finnhub_api_key()
    if not api_key:
        return _empty_quote(sym, "No API key")

    url = "https://finnhub.io/api/v1/quote"
    params = {"symbol": _finnhub_symbol(sym), "token": api_key}

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, params=params, timeout=5.0)
            response.raise_for_status()
            data = response.json()

        price = _round_optional(data.get("c"))
        if price is None or price == 0:
            return _empty_quote(sym, "No data")

        return {
            "ticker": sym,
            "price": price,
            "change": _round_optional(data.get("d")),
            "change_pct": _round_optional(data.get("dp")),
            "high": _round_optional(data.get("h")),
            "low": _round_optional(data.get("l")),
            "open": _round_optional(data.get("o")),
            "prev_close": _round_optional(data.get("pc")),
            "error": None,
        }
    except httpx.HTTPStatusError as e:
        return _empty_quote(sym, f"HTTP {e.response.status_code}")
    except Exception as e:
        return _empty_quote(sym, type(e).__name__)


async def get_stock_quote_cached(ticker: str) -> QuoteRow:
    sym = _normalize_ticker(ticker)
    now = datetime.utcnow()
    if sym in _quote_cache and _cache_expiry.get(sym, now) > now:
        return _quote_cache[sym]

    quote = await get_stock_quote(sym)
    _quote_cache[sym] = quote
    _cache_expiry[sym] = now + timedelta(minutes=15)
    return quote


async def get_all_quotes(tickers: list[str]) -> dict[str, QuoteRow]:
    if not tickers:
        return {}

    normalized = [_normalize_ticker(t) for t in tickers if _normalize_ticker(t)]
    tasks = [get_stock_quote_cached(t) for t in normalized]
    results = await asyncio.gather(*tasks)
    return {str(r["ticker"]): r for r in results}


async def fetch_market_quotes(tickers: list[str]) -> dict[str, QuoteRow]:
    return await get_all_quotes(tickers)
