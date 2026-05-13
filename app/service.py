from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from openai import APIConnectionError, APIStatusError
from openai import AuthenticationError
from openai import BadRequestError
from openai import PermissionDeniedError
from openai import RateLimitError
from fastapi import HTTPException

from app.briefing import generate_daily_brief, generate_script, synthesize_audio
from app.config import get_settings
from app.models import (
    BriefingRequest,
    BriefingResponse,
    DailyBriefRequest,
    DailyBriefResponse,
    PortfolioQuote,
)
from app.news import fetch_articles, fetch_category_articles
from app.quotes import fetch_market_quotes
from app.stocks import get_company_name


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


async def build_daily_brief(req: DailyBriefRequest) -> DailyBriefResponse:
    settings = get_settings()
    if not settings.openai_api_key or not settings.newsapi_key:
        raise HTTPException(status_code=500, detail="Missing OPENAI_API_KEY or NEWSAPI_KEY in environment.")

    if len(req.portfolio) != 5:
        raise HTTPException(status_code=400, detail="MVP requires exactly 5 securities in the portfolio.")

    normalized_portfolio = []
    seen: set[str] = set()
    for item in req.portfolio:
        ticker = item.ticker.strip().upper()
        if not ticker:
            raise HTTPException(status_code=400, detail="Portfolio contains an empty ticker.")
        if ticker in seen:
            raise HTTPException(status_code=400, detail=f"Duplicate ticker in portfolio: {ticker}")
        seen.add(ticker)
        normalized_portfolio.append(item.model_copy(update={"ticker": ticker}))

    tickers = [item.ticker for item in normalized_portfolio]
    security_articles_task = fetch_articles(tickers=tickers, hours_back=req.hours_back, max_articles=req.max_articles)
    category_articles_task = fetch_category_articles(
        category=req.general_category,
        hours_back=req.hours_back,
        max_articles=max(8, req.max_articles // 2),
    )
    quotes_task = fetch_market_quotes(tickers=tickers)
    security_articles, category_articles, quotes_map = await asyncio.gather(
        security_articles_task, category_articles_task, quotes_task
    )

    merged_articles = []
    seen_urls: set[str] = set()
    for article in [*security_articles, *category_articles]:
        if article.url and article.url in seen_urls:
            continue
        if article.url:
            seen_urls.add(article.url)
        merged_articles.append(article)

    if not merged_articles:
        raise HTTPException(status_code=404, detail="No relevant articles found for requested window.")

    portfolio_quotes: list[PortfolioQuote] = []
    for item in normalized_portfolio:
        quote = quotes_map.get(item.ticker, {})
        portfolio_quotes.append(
            PortfolioQuote(
                ticker=item.ticker,
                asset_type=item.asset_type,
                display_name=quote.get("display_name") or get_company_name(item.ticker) or item.ticker,
                price=quote.get("price"),
                change=quote.get("change"),
                change_percent=quote.get("change_percent"),
                currency=quote.get("currency"),
            )
        )

    try:
        payload, source_links = generate_daily_brief(
            listener_name=req.listener_name.strip(),
            occupation=req.occupation.strip(),
            investor_type=req.investor_type.strip(),
            app_use=req.app_use.strip(),
            portfolio=normalized_portfolio,
            portfolio_quotes=portfolio_quotes,
            general_category=req.general_category,
            notification_time=req.notification_time,
            articles=merged_articles,
            target_minutes=req.target_minutes,
        )
        script = payload.get("script", "").strip()
        if not script:
            raise HTTPException(status_code=500, detail="Generated empty script from sources.")
        audio_file = synthesize_audio(script)
    except RateLimitError as exc:
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
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=f"Model output parsing failed: {exc}") from exc

    audio_basename = audio_file.split("/")[-1]
    return DailyBriefResponse(
        generated_at=datetime.now(tz=timezone.utc),
        listener_name=req.listener_name.strip(),
        notification_time=req.notification_time,
        general_category=req.general_category,
        portfolio_quotes=portfolio_quotes,
        greeting=payload.get("greeting", ""),
        script=payload.get("script", ""),
        quote_of_day=payload.get("quote_of_day", ""),
        goodbye=payload.get("goodbye", ""),
        security_impact_notes=payload.get("security_impact_notes", []),
        general_news_notes=payload.get("general_news_notes", []),
        show_notes_summary=payload.get("show_notes_summary", []),
        source_links=source_links,
        audio_url=f"/audio/{audio_basename}",
        speaker_tip=(
            "Headphones or a speaker in the kitchen make it easy to listen while you get ready. "
            "If you use an alarm shortcut, open this page a moment before the brief plays."
        ),
        ios_alarm_steps=[
            "On your iPhone, open the Shortcuts app.",
            "Create an automation for the time you wake up.",
            'Add the "Open URLs" action and paste your morning-brief page link.',
            "Optionally add a short pause so the page can load, then pick your speaker.",
        ],
        usage_disclaimer=(
            "This is for your general knowledge only. It isn't financial advice, and nothing is guaranteed."
        ),
    )
