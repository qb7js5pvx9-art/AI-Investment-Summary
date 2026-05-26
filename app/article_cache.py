"""Short-lived cache + per-key serialization for NewsAPI-backed article lists."""

from __future__ import annotations

import asyncio
import hashlib
import time
from collections.abc import Awaitable, Callable

from app.models import Article

_cache: dict[str, tuple[float, list[Article]]] = {}
_key_locks: dict[str, asyncio.Lock] = {}
_locks_init = asyncio.Lock()


def _now() -> float:
    return time.monotonic()


def _clone(articles: list[Article]) -> list[Article]:
    return [a.model_copy(deep=True) for a in articles]


def _cache_get(key: str) -> list[Article] | None:
    row = _cache.get(key)
    if not row:
        return None
    expires_at, articles = row
    if _now() >= expires_at:
        del _cache[key]
        return None
    return articles


async def _key_lock(key: str) -> asyncio.Lock:
    async with _locks_init:
        lock = _key_locks.get(key)
        if lock is None:
            lock = asyncio.Lock()
            _key_locks[key] = lock
        return lock


async def get_cached_articles(
    *,
    key: str,
    ttl_sec: float,
    bypass: bool,
    factory: Callable[[], Awaitable[list[Article]]],
) -> list[Article]:
    """
    Return a deep copy of articles for this cache key.

    - ttl_sec <= 0: no cache; always runs factory.
    - bypass True: drops any stored entry for key, runs factory once, stores non-empty result.
    - bypass False: returns a valid cache hit when present; otherwise runs factory once (serialized per key).
    """
    if ttl_sec <= 0:
        return _clone(await factory())

    lock = await _key_lock(key)
    async with lock:
        if bypass:
            _cache.pop(key, None)
            articles = await factory()
            if articles:
                _cache[key] = (_now() + ttl_sec, articles)
            return _clone(articles)

        hit = _cache_get(key)
        if hit is not None:
            return _clone(hit)

        articles = await factory()
        if articles:
            _cache[key] = (_now() + ttl_sec, articles)
        return _clone(articles)


def news_cache_key_component(api_key: str) -> str:
    """Short stable id so cache entries never mix across different NewsAPI keys."""
    if not api_key:
        return "0"
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()[:16]
