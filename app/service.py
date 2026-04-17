from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException

from app.briefing import generate_script, synthesize_audio
from app.config import get_settings
from app.models import BriefingRequest, BriefingResponse
from app.news import fetch_articles


async def build_briefing(req: BriefingRequest) -> BriefingResponse:
    settings = get_settings()
    if not settings.openai_api_key or not settings.newsapi_key:
        raise HTTPException(status_code=500, detail="Missing OPENAI_API_KEY or NEWSAPI_KEY in environment.")

    tickers = [t.strip().upper() for t in req.tickers if t.strip()]
    if not tickers:
        raise HTTPException(status_code=400, detail="At least one ticker is required.")

    articles = await fetch_articles(tickers=tickers, hours_back=req.hours_back, max_articles=req.max_articles)
    if not articles:
        raise HTTPException(status_code=404, detail="No relevant articles found for requested window.")

    script, citations = generate_script(articles=articles, tickers=tickers, target_minutes=req.target_minutes)
    if not script.strip():
        raise HTTPException(status_code=500, detail="Generated empty script from sources.")

    audio_file = synthesize_audio(script)
    audio_basename = audio_file.split("/")[-1]

    return BriefingResponse(
        generated_at=datetime.now(tz=timezone.utc),
        tickers=tickers,
        article_count=len(articles),
        script=script,
        citations=citations,
        audio_file=audio_file,
        audio_url=f"/audio/{audio_basename}",
    )
