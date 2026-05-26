from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Iterable

import httpx

from app.article_cache import get_cached_articles, news_cache_key_component
from app.config import get_settings
from app.models import Article, PortfolioSecurity
from app.stocks import get_company_name
from app.article_filter import (
    FINANCE_CATEGORY_KEYS,
    article_matches_category_feed,
    article_matches_category_feed_relaxed,
    article_qualifies_as_portfolio,
    dedupe_articles,
    portfolio_ticker_for_article,
    source_reputation_score,
    tag_category_article,
    tag_portfolio_article,
)
from app.focus_areas import GENERAL_NEWS_CATEGORY_QUERIES, normalize_focus_area_key
from app.ticker_match import related_tickers_for_article

logger = logging.getLogger(__name__)

# Last NewsAPI client error (for user-facing hints when merges are empty). Not thread-safe; OK for POC.
_NEWSAPI_LAST_FAILURE: dict[str, object] = {"at": 0.0, "http_status": None, "code": None, "message": None}


def record_newsapi_http_failure(*, http_status: int, body_text: str) -> None:
    global _NEWSAPI_LAST_FAILURE
    code: str | None = None
    message: str | None = None
    try:
        parsed = json.loads(body_text)
        if isinstance(parsed, dict):
            c = parsed.get("code")
            code = c if isinstance(c, str) else (str(c) if c is not None else None)
            m = parsed.get("message")
            message = m if isinstance(m, str) else (str(m) if m is not None else None)
    except Exception:
        pass
    if not message:
        message = (body_text or "")[:280]
    _NEWSAPI_LAST_FAILURE = {
        "at": time.time(),
        "http_status": http_status,
        "code": code,
        "message": (message or "")[:400],
    }


def record_newsapi_json_status_error(*, code: object, message: object) -> None:
    global _NEWSAPI_LAST_FAILURE
    _NEWSAPI_LAST_FAILURE = {
        "at": time.time(),
        "http_status": None,
        "code": str(code) if code is not None else None,
        "message": (str(message) if message is not None else "")[:400],
    }


def get_recent_newsapi_failure(*, max_age_sec: float = 90.0) -> dict[str, object] | None:
    ts = float(_NEWSAPI_LAST_FAILURE.get("at") or 0)
    if ts == 0 or time.time() - ts > max_age_sec:
        return None
    return {
        "http_status": _NEWSAPI_LAST_FAILURE.get("http_status"),
        "code": _NEWSAPI_LAST_FAILURE.get("code"),
        "message": _NEWSAPI_LAST_FAILURE.get("message"),
    }


def reset_newsapi_failure_record() -> None:
    """Clear before each top-level brief request so empty-feed hints are not from a prior run."""
    global _NEWSAPI_LAST_FAILURE
    _NEWSAPI_LAST_FAILURE = {"at": 0.0, "http_status": None, "code": None, "message": None}


def _recent_newsapi_rate_limited() -> bool:
    err = get_recent_newsapi_failure(max_age_sec=12.0)
    if not err:
        return False
    if err.get("http_status") == 429:
        return True
    return err.get("code") == "rateLimited"


# NewsAPI /v2/everything limits (see https://newsapi.org/docs/endpoints/everything)
_NEWSAPI_Q_MAX_LEN = 450
_NEWSAPI_PAGE_SIZE_CAP = 100
_NEWSAPI_BUSINESS_TOPIC_QUERY = (
    '"stock" OR "stocks" OR "shares" OR "earnings" OR "revenue" OR "markets" OR '
    '"business" OR "economy" OR "inflation" OR "interest rates" OR "central bank"'
)
_NEWSAPI_FALLBACK_FINANCIAL_QUERY = (
    '"stock market" OR "S&P 500" OR "Nasdaq" OR "FTSE 100" OR "inflation" OR '
    '"interest rates" OR "central bank" OR "global economy"'
)
_ARTICLE_FILTER_CACHE_VERSION = "article-filter-v4"

def _format_newsapi_from(ts: datetime) -> str:
    """Oldest instant for NewsAPI `from` — date-only UTC matches documented examples and avoids time/tz edge cases."""
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc).date().isoformat()


def _newsapi_key() -> str:
    """Strip whitespace/newlines — a trailing newline in .env is a common silent 'invalid API key' cause."""
    return (get_settings().newsapi_key or "").strip()


def _parse_newsapi_published_at(value: object) -> datetime | None:
    """Parse NewsAPI publishedAt; tolerate minor format variants Pydantic might reject."""
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    normalized = s.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(normalized)
    except ValueError:
        try:
            candidate = s[:19].replace(" ", "T")
            dt = datetime.strptime(candidate, "%Y-%m-%dT%H:%M:%S")
        except ValueError:
            try:
                dt = datetime.strptime(s[:10], "%Y-%m-%d")
            except ValueError:
                return None
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
    return dt


def _join_or(parts: list[str]) -> str:
    return " OR ".join(parts)


def _with_business_topic_scope(query: str) -> str:
    scoped = f"({query}) AND ({_NEWSAPI_BUSINESS_TOPIC_QUERY})"
    if len(scoped) <= _NEWSAPI_Q_MAX_LEN:
        return scoped

    parts = query.split(" OR ")
    while len(parts) > 1:
        parts.pop()
        candidate = f"({_join_or(parts)}) AND ({_NEWSAPI_BUSINESS_TOPIC_QUERY})"
        if len(candidate) <= _NEWSAPI_Q_MAX_LEN:
            return candidate
    return scoped[:_NEWSAPI_Q_MAX_LEN]


def _build_query(tickers: Iterable[str], include_company_names: bool = True) -> str:
    # Include symbol and common prefixed form to broaden match recall.
    # NewsAPI rejects / degrades when `q` exceeds ~500 chars URL-encoded; stay under cap.
    parts: list[str] = []
    for ticker in tickers:
        clean = ticker.strip().upper()
        if not clean:
            continue
        # Bare short symbols (e.g. "PEP") match unrelated headlines like "Pep Guardiola".
        if len(clean) <= 3:
            parts.append(f'"${clean}"')
            if include_company_names:
                company_name = get_company_name(clean)
                if company_name:
                    primary = company_name.split(",")[0].strip()
                    if primary:
                        parts.append(f'"{primary}"')
        else:
            parts.append(f'"{clean}"')
            parts.append(f'"${clean}"')
            if include_company_names:
                company_name = get_company_name(clean)
                if company_name:
                    parts.append(f'"{company_name}"')
    full = _join_or(parts)
    if len(full) <= _NEWSAPI_Q_MAX_LEN:
        return full
    parts_sym: list[str] = []
    for ticker in tickers:
        clean = ticker.strip().upper()
        if not clean:
            continue
        if len(clean) <= 3:
            parts_sym.append(f'"${clean}"')
        else:
            parts_sym.append(f'"{clean}"')
            parts_sym.append(f'"${clean}"')
    compact = _join_or(parts_sym)
    while len(compact) > _NEWSAPI_Q_MAX_LEN and len(parts_sym) > 1:
        parts_sym.pop()
        compact = _join_or(parts_sym)
    if len(compact) > _NEWSAPI_Q_MAX_LEN:
        logger.warning("news_query_still_too_long_after_trim len=%s", len(compact))
        return compact[:_NEWSAPI_Q_MAX_LEN]
    logger.info("news_query_trimmed_for_length full_len=%s compact_len=%s", len(full), len(compact))
    return compact


async def _fetch_articles_once(
    *,
    tickers: list[str],
    hours_back: int,
    max_articles: int,
    include_company_names: bool,
    apply_from_date: bool = True,
) -> list[Article]:
    api_key = _newsapi_key()
    if not api_key:
        logger.error("newsapi_missing_or_blank_api_key")
        return []

    if _recent_newsapi_rate_limited():
        logger.info("newsapi_skip_attempt_watchlist_recent_rate_limit")
        return []

    settings = get_settings()
    since = datetime.now(tz=timezone.utc) - timedelta(hours=hours_back)
    q = _build_query(tickers, include_company_names=include_company_names)
    if not q.strip():
        logger.error("newsapi_empty_query tickers=%s", tickers)
        return []
    page_size = min(max(max_articles, 1), _NEWSAPI_PAGE_SIZE_CAP)
    params: dict[str, str | int] = {
        "q": q,
        "sortBy": "publishedAt",
        "language": "en",
        "pageSize": page_size,
        "apiKey": api_key,
    }
    if apply_from_date:
        params["from"] = _format_newsapi_from(since)

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            response = await client.get(settings.newsapi_base_url, params=params)
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPStatusError as exc:
            body = (exc.response.text or "")[:800]
            record_newsapi_http_failure(http_status=exc.response.status_code, body_text=exc.response.text or "")
            logger.warning(
                "newsapi_http_status watchlist status=%s apply_from=%s body=%s",
                exc.response.status_code,
                apply_from_date,
                body,
            )
            return []
        except httpx.HTTPError as exc:
            logger.warning("newsapi_http_error watchlist query_len=%s err=%s", len(q), exc)
            return []

    if payload.get("status") == "error":
        record_newsapi_json_status_error(code=payload.get("code"), message=payload.get("message"))
        logger.warning(
            "newsapi_payload_error watchlist code=%s message=%s",
            payload.get("code"),
            payload.get("message"),
        )
        return []

    raw_articles = payload.get("articles", [])
    if not raw_articles:
        logger.warning(
            "newsapi_zero_articles watchlist totalResults=%s from=%s q_len=%s apply_from=%s",
            payload.get("totalResults"),
            params.get("from"),
            len(q),
            apply_from_date,
        )
    portfolio = [
        PortfolioSecurity(ticker=t.strip().upper(), asset_type="stock")
        for t in tickers
        if t and str(t).strip()
    ]
    skipped_no_date = 0
    skipped_model = 0
    skipped_relevance = 0
    articles: list[Article] = []
    for item in raw_articles:
        title = item.get("title") or ""
        description = item.get("description") or ""
        content = item.get("content") or ""

        published_at = _parse_newsapi_published_at(item.get("publishedAt"))
        if published_at is None:
            skipped_no_date += 1
            continue

        try:
            related = related_tickers_for_article(title, "", "", tickers)
            article = Article(
                source=(item.get("source") or {}).get("name", "Unknown"),
                title=title,
                url=item.get("url", ""),
                published_at=published_at,
                description=description,
                content=content,
                related_tickers=related,
            )
        except Exception:
            skipped_model += 1
            continue
        if not article_qualifies_as_portfolio(article, portfolio):
            skipped_relevance += 1
            continue
        ticker = portfolio_ticker_for_article(article, portfolio)
        if not ticker:
            skipped_relevance += 1
            continue
        articles.append(tag_portfolio_article(article, ticker))

    if not articles and raw_articles:
        sample = raw_articles[0]
        logger.error(
            "news_watchlist_all_dropped raw=%s sample_publishedAt=%r sample_title=%r",
            len(raw_articles),
            sample.get("publishedAt"),
            (sample.get("title") or "")[:160],
        )

    before_filter = len(articles)
    articles = dedupe_articles(articles)
    logger.info(
        "news_fetch_watchlist raw=%s parsed=%s watchlist_relevant=%s dropped_irrelevant=%s "
        "skipped_no_publishedAt=%s skipped_model=%s skipped_relevance=%s hours_back=%s q_len=%s page_size=%s",
        len(raw_articles),
        before_filter,
        len(articles),
        before_filter - len(articles),
        skipped_no_date,
        skipped_model,
        skipped_relevance,
        hours_back,
        len(q),
        page_size,
    )
    return articles


async def _fetch_by_query_once(
    *,
    query: str,
    category: str,
    hours_back: int,
    max_articles: int,
    apply_from_date: bool = True,
    relaxed_filter: bool = False,
) -> list[Article]:
    api_key = _newsapi_key()
    if not api_key:
        logger.error("newsapi_missing_or_blank_api_key")
        return []

    if _recent_newsapi_rate_limited():
        logger.info("newsapi_skip_attempt_category_recent_rate_limit")
        return []

    settings = get_settings()
    category_key = normalize_focus_area_key(category)
    since = datetime.now(tz=timezone.utc) - timedelta(hours=hours_back)
    page_size = min(max(max_articles, 1), _NEWSAPI_PAGE_SIZE_CAP)
    scoped_query = _with_business_topic_scope(query) if category_key in FINANCE_CATEGORY_KEYS else query
    q = scoped_query if len(scoped_query) <= _NEWSAPI_Q_MAX_LEN else scoped_query[:_NEWSAPI_Q_MAX_LEN]
    if len(scoped_query) > _NEWSAPI_Q_MAX_LEN:
        logger.warning("news_category_query_truncated orig_len=%s scoped_len=%s", len(query), len(scoped_query))
    params: dict[str, str | int] = {
        "q": q,
        "sortBy": "publishedAt",
        "language": "en",
        "pageSize": page_size,
        "apiKey": api_key,
    }
    if apply_from_date:
        params["from"] = _format_newsapi_from(since)

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            response = await client.get(settings.newsapi_base_url, params=params)
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPStatusError as exc:
            body = (exc.response.text or "")[:800]
            record_newsapi_http_failure(http_status=exc.response.status_code, body_text=exc.response.text or "")
            logger.warning(
                "newsapi_http_status category status=%s apply_from=%s body=%s",
                exc.response.status_code,
                apply_from_date,
                body,
            )
            return []
        except httpx.HTTPError as exc:
            logger.warning("newsapi_http_error category query_len=%s err=%s", len(q), exc)
            return []

    if payload.get("status") == "error":
        record_newsapi_json_status_error(code=payload.get("code"), message=payload.get("message"))
        logger.warning(
            "newsapi_payload_error category code=%s message=%s",
            payload.get("code"),
            payload.get("message"),
        )
        return []

    raw_articles = payload.get("articles", [])
    if not raw_articles:
        logger.warning(
            "newsapi_zero_articles category totalResults=%s from=%s q_len=%s apply_from=%s",
            payload.get("totalResults"),
            params.get("from"),
            len(q),
            apply_from_date,
        )
    skipped_no_date = 0
    skipped_model = 0
    skipped_relevance = 0
    articles: list[Article] = []
    for item in raw_articles:
        published_at = _parse_newsapi_published_at(item.get("publishedAt"))
        if published_at is None:
            skipped_no_date += 1
            continue
        try:
            article = Article(
                source=(item.get("source") or {}).get("name", "Unknown"),
                title=item.get("title") or "",
                url=item.get("url", ""),
                published_at=published_at,
                description=item.get("description") or "",
                content=item.get("content") or "",
                related_tickers=[],
            )
        except Exception:
            skipped_model += 1
            continue
        matches_category = (
            article_matches_category_feed_relaxed(article, category_key)
            if relaxed_filter
            else article_matches_category_feed(article, category_key)
        )
        if not matches_category:
            skipped_relevance += 1
            continue
        articles.append(tag_category_article(article, category_key))
    if not articles and raw_articles:
        sample = raw_articles[0]
        logger.error(
            "news_category_all_dropped raw=%s sample_publishedAt=%r sample_title=%r",
            len(raw_articles),
            sample.get("publishedAt"),
            (sample.get("title") or "")[:160],
        )
    logger.info(
        "news_fetch_category raw=%s kept=%s skipped_no_publishedAt=%s skipped_model=%s skipped_relevance=%s hours_back=%s q_len=%s page_size=%s relaxed=%s",
        len(raw_articles),
        len(articles),
        skipped_no_date,
        skipped_model,
        skipped_relevance,
        hours_back,
        len(q),
        page_size,
        relaxed_filter,
    )
    return articles


async def _fetch_articles_impl(tickers: list[str], hours_back: int, max_articles: int) -> list[Article]:
    """
    Fetch watchlist-related articles. NewsAPI often returns zero rows when `from` is tight or keys are on
    restricted tiers — so we try **without** a `from` window first (plan default oldest → newest), then dated
    fallbacks with widening lookback.
    """
    seen_urls: set[str] = set()
    merged: list[Article] = []

    def _merge_batch(batch: list[Article]) -> None:
        for article in batch:
            if article.url and article.url in seen_urls:
                continue
            if article.url:
                seen_urls.add(article.url)
            merged.append(article)

    # 1) No `from` filter — highest success rate for developer keys / clock skew.
    _merge_batch(
        await _fetch_articles_once(
            tickers=tickers,
            hours_back=hours_back,
            max_articles=max_articles,
            include_company_names=True,
            apply_from_date=False,
        )
    )
    if len(merged) >= min(max_articles, 10):
        return dedupe_articles(merged)[:max_articles]
    if _recent_newsapi_rate_limited():
        return dedupe_articles(merged)[:max_articles]

    attempts = [
        {"hours_back": hours_back, "include_company_names": True, "apply_from_date": True},
        {"hours_back": max(hours_back, 36), "include_company_names": True, "apply_from_date": True},
        {"hours_back": max(hours_back, 48), "include_company_names": False, "apply_from_date": True},
        {"hours_back": max(hours_back, 168), "include_company_names": False, "apply_from_date": True},
    ]
    for attempt in attempts:
        if _recent_newsapi_rate_limited():
            break
        batch = await _fetch_articles_once(
            tickers=tickers,
            hours_back=attempt["hours_back"],
            max_articles=max_articles,
            include_company_names=attempt["include_company_names"],
            apply_from_date=attempt["apply_from_date"],
        )
        _merge_batch(batch)
        if len(merged) >= min(max_articles, 10):
            break
    return dedupe_articles(merged)[:max_articles]


async def _fetch_portfolio_articles_impl(tickers: list[str], hours_back: int, max_articles: int) -> list[Article]:
    normalized = [t.strip().upper() for t in tickers if t and str(t).strip()]
    if not normalized:
        return []

    per_stock_fetch = max(5, min(_NEWSAPI_PAGE_SIZE_CAP, min(max_articles, 12)))
    batches = await asyncio.gather(
        *[
            _fetch_articles_impl(
                tickers=[ticker],
                hours_back=hours_back,
                max_articles=per_stock_fetch,
            )
            for ticker in normalized
        ]
    )

    selected: list[Article] = []
    for ticker, batch in zip(normalized, batches, strict=False):
        ticker_articles = [
            article
            for article in dedupe_articles(batch)
            if (article.portfolio_ticker or "").strip().upper() == ticker
        ]
        ticker_articles.sort(
            key=lambda a: (source_reputation_score(a), a.published_at.timestamp()),
            reverse=True,
        )
        selected.extend(ticker_articles[:2])

    selected = dedupe_articles(selected)
    selected.sort(
        key=lambda a: (source_reputation_score(a), a.published_at.timestamp()),
        reverse=True,
    )
    return selected[:max_articles]


async def fetch_articles(
    tickers: list[str], hours_back: int, max_articles: int, *, bypass_cache: bool = False
) -> list[Article]:
    """Public entry: optional TTL cache + per-key lock (avoids duplicate NewsAPI work)."""
    settings = get_settings()
    ttl = float(settings.news_article_cache_ttl_seconds)
    kid = news_cache_key_component(_newsapi_key())
    normalized = sorted({t.strip().upper() for t in tickers if t and str(t).strip()})
    key = f"w:{_ARTICLE_FILTER_CACHE_VERSION}:{kid}:{hours_back}:{max_articles}:{'+'.join(normalized)}"
    return await get_cached_articles(
        key=key,
        ttl_sec=ttl,
        bypass=bypass_cache,
        factory=lambda: _fetch_portfolio_articles_impl(tickers, hours_back, max_articles),
    )


async def _fetch_category_articles_impl(category: str, hours_back: int, max_articles: int) -> list[Article]:
    key = normalize_focus_area_key(category)
    query = GENERAL_NEWS_CATEGORY_QUERIES.get(key, "macro economy")
    merged: list[Article] = []
    seen_urls: set[str] = set()

    def _merge_batch(batch: list[Article]) -> None:
        for article in batch:
            if article.url and article.url in seen_urls:
                continue
            if article.url:
                seen_urls.add(article.url)
            merged.append(article)

    def _return_filtered(*, relaxed: bool = False) -> list[Article]:
        matcher = article_matches_category_feed_relaxed if relaxed else article_matches_category_feed
        filtered = dedupe_articles([a for a in merged if matcher(a, key)])
        filtered.sort(
            key=lambda a: (source_reputation_score(a), a.published_at.timestamp()),
            reverse=True,
        )
        if len(filtered) < len(merged):
            logger.info(
                "news_category_relevance_filter kept=%s dropped=%s category=%s",
                len(filtered),
                len(merged) - len(filtered),
                key,
            )
        return filtered[:max_articles]

    _merge_batch(
        await _fetch_by_query_once(
            query=query,
            category=key,
            hours_back=hours_back,
            max_articles=max_articles,
            apply_from_date=False,
        )
    )
    if len(merged) >= min(max_articles, 8):
        first_filtered = _return_filtered()
        if len(first_filtered) >= min(5, max_articles) or _recent_newsapi_rate_limited():
            return first_filtered
    if _recent_newsapi_rate_limited():
        return _return_filtered()

    attempts = [hours_back, max(hours_back, 36), max(hours_back, 168)]
    for attempt_hours in attempts:
        if _recent_newsapi_rate_limited():
            break
        batch = await _fetch_by_query_once(
            query=query,
            category=key,
            hours_back=attempt_hours,
            max_articles=max_articles,
            apply_from_date=True,
        )
        _merge_batch(batch)
        if len(merged) >= min(max_articles, 8):
            break
    filtered = _return_filtered()
    if len(filtered) >= min(5, max_articles) or _recent_newsapi_rate_limited():
        return filtered

    logger.info(
        "news_category_relaxed_filter_retry category=%s strict_kept=%s target=%s",
        key,
        len(filtered),
        min(5, max_articles),
    )
    relaxed_batch = await _fetch_by_query_once(
        query=query,
        category=key,
        hours_back=max(hours_back, 48),
        max_articles=max(max_articles, 30),
        apply_from_date=False,
        relaxed_filter=True,
    )
    _merge_batch(relaxed_batch)
    relaxed_filtered = _return_filtered(relaxed=True)
    return relaxed_filtered if len(relaxed_filtered) > len(filtered) else filtered


async def fetch_multi_category_articles(
    categories: list[str],
    hours_back: int,
    max_articles_per_category: int,
    *,
    bypass_cache: bool = False,
) -> list[Article]:
    """Fetch category feeds for each focus area; dedupe by URL."""
    if not categories:
        return []
    batches = await asyncio.gather(
        *[
            fetch_category_articles(
                category=cat,
                hours_back=hours_back,
                max_articles=max_articles_per_category,
                bypass_cache=bypass_cache,
            )
            for cat in categories
        ]
    )
    merged: list[Article] = []
    seen_urls: set[str] = set()
    for batch in batches:
        for article in batch:
            url = (article.url or "").strip()
            if url and url in seen_urls:
                continue
            if url:
                seen_urls.add(url)
            merged.append(article)
    return dedupe_articles(merged)


async def fetch_category_articles(
    category: str, hours_back: int, max_articles: int, *, bypass_cache: bool = False
) -> list[Article]:
    settings = get_settings()
    ttl = float(settings.news_article_cache_ttl_seconds)
    kid = news_cache_key_component(_newsapi_key())
    cat_key = category.strip().lower()
    key = f"c:{_ARTICLE_FILTER_CACHE_VERSION}:{kid}:{hours_back}:{max_articles}:{cat_key}"
    return await get_cached_articles(
        key=key,
        ttl_sec=ttl,
        bypass=bypass_cache,
        factory=lambda: _fetch_category_articles_impl(category, hours_back, max_articles),
    )
