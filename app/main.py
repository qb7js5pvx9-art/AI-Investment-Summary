from __future__ import annotations

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.config import get_settings
from app.models import BriefingRequest, BriefingResponse, StockSearchResponse
from app.service import build_briefing
from app.stocks import search_stocks

app = FastAPI(title="Morning Stock Briefing POC", version="0.1.0")
settings = get_settings()
app.mount("/audio", StaticFiles(directory=settings.output_dir), name="audio")
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/briefing", response_model=BriefingResponse)
async def create_briefing(req: BriefingRequest) -> BriefingResponse:
    return await build_briefing(req)


@app.get("/stocks/search", response_model=StockSearchResponse)
async def stock_search(q: str = "", limit: int = 12) -> StockSearchResponse:
    bounded_limit = max(1, min(limit, 25))
    return StockSearchResponse(results=search_stocks(query=q, limit=bounded_limit))


@app.get("/")
async def home() -> FileResponse:
    return FileResponse("static/index.html")
