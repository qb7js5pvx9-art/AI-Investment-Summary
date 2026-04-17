from datetime import datetime
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
