from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from openai import OpenAI

from app.config import get_settings
from app.models import Article


def _render_source_block(articles: list[Article]) -> tuple[str, dict[str, str]]:
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
    return "\n\n".join(lines), citations


def generate_script(articles: list[Article], tickers: list[str], target_minutes: int) -> tuple[str, dict[str, str]]:
    settings = get_settings()
    source_block, citations = _render_source_block(articles)

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
