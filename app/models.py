from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class Article(BaseModel):
    source: str
    title: str
    url: str
    published_at: datetime
    description: str = ""
    content: str = ""
    related_tickers: list[str] = Field(default_factory=list)


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


class PortfolioSecurity(BaseModel):
    ticker: str
    asset_type: Literal["stock", "etf", "bond"] = "stock"


class PortfolioQuote(BaseModel):
    ticker: str
    asset_type: str
    display_name: str
    price: float | None = None
    change: float | None = None
    change_percent: float | None = None
    currency: str | None = None


class SecurityImpactNote(BaseModel):
    ticker: str
    asset_type: str
    update: str
    why_it_matters: str
    sentiment: Literal["positive", "neutral", "negative", "mixed"] = "neutral"


class SourceLink(BaseModel):
    source_id: str
    title: str
    source: str
    url: str
    published_at: datetime


class DailyBriefRequest(BaseModel):
    listener_name: str = Field(default="Investor", min_length=1, max_length=60)
    portfolio: list[PortfolioSecurity] = Field(min_length=1, max_length=5)
    general_category: str = Field(default="macro", min_length=2, max_length=40)
    notification_time: str = Field(default="07:00", min_length=3, max_length=10)
    wants_alarm_mode: bool = False
    hours_back: int = Field(default=24, ge=3, le=96)
    max_articles: int = Field(default=36, ge=8, le=120)
    target_minutes: int = Field(default=6, ge=3, le=12)


class DailyBriefResponse(BaseModel):
    generated_at: datetime
    listener_name: str
    notification_time: str
    general_category: str
    portfolio_quotes: list[PortfolioQuote]
    greeting: str
    script: str
    quote_of_day: str
    goodbye: str
    security_impact_notes: list[SecurityImpactNote]
    general_news_notes: list[str]
    show_notes_summary: list[str]
    source_links: list[SourceLink]
    audio_url: str
    speaker_tip: str
    ios_alarm_steps: list[str]
    usage_disclaimer: str
