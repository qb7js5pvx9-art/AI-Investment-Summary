from __future__ import annotations

from datetime import datetime, timezone

from openai import APIConnectionError, APIStatusError
from openai import AuthenticationError
from openai import BadRequestError
from openai import PermissionDeniedError
from openai import RateLimitError
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

    try:
        script, citations = generate_script(articles=articles, tickers=tickers, target_minutes=req.target_minutes)
        if not script.strip():
            raise HTTPException(status_code=500, detail="Generated empty script from sources.")
        audio_file = synthesize_audio(script)
    except RateLimitError as exc:
        # Most common setup issue in POC usage: insufficient OpenAI quota.
        detail = "OpenAI quota exceeded. Add billing/credits, then retry."
        response_payload = getattr(exc, "response", None)
        if response_payload is not None:
            try:
                code = (response_payload.json() or {}).get("error", {}).get("code")
                if code:
                    detail = f"OpenAI request failed ({code}). Check billing/limits and retry."
            except Exception:
                pass
        raise HTTPException(status_code=402, detail=detail) from exc
    except AuthenticationError as exc:
        raise HTTPException(status_code=401, detail="OpenAI authentication failed. Check OPENAI_API_KEY.") from exc
    except PermissionDeniedError as exc:
        raise HTTPException(
            status_code=403,
            detail="OpenAI request not permitted for this key/model. Check key permissions and model access.",
        ) from exc
    except BadRequestError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid OpenAI request: {exc}") from exc
    except APIConnectionError as exc:
        raise HTTPException(status_code=503, detail="Could not connect to OpenAI. Retry shortly.") from exc
    except APIStatusError as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI API error: {exc.status_code}") from exc

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
