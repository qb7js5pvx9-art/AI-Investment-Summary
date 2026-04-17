from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Iterable

import httpx

from app.config import get_settings
from app.models import Article


def _build_query(tickers: Iterable[str]) -> str:
    # Include symbol and common prefixed form to broaden match recall.
    parts = []
    for ticker in tickers:
        clean = ticker.strip().upper()
        if not clean:
            continue
        parts.append(f'"{clean}"')
        parts.append(f'"${clean}"')
    return " OR ".join(parts)


async def fetch_articles(tickers: list[str], hours_back: int, max_articles: int) -> list[Article]:
    settings = get_settings()
    since = datetime.now(tz=timezone.utc) - timedelta(hours=hours_back)
    params = {
        "q": _build_query(tickers),
        "sortBy": "publishedAt",
        "language": "en",
        "pageSize": max_articles,
        "from": since.isoformat(),
        "apiKey": settings.newsapi_key,
    }

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(settings.newsapi_base_url, params=params)
        response.raise_for_status()
        payload = response.json()

    raw_articles = payload.get("articles", [])
    articles: list[Article] = []
    for item in raw_articles:
        title = item.get("title") or ""
        description = item.get("description") or ""
        content = item.get("content") or ""
        full_text = " ".join([title, description, content]).upper()
        related = [t for t in tickers if t.upper() in full_text or f"${t.upper()}" in full_text]

        published_at = item.get("publishedAt")
        if not published_at:
            continue
        # NewsAPI uses ISO8601 with Z. Convert for pydantic datetime parse.
        published_at = published_at.replace("Z", "+00:00")

        try:
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
            continue
        articles.append(article)

    return articles
