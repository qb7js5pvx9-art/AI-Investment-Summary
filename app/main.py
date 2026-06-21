from dotenv import load_dotenv

load_dotenv()

import hmac

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.config import get_settings
from app.models import (
    BriefingRequest,
    BriefingResponse,
    DailyBriefRequest,
    DailyBriefResponse,
    MasterUnlockRequest,
    MasterUnlockResponse,
    StockSearchResponse,
)
from app.quotes import get_all_quotes
from app.service import build_briefing, build_daily_brief
from app.stocks import search_stocks

app = FastAPI(title="Morning Stock Briefing POC", version="0.1.0")
settings = get_settings()
app.mount("/audio", StaticFiles(directory=settings.output_dir), name="audio")
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/briefing", response_model=BriefingResponse)
async def create_briefing(req: BriefingRequest, refresh_news: bool = False) -> BriefingResponse:
    return await build_briefing(req, refresh_news=refresh_news)


@app.post("/daily-brief-mvp", response_model=DailyBriefResponse)
async def create_daily_brief(req: DailyBriefRequest, refresh_news: bool = False) -> DailyBriefResponse:
    return await build_daily_brief(req, refresh_news=refresh_news)


@app.get("/stocks/search", response_model=StockSearchResponse)
async def stock_search(q: str = "", limit: int = 12) -> StockSearchResponse:
    bounded_limit = max(1, min(limit, 25))
    return StockSearchResponse(results=search_stocks(query=q, limit=bounded_limit))


@app.post("/profile/master-unlock", response_model=MasterUnlockResponse)
async def verify_master_unlock(req: MasterUnlockRequest) -> MasterUnlockResponse:
    configured = (settings.master_password or "").strip()
    submitted = (req.password or "").strip()
    unlocked = bool(configured) and hmac.compare_digest(submitted, configured)
    return MasterUnlockResponse(unlocked=unlocked)


@app.get("/market-quotes")
async def market_quotes(tickers: str = "") -> dict[str, dict]:
    """Legacy alias for watchlist quotes."""
    ticker_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    quotes = await get_all_quotes(ticker_list)
    return {"quotes": quotes}


@app.get("/stocks/quotes")
async def get_quotes(tickers: str) -> dict[str, dict]:
    ticker_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    quotes = await get_all_quotes(ticker_list)
    return {"quotes": quotes}


@app.get("/test-finnhub")
async def test_finnhub() -> dict:
    import httpx
    import os

    api_key = os.getenv("FINNHUB_API_KEY")
    url = "https://finnhub.io/api/v1/quote"
    params = {"symbol": "AAPL", "token": api_key}
    async with httpx.AsyncClient() as client:
        r = await client.get(url, params=params)
        return {
            "status": r.status_code,
            "api_key_present": bool(api_key),
            "api_key_length": len(api_key) if api_key else 0,
            "response": r.json(),
        }


@app.get("/")
async def home() -> FileResponse:
    return FileResponse("static/index.html")
