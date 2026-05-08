from __future__ import annotations

import asyncio

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

    payload: dict = {}
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                response = await client.get(url, params=params)
                response.raise_for_status()
                payload = response.json()
            break
        except httpx.HTTPStatusError as exc:
            # Yahoo can intermittently rate-limit this unauthenticated endpoint.
            # For MVP we degrade gracefully and proceed without live quote fields.
            if exc.response.status_code == 429 and attempt < 2:
                await asyncio.sleep(0.5 * (2**attempt))
                continue
            return {}
        except httpx.HTTPError:
            return {}

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
