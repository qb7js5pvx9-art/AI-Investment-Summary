# AI-Investment-Summary

Quick POC: mobile-first webapp that generates a personalized morning audio brief from portfolio + macro/general news.

## What this POC does

- Accepts an MVP portfolio of exactly 5 securities (stock/ETF/bond labels).
- Lets users choose one general news category (macro, UK politics, sport, tech, energy).
- Pulls overnight portfolio + category articles from NewsAPI.
- Fetches live quote snapshots (price and movement) from Yahoo Finance quote endpoint.
- Builds a neutral, personalized daily script (no buy/sell/hold) and show notes.
- Generates natural voice MP3 audio with OpenAI TTS.
- Exposes a mobile-style web UI and API endpoint for daily brief generation.

## Architecture (mobile-ready + web UI)

- **Backend (this repo):** Python + FastAPI
  - `POST /briefing` legacy script + audio endpoint
  - `POST /daily-brief-mvp` personalized daily brief endpoint
  - `GET /audio/<filename>` serves generated MP3
  - `GET /stocks/search` supports ticker/company autocomplete
  - `GET /` serves a polished browser UI
- **Mobile app (future):** React Native / Flutter client
  - Calls `/briefing`
  - Plays returned `audio_url`

## Requirements

- Python 3.10+
- NewsAPI key
- OpenAI API key

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

If `python3 -m venv` fails because `python3-venv` is missing, install dependencies directly:

```bash
pip3 install --break-system-packages -r requirements.txt
cp .env.example .env
```

Fill `.env`:

```env
OPENAI_API_KEY=your_openai_key
NEWSAPI_KEY=your_newsapi_key
SUMMARY_MODEL=gpt-4.1-mini
TTS_MODEL=gpt-4o-mini-tts
TTS_VOICE=alloy
OUTPUT_DIR=outputs
```

## Run API server

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Open the app UI in your browser:

```bash
http://localhost:8000/
```

Health check:

```bash
curl http://localhost:8000/health
```

Generate the MVP daily brief:

```bash
curl -X POST http://localhost:8000/daily-brief-mvp \
  -H "Content-Type: application/json" \
  -d '{
    "listener_name": "Angus",
    "portfolio": [
      {"ticker": "AAPL", "asset_type": "stock"},
      {"ticker": "MSFT", "asset_type": "stock"},
      {"ticker": "NVDA", "asset_type": "stock"},
      {"ticker": "SPY", "asset_type": "etf"},
      {"ticker": "TLT", "asset_type": "bond"}
    ],
    "general_category": "macro",
    "notification_time": "07:00",
    "wants_alarm_mode": true
  }'
```

Example response (trimmed):

```json
{
  "generated_at": "2026-04-17T07:22:01.101Z",
  "tickers": ["AAPL", "MSFT", "NVDA", "AMZN", "TSLA"],
  "article_count": 24,
  "script": "Good morning... [S1] ...",
  "citations": { "S1": "https://...", "S2": "https://..." },
  "audio_file": "outputs/briefing-20260417-072201-ab12cd34.mp3",
  "audio_url": "/audio/briefing-20260417-072201-ab12cd34.mp3"
}
```

## Run from CLI (no HTTP client needed)

```bash
python3 -m app.cli --tickers AAPL MSFT NVDA AMZN TSLA --hours-back 18 --target-minutes 7
```

## Web UI features included in this POC

- Mobile-first phone layout inspired by native briefing apps
- Notification permission prompt + configurable notification time
- Portfolio builder with ticker/company autocomplete (`/stocks/search`) and asset type selector
- Exactly-5 security MVP validation flow
- One general news category selector
- Daily audio briefing player + download
- Show notes with summary bullets + security impact cards + source links
- Neutrality/financial-disclaimer rules section + iOS shortcut alarm guidance

## Files

- `app/main.py` - FastAPI app
- `app/quotes.py` - market quote lookup for price/movement snapshots
- `app/stocks.py` - stock dataset + ticker/company search logic
- `app/service.py` - end-to-end orchestration
- `app/news.py` - NewsAPI fetch for portfolio + general category
- `app/briefing.py` - script generation (legacy + daily brief) + TTS audio synthesis
- `app/cli.py` - command-line entrypoint
- `app/models.py` - request/response models
- `static/index.html` - web UI markup
- `static/styles.css` - web UI styling
- `static/app.js` - web UI client logic

## Notes and limitations

- This is a **POC**, not investment advice software.
- Hallucination risk is reduced via source-only prompts and citation tags, but not mathematically eliminated.
- Source quality depends on NewsAPI coverage and article quality.
- You can improve quality by:
  - adding a second verification pass that flags uncited claims,
  - storing article snapshots,
  - using a premium financial news source feed,
  - adding speaker style profiles per user.
