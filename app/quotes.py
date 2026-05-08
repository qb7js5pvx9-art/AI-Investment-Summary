from __future__ import annotations

import httpx


def _to_yahoo_symbol(ticker: str) -> str:
    # Yahoo uses "-" for class shares like BRK-B.
    return ticker.upper().replace(".", "-")


async def fetch_market_quotes(tickers: list[str]) -> dict[str, dict[str, float | str | None]]:
    if not tickers:
        return {}

    requested = [_to_yahoo_symbol(t) for t in tickers]
    symbols = ",".join(requested)
    url = "https://query1.finance.yahoo.com/v7/finance/quote"
    params = {"symbols": symbols}

    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
        payload = response.json()

    raw_results = payload.get("quoteResponse", {}).get("result", [])
    out: dict[str, dict[str, float | str | None]] = {}
    for row in raw_results:
        symbol = (row.get("symbol") or "").upper()
        original_symbol = symbol.replace("-", ".")
        out[original_symbol] = {
            "display_name": row.get("shortName") or row.get("longName") or original_symbol,
            "price": row.get("regularMarketPrice"),
            "change": row.get("regularMarketChange"),
            "change_percent": row.get("regularMarketChangePercent"),
            "currency": row.get("currency"),
        }
    return out
