"""Article selection for daily briefs — portfolio financial news and focus-area category feeds."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher

from app.focus_areas import CATEGORY_SIGNALS, focus_area_label, normalize_focus_area_key
from app.models import Article, PortfolioSecurity
from app.ticker_match import headline_mentions_ticker_or_company

logger = logging.getLogger(__name__)

MAX_PORTFOLIO_ARTICLES = 10
MAX_CATEGORY_ARTICLES = 3
CATEGORY_MAX_AGE_HOURS = 48

FINANCE_CATEGORY_KEYS: frozenset[str] = frozenset(
    {
        "macro",
        "stock-markets",
        "central-banks-rates",
        "commodities-energy",
        "crypto-digital-assets",
    }
)

# Hard excludes — crime, lifestyle, inspiration feeds, etc.
_NOISE_RE = re.compile(
    r"\b("
    r"manslaughter|murder|murdered|homicide|jailed over|sentenced to|prison sentence|"
    r"crime scene|police arrest|court hears|guilty plea|"
    r"daily inspiration|inspiration for today|horoscope|celebrity gossip|"
    r"recipe|dating tips|weight loss|zodiac"
    r")\b",
    re.IGNORECASE,
)

_NON_ENGLISH_RE = re.compile(
    r"\b("
    r"attrae|stimola|dialoghi|risate|sogni|perché|perche|della|degli|delle|"
    r"nell'|questa|questo|essere|anche|molto|tutto|come|dove|quando|perché"
    r")\b",
    re.IGNORECASE,
)

_LIFESTYLE_RE = re.compile(
    r"\b("
    r"product review|hands[- ]on|unboxing|gift guide|best \d+|top \d+ picks|"
    r"how to choose|buying guide|vs\.|versus review|review:|recipe|"
    r"celebrity|red carpet|fashion week"
    r")\b",
    re.IGNORECASE,
)

_PRODUCT_DEAL_RE = re.compile(
    r"\b("
    r"deal alert|daily deals|best deals|tech deals|phone deals|laptop deals|"
    r"(?:iphone|ipad|macbook|apple watch|watch|phone|laptop|tablet|tv|app|game|software|headphones?|camera)\s+deals?|"
    r"deals?\s+(?:drop|under|for)|discount|coupon|promo code|app sale|sale price|"
    r"buying guide|gift guide|best buy|amazon sale|prime day|black friday|"
    r"cyber monday|save \$|save \d+%|under \$|drops? to \$|now \$|"
    r"product review|review:|hands[- ]on|unboxing|where to buy|preorder|pre-order"
    r")\b",
    re.IGNORECASE,
)

_FINANCIAL_CONTENT_RE = re.compile(
    r"\b("
    r"stocks?|shares?|equities|markets?|nasdaq|s&p 500|dow|ftse|index|indices|"
    r"earnings|revenue|profit|loss|sales|guidance|forecast|outlook|dividend|ipo|listing|"
    r"valuation|market cap|analyst|upgrade|downgrade|price target|merger|acquisition|"
    r"takeover|stake|investment|funding|deal value|"
    r"business|corporate|company|companies|sector|industry|"
    r"fiscal|budget|tax|tariff|sanctions|trade|"
    r"inflation|interest rates?|fed|federal reserve|bank of england|ecb|"
    r"economy|economic|gdp|jobs report|employment|unemployment|wages?|"
    r"bond yields?|treasur(?:y|ies)|currenc(?:y|ies)|dollar|sterling|euro|"
    r"oil prices?|gas prices?|brent|crude|opec|commodit(?:y|ies)|gold|copper|"
    r"crypto|bitcoin|ethereum|stablecoin|digital assets?"
    r")\b",
    re.IGNORECASE,
)

_PORTFOLIO_BUSINESS_RE = re.compile(
    r"\b("
    r"earnings|revenue|sales|profit|loss|dividend|guidance|forecast|"
    r"ceo|cfo|executive|leadership|chairman|director|resign|appoint|"
    r"product launch|regulatory|regulation|approval|fda|sec |"
    r"acquisition|acquire|merger|takeover|deal|"
    r"lawsuit|legal|court|settlement|"
    r"analyst|upgrade|downgrade|rating|price target|"
    r"stock|shares|share price|market cap|trading|rally|sell[- ]off|"
    r"ipo|listing|outlook|results|quarter|q1|q2|q3|q4"
    r")\b",
    re.IGNORECASE,
)

_AMBIGUOUS_COMPANY_TICKERS: frozenset[str] = frozenset(
    {
        "ALL",
        "AMZN",
        "CAN",
        "GAP",
        "IT",
        "KEY",
        "LOW",
        "NOW",
        "ON",
        "OPEN",
        "REAL",
        "RUN",
        "SQ",
        "SUN",
        "V",
    }
)

_COMPANY_PRIMARY_CONTEXT_RE = re.compile(
    r"\b("
    r"announces?|names?|appoints?|hires?|launches?|unveils?|expands?|reports?|"
    r"earnings|revenue|profit|sales|shares?|stock|ceo|cfo|executive|chief|"
    r"lawsuit|sues?|settlement|court|regulator|approval|probe|antitrust|"
    r"partnership|partners?|contract|deal|acquisition|merger|product|platform|"
    r"payments?|card|customers?|workers?|union"
    r")\b",
    re.IGNORECASE,
)

_SAFETY_VERSION_RE = re.compile(r"\bv\d+\.|\b\d+\.\d{2,}\b|\.\d+\b", re.IGNORECASE)
_SAFETY_COMMERCE_RE = re.compile(
    r"\b(for sale|at no reserve|auction|classified)\b",
    re.IGNORECASE,
)

_CREDIBLE_SOURCE_DOMAINS: frozenset[str] = frozenset(
    {
        "abcnews.go.com",
        "aljazeera.com",
        "apnews.com",
        "arstechnica.com",
        "axios.com",
        "bbc.co.uk",
        "bbc.com",
        "bloomberg.com",
        "businessinsider.com",
        "cbsnews.com",
        "cnbc.com",
        "cnn.com",
        "coindesk.com",
        "economist.com",
        "espn.com",
        "finance.yahoo.com",
        "forbes.com",
        "fortune.com",
        "ft.com",
        "investing.com",
        "investors.com",
        "marketwatch.com",
        "nbcnews.com",
        "npr.org",
        "nytimes.com",
        "politico.com",
        "reuters.com",
        "skysports.com",
        "sportsbusinessjournal.com",
        "statnews.com",
        "techcrunch.com",
        "theathletic.com",
        "theguardian.com",
        "thehill.com",
        "theregister.com",
        "time.com",
        "washingtonpost.com",
        "wired.com",
        "wsj.com",
        "zdnet.com",
        "espncricinfo.com",
        "dw.com",
        "france24.com",
        "independent.co.uk",
        "telegraph.co.uk",
        "thetimes.co.uk",
        "reuters.com",
        "ft.com",
        "bloomberg.com",
        "cnbc.com",
        "wsj.com",
        "bbc.co.uk",
        "bbc.com",
        "theguardian.com",
        "economist.com",
        "marketwatch.com",
        "investing.com",
        "finance.yahoo.com",
        "apnews.com",
        "nytimes.com",
        "washingtonpost.com",
        "businessinsider.com",
        "seekingalpha.com",
        "fool.com",
        "investors.com",
        "coindesk.com",
        "techcrunch.com",
    }
)

_LOW_QUALITY_SOURCE_RE = re.compile(
    r"\b("
    r"deals?|coupons?|promo|discount|shopping|gift guide|buying guide|"
    r"review blog|affiliate|sponsored|seo|content farm|"
    r"press release|globenewswire|pr newswire|ein news|newsfile|accesswire"
    r")\b",
    re.IGNORECASE,
)

_ESTABLISHED_SOURCE_NAMES_RE = re.compile(
    r"\b("
    r"reuters|associated press|ap news|bbc|bloomberg|financial times|wall street journal|"
    r"cnbc|marketwatch|yahoo finance|the guardian|new york times|washington post|"
    r"cnn|nbc|cbs|abc news|npr|politico|axios|the hill|sky sports|espn|"
    r"techcrunch|wired|ars technica|the register|stat|coindesk|the economist"
    r")\b",
    re.IGNORECASE,
)

_REPUTABLE_FINANCIAL_DOMAINS: frozenset[str] = frozenset(
    {
        "reuters.com",
        "ft.com",
        "bloomberg.com",
        "cnbc.com",
        "wsj.com",
        "marketwatch.com",
        "investing.com",
        "finance.yahoo.com",
        "seekingalpha.com",
        "investors.com",
        "economist.com",
        "businessinsider.com",
        "apnews.com",
    }
)

_BUSINESS_SOURCE_TERMS_RE = re.compile(
    r"\b("
    r"business|finance|financial|markets?|investing|investor|investors|"
    r"economics?|economist|wall street|bloomberg|reuters|cnbc|marketwatch|"
    r"forbes|fortune|barron'?s|yahoo finance"
    r")\b",
    re.IGNORECASE,
)

_NON_BUSINESS_SOURCE_RE = re.compile(
    r"\b("
    r"lifehacker|gizmodo|engadget|cnet|pcmag|tom'?s guide|techradar|the verge|"
    r"wired|popular science|popular mechanics|consumer reports|"
    r"entertainment|hollywood|variety|deadline|screen rant|gamespot|ign|"
    r"sports?|espn|bleacher report|recipe|food|travel|fashion|lifestyle|"
    r"science daily|new scientist"
    r")\b",
    re.IGNORECASE,
)


def article_combined_text(article: Article) -> str:
    return " ".join(
        part
        for part in (article.title, article.description, article.content)
        if part and str(part).strip()
    ).strip()


def _source_domain(url: str) -> str:
    if not url:
        return ""
    try:
        from urllib.parse import urlparse

        host = urlparse(url).netloc.lower()
        return host[4:] if host.startswith("www.") else host
    except Exception:
        return ""


def _domain_matches(domain: str, allowed: frozenset[str]) -> bool:
    if not domain:
        return False
    return any(domain == item or domain.endswith(f".{item}") for item in allowed)


def source_reputation_score(article: Article) -> int:
    domain = _source_domain(article.url)
    if _domain_matches(domain, _CREDIBLE_SOURCE_DOMAINS):
        return 2
    if _ESTABLISHED_SOURCE_NAMES_RE.search(article.source or ""):
        return 2
    if domain and not is_low_quality_source(article):
        return 1
    return 0


def is_low_quality_source(article: Article) -> bool:
    source_text = f"{article.source or ''} {_source_domain(article.url)}"
    if _LOW_QUALITY_SOURCE_RE.search(source_text):
        return True
    if not (article.source or "").strip() and not _source_domain(article.url):
        return True
    return False


def is_reputable_established_source(article: Article) -> bool:
    if is_low_quality_source(article):
        return False
    domain = _source_domain(article.url)
    if _domain_matches(domain, _CREDIBLE_SOURCE_DOMAINS):
        return True
    return bool(_ESTABLISHED_SOURCE_NAMES_RE.search(article.source or ""))


def is_reputable_financial_source(article: Article) -> bool:
    if is_low_quality_source(article):
        return False
    domain = _source_domain(article.url)
    source = article.source or ""
    if _domain_matches(domain, _REPUTABLE_FINANCIAL_DOMAINS):
        return True
    return bool(_BUSINESS_SOURCE_TERMS_RE.search(f"{source} {domain}"))


def headline_has_financial_or_political_topic(title: str) -> bool:
    return bool(_FINANCIAL_CONTENT_RE.search(title or ""))


def is_product_deal_or_review_headline(title: str) -> bool:
    if not _PRODUCT_DEAL_RE.search(title or ""):
        return False
    # Corporate M&A / markets headlines can contain "deal"; keep those when the finance signal is explicit.
    return not bool(
        re.search(
            r"\b(merger|acquisition|takeover|acquires?|shares?|stock|earnings|revenue|profit|ipo|sec|antitrust|tariff|trade|policy|government|budget)\b",
            title or "",
            re.IGNORECASE,
        )
    )


def article_has_financial_content(article: Article) -> bool:
    return bool(_FINANCIAL_CONTENT_RE.search(article_combined_text(article)))


def passes_article_relevance_filter(article: Article) -> bool:
    """Global hard rejects that apply before any portfolio/category decision."""
    title = (article.title or "").strip()
    if not title:
        return False
    if is_product_deal_or_review_headline(title):
        return False
    if is_low_quality_source(article):
        return False
    return True


def is_likely_english(text: str) -> bool:
    if not text.strip():
        return False
    if _NON_ENGLISH_RE.search(text):
        return False
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return False
    ascii_letters = sum(1 for c in letters if ord(c) < 128)
    return ascii_letters / len(letters) >= 0.9


def is_noise_article(text: str) -> bool:
    return bool(_NOISE_RE.search(text))


def passes_headline_safety_checks(article: Article) -> bool:
    title = (article.title or "").strip()
    if not title:
        return False
    if len(title.split()) < 6:
        return False
    if _SAFETY_COMMERCE_RE.search(title):
        return False
    if title == title.lower() and not re.search(r"[.!?,;:\"'()\-–—]", title):
        return False
    return True


def _normalize_headline_words(title: str) -> set[str]:
    cleaned = re.sub(r"[^\w\s]", " ", (title or "").lower())
    return {w for w in cleaned.split() if len(w) > 2}


def headlines_near_duplicate(a: str, b: str) -> bool:
    wa, wb = _normalize_headline_words(a), _normalize_headline_words(b)
    if not wa or not wb:
        return False
    overlap = len(wa & wb) / len(wa | wb)
    if overlap >= 0.72:
        return True
    ratio = SequenceMatcher(None, " ".join(sorted(wa)), " ".join(sorted(wb))).ratio()
    return ratio >= 0.82


def _contains_category_signal(text: str, signal: str) -> bool:
    signal = (signal or "").strip().lower()
    if not signal:
        return False
    if len(signal) <= 3 or re.fullmatch(r"[\w&.-]+", signal):
        return bool(re.search(rf"(?<![A-Za-z0-9]){re.escape(signal)}(?![A-Za-z0-9])", text))
    return signal in text


def matches_general_category(text: str, general_category: str) -> bool:
    key = normalize_focus_area_key(general_category)
    signals = CATEGORY_SIGNALS.get(key, CATEGORY_SIGNALS["macro"])
    lower = text.lower()
    for signal in signals:
        if _contains_category_signal(lower, signal):
            return True
    return False


def matching_focus_categories(article: Article, focus_categories: list[str]) -> list[str]:
    text = article_combined_text(article)
    if not text:
        return []
    matched: list[str] = []
    seen: set[str] = set()
    for raw in focus_categories:
        key = normalize_focus_area_key(raw)
        if key in seen:
            continue
        if matches_general_category(text, key):
            seen.add(key)
            matched.append(key)
    return matched


def article_within_hours(article: Article, hours: float, *, grace_hours: float = 0) -> bool:
    now = datetime.now(tz=timezone.utc)
    published = article.published_at
    if published.tzinfo is None:
        published = published.replace(tzinfo=timezone.utc)
    return published >= now - timedelta(hours=hours + grace_hours)


def article_within_category_window(article: Article, hours: float = CATEGORY_MAX_AGE_HOURS) -> bool:
    return article_within_hours(article, hours, grace_hours=0)


def article_mentions_watchlist(article: Article, portfolio: list[PortfolioSecurity]) -> bool:
    """Fetch-time watchlist mention check: headline only, whole words only."""
    title = article.title or ""
    for item in portfolio:
        if headline_mentions_ticker_or_company(title, item.ticker):
            return True
    return False


def article_matches_watchlist(article: Article, portfolio: list[PortfolioSecurity]) -> bool:
    """Backward-compatible alias for coarse mention check."""
    return article_mentions_watchlist(article, portfolio)


def _portfolio_ticker_for_article(article: Article, portfolio: list[PortfolioSecurity]) -> str | None:
    title = article.title or ""
    by_ticker = {item.ticker.upper(): item.ticker for item in portfolio}

    for raw in article.related_tickers or []:
        key = (raw or "").strip().upper()
        if key in by_ticker:
            return by_ticker[key]

    for item in portfolio:
        if headline_mentions_ticker_or_company(title, item.ticker):
            return item.ticker
    return None


def portfolio_ticker_for_article(article: Article, portfolio: list[PortfolioSecurity]) -> str | None:
    return _portfolio_ticker_for_article(article, portfolio)


def company_is_primary_subject(article: Article, ticker: str) -> bool:
    title = article.title or ""
    if not headline_mentions_ticker_or_company(title, ticker):
        return False
    clean = (ticker or "").strip().upper()
    if clean in _AMBIGUOUS_COMPANY_TICKERS and not re.search(rf"\$?\b{re.escape(clean)}\b|\({re.escape(clean)}\)", title):
        return bool(_COMPANY_PRIMARY_CONTEXT_RE.search(title))
    return True


def has_portfolio_business_signal(text: str) -> bool:
    return bool(_PORTFOLIO_BUSINESS_RE.search(text))


def is_lifestyle_without_business_angle(article: Article) -> bool:
    title = article.title or ""
    text = article_combined_text(article)
    if not _LIFESTYLE_RE.search(text):
        return False
    return not has_portfolio_business_signal(title)


def article_qualifies_as_portfolio(article: Article, portfolio: list[PortfolioSecurity]) -> bool:
    """
    Portfolio article: headline is primarily about a watchlist company/ticker.
    The topic can be financial, legal, product, leadership, analyst, sport, or any other genuine company news.
    """
    text = article_combined_text(article)
    if not text or not is_likely_english(text):
        return False
    if not passes_article_relevance_filter(article):
        return False
    if is_noise_article(text):
        return False
    if not passes_headline_safety_checks(article):
        return False
    if not article_within_category_window(article):
        return False

    ticker = _portfolio_ticker_for_article(article, portfolio)
    if not ticker:
        return False
    if not company_is_primary_subject(article, ticker):
        return False
    if is_lifestyle_without_business_angle(article):
        return False
    return True


def headline_ticker_match(article: Article, ticker: str) -> bool:
    return headline_mentions_ticker_or_company(article.title or "", ticker)


def portfolio_business_impact_score(article: Article) -> int:
    text = article_combined_text(article)
    return len(_PORTFOLIO_BUSINESS_RE.findall(text))


def _portfolio_sort_key(article: Article, portfolio: list[PortfolioSecurity]) -> tuple:
    ticker = _portfolio_ticker_for_article(article, portfolio) or ""
    headline_match = 1 if ticker and headline_ticker_match(article, ticker) else 0
    impact = portfolio_business_impact_score(article)
    published = article.published_at
    if published.tzinfo is None:
        published = published.replace(tzinfo=timezone.utc)
    return (headline_match, impact, published.timestamp())


def article_matches_category_feed(article: Article, general_category: str) -> bool:
    key = normalize_focus_area_key(general_category)
    text = article_combined_text(article)
    if not text or not is_likely_english(text):
        return False
    if not passes_article_relevance_filter(article):
        return False
    if is_noise_article(text):
        return False
    if not passes_headline_safety_checks(article):
        return False
    if not article_within_category_window(article):
        return False
    if not is_reputable_established_source(article):
        return False
    if not matches_general_category(text, key):
        return False
    if key in FINANCE_CATEGORY_KEYS and not article_has_financial_content(article):
        return False
    return True


def article_matches_category_feed_relaxed(article: Article, general_category: str) -> bool:
    key = normalize_focus_area_key(general_category)
    text = article_combined_text(article)
    if not text or not is_likely_english(text):
        return False
    if not passes_article_relevance_filter(article):
        return False
    if is_noise_article(text):
        return False
    if not passes_headline_safety_checks(article):
        return False
    if not article_within_category_window(article):
        return False
    if not matches_general_category(text, key):
        return False
    if key in FINANCE_CATEGORY_KEYS and not article_has_financial_content(article):
        return False
    return True


def article_is_relevant(
    article: Article,
    portfolio: list[PortfolioSecurity],
    focus_categories: list[str] | str,
) -> bool:
    """True when the story belongs in the brief: qualifying portfolio news or a focus category."""
    cats = [focus_categories] if isinstance(focus_categories, str) else list(focus_categories)
    if article_qualifies_as_portfolio(article, portfolio):
        return True
    for cat in cats:
        if article_matches_category_feed(article, cat):
            return True
    return False


def _pick_better_duplicate(existing: Article, candidate: Article) -> Article:
    existing_ts = existing.published_at
    candidate_ts = candidate.published_at
    if existing_ts.tzinfo is None:
        existing_ts = existing_ts.replace(tzinfo=timezone.utc)
    if candidate_ts.tzinfo is None:
        candidate_ts = candidate_ts.replace(tzinfo=timezone.utc)
    if candidate_ts != existing_ts:
        return candidate if candidate_ts > existing_ts else existing
    return candidate if source_reputation_score(candidate) > source_reputation_score(existing) else existing


def dedupe_articles(articles: list[Article]) -> list[Article]:
    """Remove URL duplicates and near-duplicate headlines, keeping the best source."""
    by_url: dict[str, Article] = {}
    no_url: list[Article] = []
    for article in articles:
        url = (article.url or "").strip()
        if not url:
            no_url.append(article)
            continue
        if url in by_url:
            by_url[url] = _pick_better_duplicate(by_url[url], article)
        else:
            by_url[url] = article

    unique = list(by_url.values()) + no_url
    kept: list[Article] = []
    for article in unique:
        replaced = False
        for idx, other in enumerate(kept):
            if headlines_near_duplicate(article.title or "", other.title or ""):
                kept[idx] = _pick_better_duplicate(other, article)
                replaced = True
                break
        if not replaced:
            kept.append(article)
    return kept


def _tag_article(article: Article, *, focus_category_key: str = "", portfolio_ticker: str = "") -> Article:
    updates: dict[str, str] = {}
    if portfolio_ticker:
        updates["article_kind"] = "portfolio"
        updates["portfolio_ticker"] = portfolio_ticker
        updates["focus_category"] = ""
    elif focus_category_key:
        updates["article_kind"] = "category"
        updates["focus_category"] = focus_category_key
        updates["portfolio_ticker"] = ""
    return article.model_copy(update=updates)


def tag_portfolio_article(article: Article, portfolio_ticker: str) -> Article:
    return _tag_article(article, portfolio_ticker=portfolio_ticker)


def tag_category_article(article: Article, focus_category_key: str) -> Article:
    return _tag_article(article, focus_category_key=normalize_focus_area_key(focus_category_key))


def select_articles_for_brief(
    articles: list[Article],
    portfolio: list[PortfolioSecurity],
    focus_categories: list[str],
    *,
    hours_back: int = CATEGORY_MAX_AGE_HOURS,
) -> list[Article]:
    """
    Build the final article list: up to 10 portfolio stories and up to 3 per focus category.
    Applies safety checks, deduplication, and category tagging on each Article.
    """
    normalized_cats: list[str] = []
    seen_cats: set[str] = set()
    for raw in focus_categories:
        key = normalize_focus_area_key(raw)
        if key not in seen_cats:
            seen_cats.add(key)
            normalized_cats.append(key)
    if not normalized_cats:
        normalized_cats = ["macro"]

    safe_articles = [a for a in articles if passes_headline_safety_checks(a) and passes_article_relevance_filter(a)]
    safe_articles = dedupe_articles(safe_articles)

    portfolio_pool = [a for a in safe_articles if article_qualifies_as_portfolio(a, portfolio)]
    portfolio_pool.sort(key=lambda a: _portfolio_sort_key(a, portfolio), reverse=True)
    selected_portfolio: list[Article] = []
    seen_urls: set[str] = set()
    for article in portfolio_pool:
        if len(selected_portfolio) >= MAX_PORTFOLIO_ARTICLES:
            break
        url = (article.url or "").strip()
        if url and url in seen_urls:
            continue
        ticker = _portfolio_ticker_for_article(article, portfolio)
        if not ticker:
            continue
        if url:
            seen_urls.add(url)
        selected_portfolio.append(_tag_article(article, portfolio_ticker=ticker))

    category_pool = [
        a
        for a in safe_articles
        if (a.url or "") not in seen_urls
        and article_within_category_window(a)
        and not article_qualifies_as_portfolio(a, portfolio)
    ]

    selected_category: list[Article] = []
    for cat_key in normalized_cats:
        cat_candidates = [
            a
            for a in category_pool
            if article_matches_category_feed(a, cat_key)
            and (a.url or "") not in seen_urls
            and not any(headlines_near_duplicate(a.title or "", s.title or "") for s in selected_category)
        ]
        cat_candidates.sort(
            key=lambda a: (source_reputation_score(a), a.published_at.timestamp()),
            reverse=True,
        )
        count = 0
        for article in cat_candidates:
            if count >= MAX_CATEGORY_ARTICLES:
                break
            url = (article.url or "").strip()
            if url and url in seen_urls:
                continue
            if url:
                seen_urls.add(url)
            selected_category.append(_tag_article(article, focus_category_key=cat_key))
            count += 1

    result = selected_portfolio + selected_category

    logger.info(
        "article_select portfolio=%s category=%s focus_areas=%s input=%s safe=%s",
        len(selected_portfolio),
        len(selected_category),
        normalized_cats,
        len(articles),
        len(safe_articles),
    )
    return result


def filter_articles_for_brief(
    articles: list[Article],
    portfolio: list[PortfolioSecurity],
    general_category: str,
) -> list[Article]:
    """Legacy entry point — delegates to select_articles_for_brief."""
    return select_articles_for_brief(
        articles,
        portfolio,
        [general_category],
        hours_back=CATEGORY_MAX_AGE_HOURS,
    )


def focus_category_label_for_article(article: Article) -> str:
    key = (article.focus_category or "").strip()
    if key:
        return focus_area_label(key)
    return ""
