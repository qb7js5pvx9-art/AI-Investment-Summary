from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.focus_areas import normalize_focus_area_key

LocalTimeOfDay = Literal["morning", "afternoon", "evening"]


class Article(BaseModel):
    source: str
    title: str
    url: str
    published_at: datetime
    description: str = ""
    content: str = ""
    related_tickers: list[str] = Field(default_factory=list)
    article_kind: Literal["portfolio", "category", ""] = ""
    portfolio_ticker: str = ""
    focus_category: str = ""


class BriefingRequest(BaseModel):
    tickers: list[str]
    hours_back: int = Field(default=18, ge=1, le=72)
    max_articles: int = Field(default=30, ge=5, le=100)
    target_minutes: int = Field(default=7, ge=3, le=15)


class BriefingResponse(BaseModel):
    generated_at: datetime
    tickers: list[str]
    article_count: int
    script: str
    citations: dict[str, str]
    audio_file: str
    audio_url: str


class StockSearchResponse(BaseModel):
    results: list[dict[str, str]]


class MasterUnlockRequest(BaseModel):
    password: str = Field(default="", max_length=200)


class MasterUnlockResponse(BaseModel):
    unlocked: bool


class PortfolioSecurity(BaseModel):
    ticker: str
    asset_type: Literal["stock", "etf", "bond"] = "stock"


class PortfolioQuote(BaseModel):
    ticker: str
    asset_type: str
    display_name: str
    price: float | None = Field(
        default=None,
        description="Last regular-session price in `currency` units when the quote feed returned it.",
    )
    change: float | None = Field(
        default=None,
        description="Session point change vs prior close (same units as price); from quote feed when present.",
    )
    change_percent: float | None = Field(
        default=None,
        description="Session percentage move as a number (e.g. 1.25 means +1.25%); from quote feed when present.",
    )
    currency: str | None = Field(default=None, description="ISO currency for price and point change when known.")
    previous_close: float | None = Field(
        default=None,
        description="Prior session close from the quote feed when present (e.g. Finnhub `pc`).",
    )


class SecurityImpactNote(BaseModel):
    ticker: str
    asset_type: str
    update: str
    why_it_matters: str
    sentiment: Literal["positive", "neutral", "negative", "mixed"] = "neutral"


class PortfolioInsight(BaseModel):
    text: str = Field(min_length=1, max_length=220)
    tone: Literal["positive", "alert"] = "alert"


class SourceLink(BaseModel):
    source_id: str
    title: str
    source: str
    url: str
    published_at: datetime
    source_domain: str = ""
    word_count: int | None = None
    category: Literal["portfolio", "macro"] = "macro"
    relevance_tag: str = "Macro"
    focus_category: str = Field(
        default="",
        description="Focus-area label for category articles (e.g. Stock Markets); used for Articles filtering.",
    )
    is_top_story: bool = False
    headline_normalized: str = ""


class DailyBriefRequest(BaseModel):
    listener_name: str = Field(default="Investor", min_length=1, max_length=60)
    occupation: str = Field(default="Professional", min_length=1, max_length=80)
    investor_type: str = Field(default="General investor", min_length=1, max_length=80)
    app_use: str = Field(default="alarm", min_length=1, max_length=40)
    portfolio: list[PortfolioSecurity] = Field(min_length=1, max_length=5)
    general_category: str = Field(default="macro", min_length=2, max_length=40)
    focus_categories: list[str] = Field(
        default_factory=list,
        description="Selected focus areas from profile; when empty, general_category is used.",
    )
    notification_time: str = Field(default="07:00", min_length=3, max_length=10)
    wants_alarm_mode: bool = False
    hours_back: int = Field(default=48, ge=3, le=96)
    max_articles: int = Field(default=36, ge=8, le=120)
    target_minutes: int = Field(default=4, ge=3, le=12)
    local_time_of_day: LocalTimeOfDay = Field(
        default="morning",
        description="Browser-local period when the user taps generate (morning 05:00–11:59, afternoon 12:00–17:59, evening otherwise).",
    )

    @field_validator("general_category", mode="before")
    @classmethod
    def _normalize_general_category(cls, value: object) -> str:
        return normalize_focus_area_key(str(value or "macro"))

    @field_validator("focus_categories", mode="before")
    @classmethod
    def _normalize_focus_categories(cls, value: object) -> list[str]:
        if not value:
            return []
        if isinstance(value, str):
            value = [value]
        if not isinstance(value, list):
            return []
        seen: set[str] = set()
        out: list[str] = []
        for item in value:
            key = normalize_focus_area_key(str(item or ""))
            if key and key not in seen:
                seen.add(key)
                out.append(key)
        return out


class DailyBriefResponse(BaseModel):
    generated_at: datetime
    listener_name: str
    notification_time: str
    general_category: str
    portfolio_quotes: list[PortfolioQuote]
    quotes: dict[str, dict[str, float | str | None]] = Field(
        default_factory=dict,
        description="Live quote rows keyed by ticker, fetched once during brief generation.",
    )
    greeting: str
    script: str
    quote_of_day: str
    goodbye: str
    security_impact_notes: list[SecurityImpactNote]
    general_news_notes: list[str]
    show_notes_summary: list[str]
    source_links: list[SourceLink]
    portfolio_articles: list[SourceLink] = Field(
        default_factory=list,
        description="Articles screen pool for watchlist-security stories only.",
    )
    category_articles: list[SourceLink] = Field(
        default_factory=list,
        description="Articles screen pool for selected focus-category stories only.",
    )
    category_name: str = Field(
        default="",
        description="Short display label for the category article tab.",
    )
    audio_url: str
    speaker_tip: str
    ios_alarm_steps: list[str]
    usage_disclaimer: str
    episode_title: str = Field(
        default="",
        description="Short 5–8 word headline for the home player card, summarising today's top stories.",
    )
    portfolio_insights: list[PortfolioInsight] = Field(
        default_factory=list,
        description="Exactly two one-sentence watchlist signals for the home insight card.",
    )
