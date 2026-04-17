from __future__ import annotations

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.models import BriefingRequest, BriefingResponse
from app.service import build_briefing

app = FastAPI(title="Morning Stock Briefing POC", version="0.1.0")
settings = get_settings()
app.mount("/audio", StaticFiles(directory=settings.output_dir), name="audio")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/briefing", response_model=BriefingResponse)
async def create_briefing(req: BriefingRequest) -> BriefingResponse:
    return await build_briefing(req)
