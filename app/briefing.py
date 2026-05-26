from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

from openai import BadRequestError
from openai import OpenAI

from app.article_filter import (
    article_is_relevant,
    article_matches_category_feed,
    article_qualifies_as_portfolio,
    focus_category_label_for_article,
    is_reputable_established_source,
    matching_focus_categories,
)
from app.focus_areas import focus_area_label, normalize_focus_area_key
from app.config import get_settings
from app.models import Article, PortfolioInsight, PortfolioQuote, PortfolioSecurity, SecurityImpactNote, SourceLink
from app.ticker_match import headline_mentions_ticker_or_company

logger = logging.getLogger(__name__)

# Daily brief JSON includes many fields plus a long spoken script; keep a generous cap so the
# Responses API does not truncate mid-JSON (which produces very short audio).
_DAILY_BRIEF_MAX_OUTPUT_TOKENS = 32768
_LEGACY_SCRIPT_MAX_OUTPUT_TOKENS = 12000


def _log_response_incomplete(response: object, context: str) -> None:
    status = getattr(response, "status", None)
    incomplete = getattr(response, "incomplete_details", None)
    if status == "incomplete" or incomplete:
        logger.warning(
            "openai_response_incomplete context=%s status=%s incomplete_details=%s",
            context,
            status,
            incomplete,
        )


def _canonical_investor_type(raw: str) -> str:
    """Map free-text / legacy labels to the three supported profiles."""
    key = (raw or "").strip().casefold()
    aliases = {
        "general investor": "General investor",
        "retail investor": "General investor",
        "active trader": "Active trader",
        "long-term investor": "Long-term investor",
    }
    return aliases.get(key, "General investor")


def _investor_type_briefing_instructions(canonical: str) -> str:
    """
    Persona-specific editorial instructions for the daily brief (script + notes fields).
    Must stay aligned with the app's premium British editorial voice.
    """
    if canonical == "Active trader":
        return (
            "**Investor-type profile — Active trader (this must noticeably shape the whole output):**\n"
            "- **Pacing and tone:** brisk, market-floor energy; shorter clauses; a sense of what is moving *now*. "
            "Still premium and controlled — never breathless hype or slangy trading clichés.\n"
            "- **Market focus:** lead on catalysts, volatility, momentum, flows, sentiment shifts, and "
            "overnight or session-moving headlines. Macro only where it clearly drives near-term repricing.\n"
            "- **Company/watchlist treatment:** tight, event-led; compress balance-sheet colour unless a source "
            "flags a near-term trigger. Prefer what reprices the tape today over long strategic essays.\n"
            "- **Terminology:** you may use common market vocabulary (e.g. gap, rally, sell-off, sentiment) where "
            "natural; define nothing lengthy — assume quick listener literacy.\n"
            "- **Noise vs signal:** intraday-style moves and positioning-sensitive stories are in scope when sourced; "
            "skip slow-burn context unless it is a clear driver.\n"
            "- **security_impact_notes:** crisp, headline-led updates; `why_it_matters` = near-term trading or "
            "catalyst linkage in one short sentence.\n"
            "- **general_news_notes / show_notes_summary:** favour what could move sectors or risk appetite today.\n"
            "- **quote_of_day:** punchy, intelligent — not soft self-help; can carry a hint of discipline or "
            "risk-awareness without sounding like a slogan.\n"
        )
    if canonical == "Long-term investor":
        return (
            "**Investor-type profile — Long-term investor (this must noticeably shape the whole output):**\n"
            "- **Pacing and tone:** measured, strategic, calm authority; longer arcs allowed; fewer sharp pivots.\n"
            "- **Market focus:** prioritise fundamentals, durable trends, earnings quality, guidance, balance sheet, "
            "competitive position, and macro regimes that affect the *business* outlook. Deprioritise intraday noise, "
            "unless a source ties it to a material structural change.\n"
            "- **Company/watchlist treatment:** richer context on earnings, strategy, capital allocation, regulation, "
            "and industry structure; connect dots across quarters when sources allow.\n"
            "- **Terminology:** precise institutional plain English; explain specialised terms briefly when they aid "
            "understanding — no patronising tone.\n"
            "- **Noise vs signal:** do not dwell on session volatility without sourced fundamental or strategic "
            "consequence; prefer durable drivers.\n"
            "- **security_impact_notes:** `update` frames the business fact; `why_it_matters` ties to franchise "
            "value, runway, risk, or multi-year positioning — not day-trade levels.\n"
            "- **general_news_notes / show_notes_summary:** emphasise structural, policy, or macro themes with "
            "lasting relevance.\n"
            "- **quote_of_day:** reflective, time-horizon aware — intelligent restraint rather than aphorism spam.\n"
        )
    # General investor (default)
    return (
        "**Investor-type profile — General investor (this must noticeably shape the whole output):**\n"
        "- **Pacing and tone:** clear, easy to follow, approachable but intelligent; warm confidence without "
        "dumbing down.\n"
        "- **Market focus:** balanced blend of overnight/session context and portfolio-relevant company news; "
        "macro woven in only when it clarifies practical relevance.\n"
        "- **Company/watchlist treatment:** plain-English explanations; keep jargon light — if a term helps, give a "
        "short in-passing gloss. Prioritise what matters for an engaged non-professional.\n"
        "- **Terminology:** everyday financial vocabulary; avoid hedge-fund shorthand stacks.\n"
        "- **Explanation depth:** concise but fair — enough context to understand *why* something matters without "
        "lecture length.\n"
        "- **security_impact_notes:** practical and readable; `why_it_matters` = everyday relevance (portfolio, "
        "sector, or economic link) in plain language.\n"
        "- **general_news_notes / show_notes_summary:** readable bullets that answer 'so what for someone like me?'\n"
        "- **quote_of_day:** thoughtful and human — never trite.\n"
    )


def _format_portfolio_quote_for_prompt(quote: PortfolioQuote) -> str:
    if quote.price is None or quote.price == 0:
        return ""
    price = f"${quote.price:.2f}"
    if quote.change is None or quote.change_percent is None:
        return f"{quote.ticker} is currently trading at {price}."
    if quote.change == 0 and quote.change_percent == 0:
        return f"{quote.ticker} is currently trading at {price}."

    direction = "up" if quote.change >= 0 else "down"
    change = f"${abs(quote.change):.2f}"
    signed_pct = f"{'+' if quote.change_percent >= 0 else ''}{quote.change_percent:.2f}%"
    return (
        f"{quote.ticker} is currently trading at {price}, {direction} {change} "
        f"({signed_pct}) today."
    )


def _default_greeting_line(listener_name: str, local_time_of_day: str) -> str:
    stem = {
        "morning": "Good morning",
        "afternoon": "Good afternoon",
        "evening": "Good evening",
    }.get(local_time_of_day, "Good morning")
    return f"{stem}, {listener_name}."


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
    if "```" in raw:
        start = raw.find("```")
        fence = raw[start : start + 7]
        if fence.startswith("```json"):
            start = raw.find("```json") + 7
        else:
            start = start + 3
        end = raw.rfind("```")
        if end > start:
            raw = raw[start:end].strip()
            if raw.lower().startswith("json"):
                raw = raw[4:].lstrip()
    raw = raw.strip()
    return json.loads(raw)


def _collect_output_text(response: object) -> str:
    """Aggregate assistant output_text segments; avoids relying on a single truncated output_text."""
    chunks: list[str] = []
    for item in getattr(response, "output", None) or []:
        if getattr(item, "type", None) != "message":
            continue
        for part in getattr(item, "content", None) or []:
            if getattr(part, "type", None) != "output_text":
                continue
            t = getattr(part, "text", None) or ""
            if t:
                chunks.append(t)
    merged = "".join(chunks).strip()
    if merged:
        return merged
    return (getattr(response, "output_text", None) or "").strip()


def generate_script(articles: list[Article], tickers: list[str], target_minutes: int) -> tuple[str, dict[str, str]]:
    settings = get_settings()
    source_block, citations, _ = _render_source_block(articles)

    system_prompt = (
        "You are a careful financial news summarizer. "
        "Do not invent facts. Only use supplied sources. "
        "If a detail cannot be supported by a source, omit it. "
        "Return a full-length spoken script with explicit source tags like [S1], [S2]. "
        "The script will be read aloud as the main audio briefing — it must be detailed enough to fill the target time."
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
        max_output_tokens=_LEGACY_SCRIPT_MAX_OUTPUT_TOKENS,
        text={"verbosity": "medium"},
    )
    _log_response_incomplete(response, "generate_script")
    script = _collect_output_text(response)
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
    focus_categories: list[str] | None = None,
    local_time_of_day: str = "morning",
    script_length_retry: bool = False,
) -> tuple[dict, list[SourceLink]]:
    settings = get_settings()
    resolved_focus_categories = focus_categories or [general_category]
    source_block, citations, source_lookup = _render_source_block(articles)
    logger.info("generate_daily_brief_articles_in_prompt count=%s", len(articles))
    quote_lines: list[str] = []
    for quote in portfolio_quotes:
        line = _format_portfolio_quote_for_prompt(quote)
        if line:
            quote_lines.append(line)

    canonical_investor = _canonical_investor_type(investor_type)
    investor_persona = _investor_type_briefing_instructions(canonical_investor)
    logger.info(
        "generate_daily_brief_investor_type raw=%r canonical=%r",
        investor_type,
        canonical_investor,
    )
    legacy_investor_note = ""
    raw_label = (investor_type or "").strip()
    if raw_label and raw_label.casefold() not in {
        "general investor",
        "active trader",
        "long-term investor",
    }:
        legacy_investor_note = (
            f"(App sent investor type label {raw_label!r}; use the {canonical_investor} profile above.)\n"
        )

    system_prompt = (
        "You are the lead writer for a premium UK-market morning audio briefing for engaged private-market listeners. "
        "The Investor type in the user message must materially steer pacing, explanation depth, macro versus watchlist "
        "emphasis, terminology, and how portfolio updates are framed — whilst preserving the same polished editorial "
        "identity (premium, evidence-led, British). "
        "Use British English spelling and vocabulary throughout (e.g. organisation, emphasise, whilst where natural). "
        "Write with an editorial, confident tone: clear hierarchy, natural spoken rhythm, no filler, no hype, no "
        "robotic disclaimers. "
        "Be factual and proportionate: prioritise material, source-backed developments; omit low-signal speculation "
        "and vague 'could' or 'might' scenarios unless the sources themselves frame uncertainty that way. "
        "Do not provide investment advice; never say buy, sell, or hold; avoid guarantees. "
        "When watchlist quote figures in the snapshot are present and usable, you may weave in price and session move "
        "in passing, in plain language — never invent numbers. "
        "Never apologise for missing figures, never mention APIs or feeds in the spoken script; "
        "if a figure is missing, simply say nothing about that figure and continue. "
        "The spoken script must always meet the requested audio length — even when source material is thin, expand with "
        "sourced macro and sector context, thoughtful transitions, and proportionate watchlist coverage; never return "
        "a short summary, outline, or placeholder instead of full narration. "
        "Return strict JSON only (no markdown, no code fences). The JSON must be parseable as a single object."
    )
    tod = local_time_of_day if local_time_of_day in ("morning", "afternoon", "evening") else "morning"
    words_target = int(target_minutes * 150)
    words_low = max(400, int(target_minutes * 125))
    words_high = int(target_minutes * 175)

    tod_guidance = {
        "morning": (
            "Their device clock shows morning (05:00–11:59 local). "
            f"Use a warm, natural salutation such as 'Good morning, {listener_name}.' — calm and premium, not stiff."
        ),
        "afternoon": (
            "Their device clock shows afternoon (12:00–17:59 local). "
            f"Use a relaxed salutation such as 'Good afternoon, {listener_name}.' — conversational, not corporate."
        ),
        "evening": (
            "Their device clock shows evening or late night (18:00–23:59, or before 05:00). "
            f"Use an easy salutation such as 'Good evening, {listener_name}.' — unhurried and welcoming."
        ),
    }[tod]

    user_prompt = (
        f"Listener name: {listener_name}\n"
        f"Occupation: {occupation}\n"
        f"Investor type (canonical profile for this generation): {canonical_investor}\n"
        f"{legacy_investor_note}"
        f"{investor_persona}\n"
        f"App use mode: {app_use}\n"
        f"Notification time: {notification_time}\n"
        f"General news category / focus area: {focus_area_label(general_category)}\n"
        f"Target audio length: about {target_minutes} minutes at normal speech pace.\n"
        f"The spoken script alone MUST land near ~{words_target} words (hard minimum ~{words_low}; aim up to ~{words_high}). "
        "This is non-negotiable: the audio player expects a full briefing of the requested length. "
        "Write complete spoken paragraphs the listener will hear — not bullet points, not a recap, not a log-line. "
        "If headlines are thin, deepen sourced macro and category context, explain links between stories, and give "
        "proportionate watchlist coverage without inventing facts or filler phrases.\n"
        f"Time-of-day for this request (from the listener's browser clock): {tod}.\n"
        f"{tod_guidance}\n\n"
        "Portfolio (these watchlist securities — up to five):\n"
        + "\n".join([f"- {item.ticker} ({item.asset_type})" for item in portfolio])
        + "\n\n"
        "Watchlist session snapshot (regular session; only includes reliable Finnhub quote figures; never guess):\n"
        + ("\n".join([f"- {line}" for line in quote_lines]) if quote_lines else "- No reliable quote figures were returned.\n")
        + "\n\n"
        "Spoken script — prices and session moves (news claims still carry [Sx] tags as usual):\n"
        "- Only mention last traded price and/or the session move when the snapshot gives usable numbers. "
        "Keep it to one crisp clause, woven into context — not a table read.\n"
        "- If a price or move is absent, say nothing about that figure; continue with sourced news or skip the name "
        "if there is nothing material.\n"
        "- Never apologise or reference technical limitations.\n"
        "- Do not read snapshot lines verbatim; vary cadence; stay informational, not advisory.\n\n"
        "Cross-cutting editorial rules for company and watchlist content (sources only; the investor-type profile "
        "governs emphasis, ordering, and how much context to give):\n"
        "- Lead with what matters for this listener's profile: earnings, material share-price moves backed by "
        "sources, analyst actions, product launches, partnerships, regulatory or legal developments, sector trends, "
        "management commentary, macro linkages, catalysts, flows, sentiment, or durable fundamentals — as the "
        "investor-type profile prioritises.\n"
        "- Quality over coverage: do not force a section for every ticker. If a name has no meaningful sourced story, "
        "omit it from the spoken script or mention it in passing in a single short clause — never pad with "
        "hypotheticals or 'no major updates' boilerplate.\n"
        "- Group thinner items into a brief 'quick hits' passage rather than dragging each one out.\n"
        "- Spend more airtime on genuinely important developments; keep weaker stories proportionately short.\n"
        "- Avoid repeated stock phrases about nothing happening; avoid filler added only to extend length.\n\n"
        "Spoken script — shape (flexible, not a rigid checklist; pacing and macro versus names follow the "
        "investor-type profile):\n"
        "- Open with salutation + name, then a tight framing of what matters in markets or the category today.\n"
        "- Develop the watchlist and company angle where sources justify it, with depth and urgency matched to the "
        "investor-type profile.\n"
        "- Weave in wider context from sources where it clarifies the picture.\n"
        "- A concise read on the listener's selected general news category when sources support it.\n"
        "- Close with a calm forward view (what to watch) without recommendation language.\n"
        "- The separate \"goodbye\" field is a short sign-off for the notes UI; the script should still feel complete "
        "when read alone.\n\n"
        "Return ONE JSON object (no markdown fences) with exactly these keys:\n"
        '- greeting: string — one short salutation line with their name (matches time of day).\n'
        "- security_impact_notes: array of objects "
        '{"ticker","asset_type","update","why_it_matters","sentiment"} — include at most one object per watchlist '
        "ticker, and only where there is material sourced information worth a note. Omit tickers with nothing "
        "meaningful to say; fewer than five entries is correct when the news flow is thin. "
        "update and why_it_matters are for the written notes UI (tight, investor-focused, British English); "
        "they must not invent facts beyond sources.\n"
        '- general_news_notes: array of strings — concise bullets for the notes UI (British English).\n'
        '- show_notes_summary: array of strings — short headline bullets for the notes UI only; NOT the audio.\n'
        '- quote_of_day: string — British English; reflective, not trite.\n'
        "- episode_title: string — exactly 5–8 words (use an ampersand for \"and\" where natural); "
        "a punchy headline summarising today's three biggest stories for the player card — not a full sentence.\n"
        '- portfolio_insights: array of exactly 2 objects {"text","tone"} — one sentence each for the home '
        'insight card; tone "positive" for gains/tailwinds (watchlist price moves or constructive news), '
        '"alert" for notable events, approvals, earnings focus, or risks worth watching; British English; '
        "lead with ticker when relevant.\n"
        '- goodbye: string — one warm sign-off line, British English.\n'
        "- script: string — **ONLY** the full words read aloud for text-to-speech. You MUST deliver roughly "
        f"{words_target} words (minimum ~{words_low}, up to ~{words_high}). "
        "It is NOT a title, NOT a log-line, NOT a description of what you would say, and NOT a placeholder. "
        "Under-length scripts fail validation. Write the actual narration the listener hears, with [Sx] tags on "
        "factual claims from Sources.\n\n"
        "Constraints:\n"
        "- Keep tone non-advisory, digestible, and professional; British English throughout. Pace and energy follow "
        "the investor-type profile — still never hypey or robotic.\n"
        "- Must include source tags [Sx] in script for factual claims drawn from Sources.\n"
        "- If evidence is thin or conflicting, acknowledge it briefly in plain language — do not dwell on "
        "methodology or weaken the whole brief with meta-commentary.\n"
        "- Do not mention each watchlist name by rote; only where sources or the snapshot add real information.\n"
        "- The \"greeting\" field must be a single short line matching the time of day (morning / afternoon / evening) "
        "and using their name.\n"
        "- The spoken \"script\" must open in the same register: same time-of-day salutation and name in the first "
        "sentence, warm and natural, then flow into the market story without repeating that salutation again.\n\n"
        f"Sources:\n{source_block}\n"
    )
    if script_length_retry:
        user_prompt += (
            "\n\nLENGTH RETRY (mandatory): Your previous script was too short. "
            f"The \"script\" field alone must be at least ~{words_low} words of continuous spoken narration "
            f"(target ~{words_target}). Expand every section with sourced detail and natural transitions. "
            "Do not shorten other JSON fields at the expense of the script.\n"
        )
        logger.warning(
            "generate_daily_brief_script_length_retry words_low=%s words_target=%s",
            words_low,
            words_target,
        )

    client = OpenAI(api_key=settings.openai_api_key)
    create_kwargs: dict = {
        "model": settings.summary_model,
        "input": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "max_output_tokens": _DAILY_BRIEF_MAX_OUTPUT_TOKENS,
        "text": {"format": {"type": "json_object"}, "verbosity": "medium"},
    }
    try:
        response = client.responses.create(**create_kwargs)
    except BadRequestError as exc:
        logger.warning(
            "daily_brief_responses_create_json_object_rejected retrying verbosity_only err=%s",
            exc,
        )
        create_kwargs["text"] = {"verbosity": "medium"}
        response = client.responses.create(**create_kwargs)
    _log_response_incomplete(response, "generate_daily_brief")
    raw_text = _collect_output_text(response) or "{}"
    logger.info(
        "generate_daily_brief_model_output chars=%s status=%s incomplete=%s",
        len(raw_text),
        getattr(response, "status", None),
        getattr(response, "incomplete_details", None),
    )
    payload = _extract_json(raw_text)
    script = payload.get("script", "").strip()
    if not isinstance(script, str):
        raise ValueError("Model returned non-string script")
    logger.info(
        "generate_daily_brief_parsed_script chars=%s words=%s",
        len(script),
        len(script.split()),
    )
    payload["script"] = script
    payload["greeting"] = payload.get("greeting", "").strip() or _default_greeting_line(listener_name, tod)
    payload["goodbye"] = payload.get("goodbye", "Thanks for listening — speak soon.")
    payload["quote_of_day"] = payload.get("quote_of_day", "Small steps, consistently taken, compound.")
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

    raw_insights = payload.get("portfolio_insights") or []
    sanitized_insights: list[PortfolioInsight] = []
    for row in raw_insights[:2]:
        try:
            sanitized_insights.append(PortfolioInsight.model_validate(row))
        except Exception:
            continue
    payload["portfolio_insights"] = [n.model_dump() for n in sanitized_insights]

    episode_title = str(payload.get("episode_title") or "").strip()
    payload["episode_title"] = episode_title

    used_source_ids = [sid for sid in citations if sid in script]
    if not used_source_ids:
        used_source_ids = list(citations.keys())[:10]

    note_ticker_set = {
        str(n.ticker).strip().upper()
        for n in sanitized_notes
        if getattr(n, "ticker", None)
    }

    cited_set = set(used_source_ids)
    portfolio_extra: list[str] = []
    for sid, article in source_lookup.items():
        if sid in cited_set:
            continue
        if not article_is_relevant(article, portfolio, resolved_focus_categories):
            continue
        tag, _, _ = _assign_article_tags(
            article,
            portfolio,
            focus_categories=resolved_focus_categories,
            general_category=general_category,
            script=script,
            source_id=sid,
            note_tickers=note_ticker_set,
        )
        if tag and tag != "Macro":
            portfolio_extra.append(sid)
    if portfolio_extra:
        used_source_ids = used_source_ids + portfolio_extra[:12]

    top_headline = ""
    summary_lines = payload.get("show_notes_summary") or []
    if summary_lines:
        top_headline = str(summary_lines[0]).strip().lower()

    source_links = _build_enriched_source_links(
        used_source_ids,
        source_lookup,
        portfolio=portfolio,
        general_category=general_category,
        focus_categories=resolved_focus_categories,
        top_story_headline=top_headline,
        script=script,
        note_tickers=note_ticker_set,
    )
    return payload, source_links


def _sentence_case_headline(title: str) -> str:
    t = (title or "").strip()
    if not t:
        return ""
    lower = t.lower()
    return lower[0].upper() + lower[1:] if len(lower) > 1 else lower.upper()


def _source_domain_from_url(url: str) -> str:
    try:
        host = urlparse(url).netloc.lower()
        return host[4:] if host.startswith("www.") else host
    except Exception:
        return ""


def _article_word_count(article: Article) -> int:
    text = " ".join(
        part for part in (article.title, article.description, article.content) if part and str(part).strip()
    )
    if not text.strip():
        return 0
    return len(text.split())


def _assign_article_tags(
    article: Article,
    portfolio: list[PortfolioSecurity],
    *,
    general_category: str = "macro",
    focus_categories: list[str] | None = None,
    script: str = "",
    source_id: str = "",
    note_tickers: set[str] | None = None,
) -> tuple[str, str, str]:
    """Return (relevance_tag, filter category, focus_category label)."""
    cats = focus_categories or [general_category]

    if article.portfolio_ticker:
        return article.portfolio_ticker, "portfolio", ""
    if article.focus_category:
        return "Macro", "macro", focus_category_label_for_article(article)

    by_ticker = {item.ticker.upper(): item.ticker for item in portfolio}
    title = article.title or ""

    if article_qualifies_as_portfolio(article, portfolio):
        for raw in article.related_tickers or []:
            key = (raw or "").strip().upper()
            if key in by_ticker:
                return by_ticker[key], "portfolio", ""
        for item in portfolio:
            if headline_mentions_ticker_or_company(title, item.ticker):
                return item.ticker, "portfolio", ""

    matched = matching_focus_categories(article, cats)
    if matched:
        return "Macro", "macro", focus_area_label(matched[0])

    cat_key = normalize_focus_area_key(general_category)
    if article_matches_category_feed(article, cat_key):
        return "Macro", "macro", focus_area_label(cat_key)

    return "", "", ""


def _build_enriched_source_links(
    source_ids: list[str],
    source_lookup: dict[str, Article],
    *,
    portfolio: list[PortfolioSecurity],
    general_category: str = "macro",
    focus_categories: list[str] | None = None,
    top_story_headline: str,
    script: str = "",
    note_tickers: set[str] | None = None,
) -> list[SourceLink]:
    cats = focus_categories or [general_category]
    seen_urls: set[str] = set()
    links: list[SourceLink] = []
    top_story_assigned = False

    for sid in source_ids:
        article = source_lookup.get(sid)
        if not article or not article.url or article.url in seen_urls:
            continue
        if not article_is_relevant(article, portfolio, cats):
            continue
        seen_urls.add(article.url)

        relevance_tag, category, focus_category = _assign_article_tags(
            article,
            portfolio,
            general_category=general_category,
            focus_categories=cats,
            script=script,
            source_id=sid,
            note_tickers=note_tickers,
        )
        if not relevance_tag:
            continue
        normalized = _sentence_case_headline(article.title)
        wc = _article_word_count(article)

        is_top = False
        if not top_story_assigned and is_reputable_established_source(article):
            if top_story_headline:
                title_lower = (article.title or "").strip().lower()
                if top_story_headline[:48] in title_lower or title_lower[:48] in top_story_headline:
                    is_top = True
            elif not links:
                is_top = True
            if is_top:
                top_story_assigned = True

        links.append(
            SourceLink(
                source_id=sid,
                title=article.title,
                headline_normalized=normalized,
                source=article.source,
                url=article.url,
                published_at=article.published_at,
                source_domain=_source_domain_from_url(article.url),
                word_count=wc if wc > 0 else None,
                category=category,
                relevance_tag=relevance_tag,
                focus_category=focus_category,
                is_top_story=is_top,
            )
        )

    if links and not top_story_assigned:
        for idx, link in enumerate(links):
            article = source_lookup.get(link.source_id)
            if article and is_reputable_established_source(article):
                links[idx] = link.model_copy(update={"is_top_story": True})
                top_story_assigned = True
                break

    return links


def synthesize_audio(script: str) -> str:
    settings = get_settings()
    client = OpenAI(api_key=settings.openai_api_key)
    tts_chars = len(script)
    tts_words = len(script.split())
    logger.info("tts_synthesize_input chars=%s words=%s", tts_chars, tts_words)
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
