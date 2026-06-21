"""Strict watchlist ticker detection — avoids false positives (e.g. Pep Guardiola vs PEP)."""

from __future__ import annotations

import re

from app.stocks import get_company_name

# Short symbols are often English words; require exact-case token or financial forms.
_SHORT_TICKER_MAX_LEN = 3

# Tickers that double as common English words — case-sensitive word match only (avoids "coin", "on", etc.).
_TICKER_AS_ENGLISH_WORD = frozenset(
    {
        "ALL",
        "CAN",
        "COIN",
        "GAP",
        "IT",
        "KEY",
        "LOW",
        "NET",
        "NOW",
        "ON",
        "OPEN",
        "REAL",
        "RUN",
        "SUN",
        "WISH",
    }
)


_COMPANY_SUFFIX_RE = re.compile(
    r"(?:,\s*)?\b("
    r"inc\.?|incorporated|corp\.?|corporation|company|co\.?|plc|ltd\.?|limited|"
    r"holdings?|group|class\s+[a-z]"
    r")\b\.?",
    re.IGNORECASE,
)


def _standalone_pattern(term: str) -> str:
    # Avoid partial-word hits such as META in "metadata" or Block in "blockchain".
    return rf"(?<![A-Za-z0-9]){re.escape(term)}(?![A-Za-z0-9])"


def _company_terms(ticker: str) -> list[str]:
    clean = (ticker or "").strip().upper()
    if not clean:
        return []
    name = get_company_name(clean)
    if not name:
        return []

    primary = name.split(",")[0].strip()
    compact = _COMPANY_SUFFIX_RE.sub("", primary).strip(" ,.-")
    if compact.lower().startswith("the "):
        compact = compact[4:].strip()

    terms: list[str] = []
    for term in (compact, primary):
        if len(term) >= 4 and term not in terms:
            terms.append(term)

    brand = compact.split()[0] if compact else ""
    if len(brand) >= 4 and brand not in terms:
        terms.append(brand)
    return terms


def _company_primary_terms(ticker: str) -> list[str]:
    clean = (ticker or "").strip().upper()
    if not clean:
        return []
    name = get_company_name(clean)
    if not name:
        return []

    primary = name.split(",")[0].strip()
    compact = _COMPANY_SUFFIX_RE.sub("", primary).strip(" ,.-")
    if compact.lower().startswith("the "):
        compact = compact[4:].strip()

    terms: list[str] = []
    for term in (compact, primary):
        if len(term) >= 4 and term not in terms:
            terms.append(term)
    return terms


def ticker_mentioned_in_text(text: str, ticker: str) -> bool:
    """True when *ticker* appears as a financial reference, not a substring/word variant."""
    sym = (ticker or "").strip()
    if not sym or not text:
        return False

    if re.search(rf"\${_standalone_pattern(sym)}", text, re.IGNORECASE):
        return True
    if re.search(rf"\({_standalone_pattern(sym)}\)", text, re.IGNORECASE):
        return True

    if len(sym) <= _SHORT_TICKER_MAX_LEN:
        return bool(re.search(_standalone_pattern(sym), text))

    flags = 0 if sym in _TICKER_AS_ENGLISH_WORD else re.IGNORECASE
    match = re.search(_standalone_pattern(sym), text, flags)
    if not match:
        return False
    if sym in _TICKER_AS_ENGLISH_WORD:
        return match.group(0) == sym
    return True


def company_name_mentioned_in_text(text: str, ticker: str) -> bool:
    """Match primary company name (e.g. PepsiCo for PEP) without bare short-symbol noise."""
    if not text:
        return False
    return any(re.search(_standalone_pattern(term), text, re.IGNORECASE) for term in _company_terms(ticker))


def company_primary_name_mentioned_in_text(text: str, ticker: str) -> bool:
    """Match the full/primary company name; excludes loose single-word brand matches."""
    if not text:
        return False
    return any(re.search(_standalone_pattern(term), text, re.IGNORECASE) for term in _company_primary_terms(ticker))


def company_brand_mentioned_in_text(text: str, ticker: str) -> bool:
    """Match distinctive brand token (e.g. Apple, Tesla) — not used for short tickers like PEP."""
    if not text:
        return False
    terms = _company_terms(ticker)
    if not terms:
        return False
    brand = terms[-1]
    if len(brand) < 4:
        return False
    return bool(re.search(_standalone_pattern(brand), text, re.IGNORECASE))


def headline_mentions_ticker_or_company(headline: str, ticker: str) -> bool:
    """Only match explicit standalone ticker/company references in the headline."""
    if not headline or not (ticker or "").strip():
        return False
    if ticker_mentioned_in_text(headline, ticker):
        return True
    if company_name_mentioned_in_text(headline, ticker):
        return True
    return company_brand_mentioned_in_text(headline, ticker)


def headline_has_direct_ticker_or_company_name(headline: str, ticker: str) -> bool:
    """Strict headline match for portfolio linkage: ticker or full company name only."""
    if not headline or not (ticker or "").strip():
        return False
    if ticker_mentioned_in_text(headline, ticker):
        return True
    return company_primary_name_mentioned_in_text(headline, ticker)


def article_text_mentions_ticker(article_title: str, description: str, content: str, ticker: str) -> bool:
    return headline_has_direct_ticker_or_company_name(article_title, ticker)


def related_tickers_for_article(
    title: str,
    description: str,
    content: str,
    tickers: list[str],
) -> list[str]:
    matched: list[str] = []
    for t in tickers:
        sym = t.strip().upper()
        if not sym:
            continue
        if headline_has_direct_ticker_or_company_name(title, sym):
            matched.append(sym)
    return matched
