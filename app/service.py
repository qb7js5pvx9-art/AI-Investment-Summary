from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable
from datetime import datetime, timezone
from pathlib import Path
from typing import TypeVar
from urllib.parse import urlparse

from openai import APIConnectionError, APIStatusError
from openai import AuthenticationError
from openai import BadRequestError
from openai import PermissionDeniedError
from openai import RateLimitError
from fastapi import HTTPException

from app.article_filter import MAX_CATEGORY_ARTICLES, select_articles_for_brief
from app.briefing import generate_daily_brief, generate_script, synthesize_audio
from app.config import get_settings
from app.focus_areas import focus_area_label, normalize_focus_area_key
from app.models import (
    Article,
    BriefingRequest,
    BriefingResponse,
    DailyBriefRequest,
    DailyBriefResponse,
    PortfolioQuote,
    SourceLink,
)
from app.news import (
    fetch_articles,
    fetch_category_articles,
    fetch_multi_category_articles,
    get_recent_newsapi_failure,
    reset_newsapi_failure_record,
)
from app.quotes import get_all_quotes
from app.stocks import get_company_name

logger = logging.getLogger(__name__)
T = TypeVar("T")

USER_BRIEF_ERROR_MESSAGE = "Something went wrong, please try again"


def _min_script_words(target_minutes: int) -> int:
    return max(500, int(target_minutes * 130))


def _raise_user_brief_error(technical: str, *, status_code: int = 502) -> None:
    logger.error("daily_brief_failed technical=%s", technical)
    raise HTTPException(status_code=status_code, detail=USER_BRIEF_ERROR_MESSAGE)


def _missing_required_keys(settings: object) -> list[str]:
    required = {
        "OPENAI_API_KEY": getattr(settings, "openai_api_key", ""),
        "NEWSAPI_KEY": getattr(settings, "newsapi_key", ""),
    }
    return [name for name, value in required.items() if not str(value or "").strip()]


def _newsapi_empty_feed_hint() -> str:
    err = get_recent_newsapi_failure(max_age_sec=90.0)
    if not err:
        return ""
    hs = err.get("http_status")
    code = err.get("code")
    msg = (err.get("message") or "")[:220]
    if hs == 429 or code == "rateLimited":
        return (
            "NewsAPI returned HTTP 429 (rate limited). Free-developer keys allow about 100 requests per 24 hours; "
            "each uncached article pull can still issue several NewsAPI calls, but the server reuses recent results "
            "for a few minutes to cut duplicates — wait for the quota window to reset, upgrade your NewsAPI plan, "
            "or use Refresh only when you need a forced update."
        )
    if hs in (401, 403):
        return (
            f"NewsAPI rejected the request (HTTP {hs}). Confirm NEWSAPI_KEY in .env (no spaces) and restart the server."
        )
    if code or msg:
        piece = f"{code}: {msg}" if code else msg
        return f"NewsAPI error — {piece.strip()}"
    return ""


def _log_stage_duration(stage: str, started: float) -> None:
    elapsed_ms = (time.perf_counter() - started) * 1000
    logger.info("daily_brief_timing stage=%s duration_ms=%.1f", stage, elapsed_ms)


async def _timed_stage(stage: str, awaitable: Awaitable[T]) -> T:
    started = time.perf_counter()
    try:
        return await awaitable
    finally:
        _log_stage_duration(stage, started)


async def build_briefing(req: BriefingRequest, *, refresh_news: bool = False) -> BriefingResponse:
    settings = get_settings()
    missing_keys = _missing_required_keys(settings)
    if missing_keys:
        logger.error("briefing_missing_required_environment keys=%s", ",".join(missing_keys))
        raise HTTPException(
            status_code=500,
            detail=f"Missing required environment variable(s): {', '.join(missing_keys)}.",
        )

    tickers = [t.strip().upper() for t in req.tickers if t.strip()]
    if not tickers:
        raise HTTPException(status_code=400, detail="At least one ticker is required.")

    reset_newsapi_failure_record()
    articles = await fetch_articles(
        tickers=tickers,
        hours_back=req.hours_back,
        max_articles=req.max_articles,
        bypass_cache=refresh_news,
    )
    if not articles:
        hint = _newsapi_empty_feed_hint()
        tail = hint or "Check NEWSAPI_KEY, plan limits, and server logs for newsapi_* lines."
        raise HTTPException(status_code=404, detail=f"No relevant articles found for requested window. {tail}")

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

    audio_basename = Path(audio_file).name

    return BriefingResponse(
        generated_at=datetime.now(tz=timezone.utc),
        tickers=tickers,
        article_count=len(articles),
        script=script,
        citations=citations,
        audio_file=audio_file,
        audio_url=f"/audio/{audio_basename}",
    )


def _resolve_focus_categories(req: DailyBriefRequest) -> list[str]:
    if req.focus_categories:
        return list(req.focus_categories)
    return [req.general_category]


_CATEGORY_TAB_LABELS: dict[str, str] = {
    "macro": "Macro",
    "stock-markets": "Markets",
    "central-banks-rates": "Rates",
    "commodities-energy": "Energy",
    "technology-ai": "Tech",
    "real-estate-housing": "Property",
    "crypto-digital-assets": "Crypto",
    "geopolitics-trade": "Geopolitics",
    "uk-politics-economy": "UK Politics",
    "us-politics-economy": "US Politics",
    "sport": "Sport",
    "manufacturing-industry": "Industry",
    "consumer-retail": "Consumer",
    "healthcare-pharma": "Healthcare",
}


def _category_tab_label(category: str) -> str:
    key = normalize_focus_area_key(category)
    return _CATEGORY_TAB_LABELS.get(key, focus_area_label(key))


def _source_domain(url: str) -> str:
    try:
        host = urlparse(url or "").netloc.lower()
        return host[4:] if host.startswith("www.") else host
    except Exception:
        return ""


def _article_word_count(article: Article) -> int | None:
    text = " ".join(
        part
        for part in (article.title, article.description, article.content)
        if part and str(part).strip()
    )
    if not text.strip():
        return None
    return len(text.split())


def _article_source_link(article: Article, source_id: str, *, is_top_story: bool = False) -> SourceLink:
    category = "portfolio" if article.article_kind == "portfolio" else "macro"
    return SourceLink(
        source_id=source_id,
        title=article.title,
        source=article.source,
        url=article.url,
        published_at=article.published_at,
        source_domain=_source_domain(article.url),
        word_count=_article_word_count(article),
        category=category,
        relevance_tag=article.portfolio_ticker if article.article_kind == "portfolio" else "Macro",
        focus_category=focus_area_label(article.focus_category) if article.focus_category else "",
        is_top_story=is_top_story,
        headline_normalized=article.title,
    )


def _article_pool_links(articles: list[Article], *, prefix: str) -> list[SourceLink]:
    return [
        _article_source_link(article, f"{prefix}{idx}", is_top_story=idx == 1)
        for idx, article in enumerate(articles, start=1)
        if (article.url or "").strip()
    ]


async def build_daily_brief(req: DailyBriefRequest, *, refresh_news: bool = False) -> DailyBriefResponse:
    settings = get_settings()
    missing_keys = _missing_required_keys(settings)
    if missing_keys:
        logger.error("daily_brief_missing_required_environment keys=%s", ",".join(missing_keys))
        raise HTTPException(
            status_code=500,
            detail=f"Missing required environment variable(s): {', '.join(missing_keys)}.",
        )

    if len(req.portfolio) < 1 or len(req.portfolio) > 5:
        raise HTTPException(
            status_code=400,
            detail="Watchlist must include between 1 and 5 securities.",
        )

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
    focus_categories = _resolve_focus_categories(req)
    selection_focus_categories = list(focus_categories)
    flow_start = time.perf_counter()
    reset_newsapi_failure_record()
    security_articles, category_articles, quotes_map = await asyncio.gather(
        _timed_stage(
            "fetch_security_articles",
            fetch_articles(
                tickers=tickers,
                hours_back=req.hours_back,
                max_articles=req.max_articles,
                bypass_cache=refresh_news,
            ),
        ),
        _timed_stage(
            "fetch_category_articles",
            fetch_multi_category_articles(
                categories=focus_categories,
                hours_back=req.hours_back,
                max_articles_per_category=max(30, MAX_CATEGORY_ARTICLES * 10),
                bypass_cache=refresh_news,
            ),
        ),
        _timed_stage("fetch_market_quotes", get_all_quotes(tickers=tickers)),
    )
    _log_stage_duration("fetch_articles_and_quotes_gather_wall", flow_start)

    if not category_articles and focus_categories:
        logger.warning(
            "daily_brief_category_feed_empty retrying primary=%s",
            focus_categories[0],
        )
        category_articles = await fetch_category_articles(
            category=focus_categories[0],
            hours_back=req.hours_back,
            max_articles=max(30, MAX_CATEGORY_ARTICLES * 10),
            bypass_cache=refresh_news,
        )

    portfolio_article_pool = [
        article
        for article in security_articles
        if article.article_kind == "portfolio" and (article.url or "").strip()
    ]
    portfolio_urls = {(article.url or "").strip() for article in portfolio_article_pool if (article.url or "").strip()}
    category_article_pool = [
        article
        for article in category_articles
        if article.article_kind == "category"
        and (article.url or "").strip()
        and (article.url or "").strip() not in portfolio_urls
    ]
    category_name = _category_tab_label(selection_focus_categories[0] if selection_focus_categories else req.general_category)

    merged_articles = []
    seen_urls: set[str] = set()
    for article in [*security_articles, *category_articles]:
        if article.url and article.url in seen_urls:
            continue
        if article.url:
            seen_urls.add(article.url)
        merged_articles.append(article)

    merged_before_filter = len(merged_articles)
    merged_articles = select_articles_for_brief(
        merged_articles,
        normalized_portfolio,
        selection_focus_categories,
        hours_back=req.hours_back,
    )

    logger.info(
        "daily_brief_article_pipeline security=%s category=%s merged_raw=%s merged_relevant=%s dropped=%s "
        "hours_back=%s max_articles=%s requested_focus_categories=%s selection_focus_categories=%s tickers=%s",
        len(security_articles),
        len(category_articles),
        merged_before_filter,
        len(merged_articles),
        merged_before_filter - len(merged_articles),
        req.hours_back,
        req.max_articles,
        focus_categories,
        selection_focus_categories,
        tickers,
    )

    if not merged_articles:
        logger.error(
            "daily_brief_no_articles_merged security=%s category=%s — check NEWSAPI_KEY, plan limits, rate limits, and newsapi_* logs",
            len(security_articles),
            len(category_articles),
        )
        hint = _newsapi_empty_feed_hint()
        tail = hint or (
            "Confirm NEWSAPI_KEY in .env (no spaces), restart the server, and check logs for newsapi_http_status "
            "or newsapi_payload_error."
        )
        raise HTTPException(
            status_code=404,
            detail=(
                f"No relevant articles found (watchlist_feed={len(security_articles)}, "
                f"category_feed={len(category_articles)}). {tail}"
            ),
        )

    article_count = len(merged_articles)

    portfolio_quotes: list[PortfolioQuote] = []
    # One row per MVP holding; feeds generate_daily_brief() for spoken price/move lines in the script.
    for item in normalized_portfolio:
        quote = quotes_map.get(item.ticker, {})
        portfolio_quotes.append(
            PortfolioQuote(
                ticker=item.ticker,
                asset_type=item.asset_type,
                display_name=quote.get("display_name") or get_company_name(item.ticker) or item.ticker,
                price=quote.get("price"),
                change=quote.get("change"),
                change_percent=quote.get("change_pct"),
                currency=quote.get("currency"),
                previous_close=quote.get("prev_close"),
            )
        )

    min_words = _min_script_words(req.target_minutes)
    max_script_attempts = 2
    payload: dict
    source_links: list
    script = ""

    try:
        for attempt in range(1, max_script_attempts + 1):
            script_start = time.perf_counter()
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
                focus_categories=selection_focus_categories,
                local_time_of_day=req.local_time_of_day,
                script_length_retry=attempt > 1,
            )
            _log_stage_duration("generate_daily_brief_script", script_start)
            script = payload.get("script", "").strip()
            if not script:
                technical = f"empty script attempt={attempt}/{max_script_attempts}"
                logger.warning("daily_brief_empty_script %s", technical)
                if attempt < max_script_attempts:
                    continue
                _raise_user_brief_error(technical, status_code=500)
            script_chars = len(script)
            script_words = len(script.split())
            logger.info(
                "daily_brief_before_tts attempt=%s script_chars=%s script_words=%s min_words=%s "
                "articles_in_prompt=%s target_minutes=%s",
                attempt,
                script_chars,
                script_words,
                min_words,
                article_count,
                req.target_minutes,
            )
            if script_words >= min_words:
                break
            technical = (
                f"script too short attempt={attempt}/{max_script_attempts} "
                f"script_words={script_words} min_words={min_words} script_chars={script_chars} "
                f"preview={script[:280]!r}"
            )
            if attempt < max_script_attempts:
                logger.warning("daily_brief_script_too_short retrying %s", technical)
                continue
            _raise_user_brief_error(technical)

        audio_start = time.perf_counter()
        audio_file = synthesize_audio(script)
        _log_stage_duration("generate_audio", audio_start)
    except HTTPException:
        raise
    except RateLimitError as exc:
        technical = f"OpenAI rate limit: {exc}"
        response_payload = getattr(exc, "response", None)
        if response_payload is not None:
            try:
                code = (response_payload.json() or {}).get("error", {}).get("code")
                if code:
                    technical = f"OpenAI rate limit code={code}: {exc}"
            except Exception:
                pass
        _raise_user_brief_error(technical, status_code=402)
    except AuthenticationError as exc:
        _raise_user_brief_error(f"OpenAI authentication failed: {exc}", status_code=401)
    except PermissionDeniedError as exc:
        _raise_user_brief_error(f"OpenAI permission denied: {exc}", status_code=403)
    except BadRequestError as exc:
        _raise_user_brief_error(f"OpenAI bad request: {exc}", status_code=400)
    except APIConnectionError as exc:
        _raise_user_brief_error(f"OpenAI connection error: {exc}", status_code=503)
    except APIStatusError as exc:
        _raise_user_brief_error(f"OpenAI API status {exc.status_code}: {exc}", status_code=502)
    except ValueError as exc:
        _raise_user_brief_error(f"Model output parsing failed: {exc}", status_code=502)
    except Exception as exc:
        logger.exception("daily_brief_unexpected_exception")
        _raise_user_brief_error(f"unexpected error: {type(exc).__name__}: {exc}", status_code=500)

    audio_basename = Path(audio_file).name
    _log_stage_duration("build_daily_brief_total", flow_start)
    return DailyBriefResponse(
        generated_at=datetime.now(tz=timezone.utc),
        listener_name=req.listener_name.strip(),
        notification_time=req.notification_time,
        general_category=req.general_category,
        portfolio_quotes=portfolio_quotes,
        quotes=quotes_map,
        greeting=payload.get("greeting", ""),
        script=payload.get("script", ""),
        quote_of_day=payload.get("quote_of_day", ""),
        goodbye=payload.get("goodbye", ""),
        security_impact_notes=payload.get("security_impact_notes", []),
        general_news_notes=payload.get("general_news_notes", []),
        show_notes_summary=payload.get("show_notes_summary", []),
        source_links=source_links,
        portfolio_articles=_article_pool_links(portfolio_article_pool, prefix="P"),
        category_articles=_article_pool_links(category_article_pool, prefix="C"),
        category_name=category_name,
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
        usage_disclaimer="",
        episode_title=str(payload.get("episode_title") or "").strip(),
        portfolio_insights=payload.get("portfolio_insights", []),
    )
