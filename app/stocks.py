from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class StockEntry:
    symbol: str
    name: str


# Curated liquid/commonly-held US equities/ETFs for POC autocomplete.
POPULAR_STOCKS: list[StockEntry] = [
    StockEntry("AAPL", "Apple Inc."),
    StockEntry("MSFT", "Microsoft Corporation"),
    StockEntry("NVDA", "NVIDIA Corporation"),
    StockEntry("AMZN", "Amazon.com, Inc."),
    StockEntry("GOOGL", "Alphabet Inc. Class A"),
    StockEntry("META", "Meta Platforms, Inc."),
    StockEntry("TSLA", "Tesla, Inc."),
    StockEntry("BRK.B", "Berkshire Hathaway Inc. Class B"),
    StockEntry("JPM", "JPMorgan Chase & Co."),
    StockEntry("V", "Visa Inc."),
    StockEntry("MA", "Mastercard Incorporated"),
    StockEntry("UNH", "UnitedHealth Group Incorporated"),
    StockEntry("LLY", "Eli Lilly and Company"),
    StockEntry("XOM", "Exxon Mobil Corporation"),
    StockEntry("AVGO", "Broadcom Inc."),
    StockEntry("COST", "Costco Wholesale Corporation"),
    StockEntry("WMT", "Walmart Inc."),
    StockEntry("NFLX", "Netflix, Inc."),
    StockEntry("HD", "The Home Depot, Inc."),
    StockEntry("PG", "The Procter & Gamble Company"),
    StockEntry("JNJ", "Johnson & Johnson"),
    StockEntry("ABBV", "AbbVie Inc."),
    StockEntry("BAC", "Bank of America Corporation"),
    StockEntry("KO", "The Coca-Cola Company"),
    StockEntry("PEP", "PepsiCo, Inc."),
    StockEntry("MRK", "Merck & Co., Inc."),
    StockEntry("TMO", "Thermo Fisher Scientific Inc."),
    StockEntry("CVX", "Chevron Corporation"),
    StockEntry("ADBE", "Adobe Inc."),
    StockEntry("CRM", "Salesforce, Inc."),
    StockEntry("ACN", "Accenture plc"),
    StockEntry("ORCL", "Oracle Corporation"),
    StockEntry("CSCO", "Cisco Systems, Inc."),
    StockEntry("AMD", "Advanced Micro Devices, Inc."),
    StockEntry("QCOM", "QUALCOMM Incorporated"),
    StockEntry("INTC", "Intel Corporation"),
    StockEntry("AMAT", "Applied Materials, Inc."),
    StockEntry("TXN", "Texas Instruments Incorporated"),
    StockEntry("INTU", "Intuit Inc."),
    StockEntry("PANW", "Palo Alto Networks, Inc."),
    StockEntry("PLTR", "Palantir Technologies Inc."),
    StockEntry("MU", "Micron Technology, Inc."),
    StockEntry("SHOP", "Shopify Inc."),
    StockEntry("IBM", "International Business Machines Corporation"),
    StockEntry("GE", "GE Aerospace"),
    StockEntry("CAT", "Caterpillar Inc."),
    StockEntry("DE", "Deere & Company"),
    StockEntry("NKE", "NIKE, Inc."),
    StockEntry("MCD", "McDonald's Corporation"),
    StockEntry("SBUX", "Starbucks Corporation"),
    StockEntry("DIS", "The Walt Disney Company"),
    StockEntry("CMCSA", "Comcast Corporation"),
    StockEntry("T", "AT&T Inc."),
    StockEntry("VZ", "Verizon Communications Inc."),
    StockEntry("PFE", "Pfizer Inc."),
    StockEntry("ABT", "Abbott Laboratories"),
    StockEntry("DHR", "Danaher Corporation"),
    StockEntry("BMY", "Bristol-Myers Squibb Company"),
    StockEntry("HON", "Honeywell International Inc."),
    StockEntry("RTX", "RTX Corporation"),
    StockEntry("BA", "The Boeing Company"),
    StockEntry("LMT", "Lockheed Martin Corporation"),
    StockEntry("SPGI", "S&P Global Inc."),
    StockEntry("BLK", "BlackRock, Inc."),
    StockEntry("C", "Citigroup Inc."),
    StockEntry("GS", "The Goldman Sachs Group, Inc."),
    StockEntry("MS", "Morgan Stanley"),
    StockEntry("SCHW", "The Charles Schwab Corporation"),
    StockEntry("PYPL", "PayPal Holdings, Inc."),
    StockEntry("SQ", "Block, Inc."),
    StockEntry("UBER", "Uber Technologies, Inc."),
    StockEntry("LYFT", "Lyft, Inc."),
    StockEntry("SNOW", "Snowflake Inc."),
    StockEntry("NOW", "ServiceNow, Inc."),
    StockEntry("ADP", "Automatic Data Processing, Inc."),
    StockEntry("ADI", "Analog Devices, Inc."),
    StockEntry("LRCX", "Lam Research Corporation"),
    StockEntry("KLAC", "KLA Corporation"),
    StockEntry("ISRG", "Intuitive Surgical, Inc."),
    StockEntry("VRTX", "Vertex Pharmaceuticals Incorporated"),
    StockEntry("REGN", "Regeneron Pharmaceuticals, Inc."),
    StockEntry("GILD", "Gilead Sciences, Inc."),
    StockEntry("AMGN", "Amgen Inc."),
    StockEntry("MDT", "Medtronic plc"),
    StockEntry("CVS", "CVS Health Corporation"),
    StockEntry("BKNG", "Booking Holdings Inc."),
    StockEntry("MAR", "Marriott International, Inc."),
    StockEntry("HLT", "Hilton Worldwide Holdings Inc."),
    StockEntry("DAL", "Delta Air Lines, Inc."),
    StockEntry("UAL", "United Airlines Holdings, Inc."),
    StockEntry("AAL", "American Airlines Group Inc."),
    StockEntry("NEE", "NextEra Energy, Inc."),
    StockEntry("DUK", "Duke Energy Corporation"),
    StockEntry("SO", "The Southern Company"),
    StockEntry("COP", "ConocoPhillips"),
    StockEntry("SLB", "Schlumberger Limited"),
    StockEntry("FCX", "Freeport-McMoRan Inc."),
    StockEntry("NEM", "Newmont Corporation"),
    StockEntry("RIOT", "Riot Platforms, Inc."),
    StockEntry("MARA", "MARA Holdings, Inc."),
    StockEntry("COIN", "Coinbase Global, Inc."),
    StockEntry("SPY", "SPDR S&P 500 ETF Trust"),
    StockEntry("QQQ", "Invesco QQQ Trust"),
    StockEntry("IWM", "iShares Russell 2000 ETF"),
    StockEntry("DIA", "SPDR Dow Jones Industrial Average ETF Trust"),
    StockEntry("VTI", "Vanguard Total Stock Market ETF"),
]


SYMBOL_TO_NAME = {entry.symbol.upper(): entry.name for entry in POPULAR_STOCKS}


def get_company_name(symbol: str) -> str:
    return SYMBOL_TO_NAME.get(symbol.strip().upper(), "")


def search_stocks(query: str, limit: int = 12) -> list[dict[str, str]]:
    needle = query.strip().upper()
    if not needle:
        return [{"symbol": s.symbol, "name": s.name} for s in POPULAR_STOCKS[:limit]]

    starts_with: list[StockEntry] = []
    contains: list[StockEntry] = []
    for stock in POPULAR_STOCKS:
        symbol = stock.symbol.upper()
        name = stock.name.upper()
        if symbol.startswith(needle):
            starts_with.append(stock)
        elif needle in symbol or needle in name:
            contains.append(stock)

    ordered = starts_with + contains
    return [{"symbol": s.symbol, "name": s.name} for s in ordered[:limit]]
