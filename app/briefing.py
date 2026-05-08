from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from openai import OpenAI

from app.config import get_settings
from app.models import Article, PortfolioQuote, PortfolioSecurity, SecurityImpactNote, SourceLink


def _render_source_block(articles: list[Article]) -> tuple[str, dict[str, str], dict[str, Article]]:
    """
    Build source text with deterministic IDs so the model can cite only known docs.
    """
    lines: list[str] = []
    citations: dict[str, str] = {}
    for idx, article in enumerate(articles, start=1):
        sid = f"S{idx}"
        citations[sid] = article.url
        lines.append(
            "\n".join(
                [
                    f"[{sid}]",
                    f"source={article.source}",
                    f"title={article.title}",
                    f"published_at={article.published_at.isoformat()}",
                    f"related_tickers={','.join(article.related_tickers)}",
                    f"description={article.description}",
                    f"content={article.content}",
                ]
            )
        )
    source_lookup = {f"S{idx}": article for idx, article in enumerate(articles, start=1)}
    return "\n\n".join(lines), citations, source_lookup


def _extract_json(text: str) -> dict:
    raw = text.strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()
    return json.loads(raw)


def generate_script(articles: list[Article], tickers: list[str], target_minutes: int) -> tuple[str, dict[str, str]]:
    settings = get_settings()
    source_block, citations, _ = _render_source_block(articles)

    system_prompt = (
        "You are a careful financial news summarizer. "
        "Do not invent facts. Only use supplied sources. "
        "If a detail cannot be supported by a source, omit it. "
        "Return a concise spoken script with explicit source tags like [S1], [S2]."
    )

    user_prompt = (
        f"Tickers: {', '.join(tickers)}\n"
        f"Target length: {target_minutes} minutes spoken audio.\n"
        "Create an engaging but factual morning briefing in plain English with sections:\n"
        "1) Top overnight moves\n"
        "2) Company-specific updates\n"
        "3) Sector/macro context that directly impacts these tickers\n"
        "4) What to watch today\n\n"
        "Constraints:\n"
        "- Every claim must include a source tag [Sx].\n"
        "- If sources conflict, mention the conflict and cite both.\n"
        "- Avoid recommendations; stick to summarized facts and uncertainties.\n"
        "- Keep paragraphs short and easy to listen to.\n\n"
        f"Sources:\n{source_block}\n"
    )

    client = OpenAI(api_key=settings.openai_api_key)
    response = client.responses.create(
        model=settings.summary_model,
        input=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    script = response.output_text or ""
    # Keep only source IDs that were actually used by the generated script.
    used_sources = {sid for sid in citations if sid in script}
    filtered_citations = {k: v for k, v in citations.items() if k in used_sources}
    return script, filtered_citations


def generate_daily_brief(
    *,
    listener_name: str,
    occupation: str,
    investor_type: str,
    app_use: str,
    portfolio: list[PortfolioSecurity],
    portfolio_quotes: list[PortfolioQuote],
    general_category: str,
    notification_time: str,
    articles: list[Article],
    target_minutes: int,
) -> tuple[dict, list[SourceLink]]:
    settings = get_settings()
    source_block, citations, source_lookup = _render_source_block(articles)
    quote_lines: list[str] = []
    for quote in portfolio_quotes:
        quote_lines.append(
            (
                f"{quote.ticker} ({quote.asset_type}) | name={quote.display_name} | "
                f"price={quote.price} | change={quote.change} | change_percent={quote.change_percent} | "
                f"currency={quote.currency}"
            )
        )

    system_prompt = (
        "You are generating a neutral daily financial morning brief for a retail investor. "
        "You must remain factual and cautious. "
        "Do not provide investment advice. "
        "Never say buy, sell, or hold. "
        "Avoid guarantees. "
        "Explain why each relevant news item may affect each security, with uncertainty where needed. "
        "Return strict JSON only."
    )
    user_prompt = (
        f"Listener name: {listener_name}\n"
        f"Occupation: {occupation}\n"
        f"Investor type: {investor_type}\n"
        f"App use mode: {app_use}\n"
        f"Notification time: {notification_time}\n"
        f"General news category: {general_category}\n"
        f"Target audio length: {target_minutes} minutes\n\n"
        "Portfolio (exactly these five securities):\n"
        + "\n".join([f"- {item.ticker} ({item.asset_type})" for item in portfolio])
        + "\n\n"
        "Latest market snapshot:\n"
        + "\n".join([f"- {line}" for line in quote_lines])
        + "\n\n"
        "Return JSON with keys:\n"
        "{\n"
        '  "greeting": "string",\n'
        '  "security_impact_notes": [\n'
        '    {"ticker":"string","asset_type":"stock|etf|bond","update":"string","why_it_matters":"string","sentiment":"positive|neutral|negative|mixed"}\n'
        "  ],\n"
        '  "general_news_notes": ["string"],\n'
        '  "show_notes_summary": ["string"],\n'
        '  "quote_of_day": "string",\n'
        '  "goodbye": "string",\n'
        '  "script": "spoken 5-10 minute script using [Sx] tags for claims"\n'
        "}\n\n"
        "Constraints:\n"
        "- Mention each portfolio security in security_impact_notes.\n"
        "- Keep tone neutral and digestible.\n"
        "- Must include source tags [Sx] in script for factual claims.\n"
        "- If evidence is weak/conflicting, explicitly say so.\n"
        "- Include a personalized greeting and friendly goodbye.\n\n"
        f"Sources:\n{source_block}\n"
    )

    client = OpenAI(api_key=settings.openai_api_key)
    response = client.responses.create(
        model=settings.summary_model,
        input=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    raw_text = response.output_text or "{}"
    payload = _extract_json(raw_text)
    script = payload.get("script", "").strip()
    payload["script"] = script
    payload["greeting"] = payload.get("greeting", f"Good morning, {listener_name}.")
    payload["goodbye"] = payload.get("goodbye", "Thanks for listening. Have a productive day.")
    payload["quote_of_day"] = payload.get("quote_of_day", "Consistency compounds.")
    payload["general_news_notes"] = payload.get("general_news_notes", [])[:5]
    payload["show_notes_summary"] = payload.get("show_notes_summary", [])[:8]

    notes = payload.get("security_impact_notes") or []
    sanitized_notes: list[SecurityImpactNote] = []
    for row in notes:
        try:
            sanitized_notes.append(SecurityImpactNote.model_validate(row))
        except Exception:
            continue
    payload["security_impact_notes"] = [n.model_dump() for n in sanitized_notes]

    used_source_ids = [sid for sid in citations if sid in script]
    if not used_source_ids:
        used_source_ids = list(citations.keys())[:10]

    source_links: list[SourceLink] = []
    for sid in used_source_ids:
        article = source_lookup.get(sid)
        if not article:
            continue
        source_links.append(
            SourceLink(
                source_id=sid,
                title=article.title,
                source=article.source,
                url=article.url,
                published_at=article.published_at,
            )
        )
    return payload, source_links


def synthesize_audio(script: str) -> str:
    settings = get_settings()
    client = OpenAI(api_key=settings.openai_api_key)
    output_dir = Path(settings.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    filename = f"briefing-{datetime.now(tz=timezone.utc).strftime('%Y%m%d-%H%M%S')}-{uuid4().hex[:8]}.mp3"
    output_path = output_dir / filename

    with client.audio.speech.with_streaming_response.create(
        model=settings.tts_model,
        voice=settings.tts_voice,
        input=script,
        response_format="mp3",
    ) as response:
        response.stream_to_file(output_path)

    return str(output_path)
