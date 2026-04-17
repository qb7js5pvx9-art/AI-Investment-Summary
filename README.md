# AI-Investment-Summary

Quick POC: generate a grounded morning stock-news audio briefing (5-10 minutes) from overnight articles.

## What this POC does

- Accepts a list of stock tickers (e.g. `AAPL MSFT NVDA`).
- Pulls recent articles from NewsAPI for a configurable time window.
- Builds a citation-tagged script using OpenAI (claims are expected to include source tags like `[S3]`).
- Generates natural voice MP3 audio with OpenAI TTS.
- Exposes the output over an HTTP API so a mobile app can request and play the briefing.

## Architecture (mobile-ready + web UI)

- **Backend (this repo):** Python + FastAPI
  - `POST /briefing` creates script + audio
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

Generate a briefing:

```bash
curl -X POST http://localhost:8000/briefing \
  -H "Content-Type: application/json" \
  -d '{
    "tickers": ["AAPL", "MSFT", "NVDA", "AMZN", "TSLA"],
    "hours_back": 18,
    "max_articles": 30,
    "target_minutes": 7
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

- Ticker/company search autocomplete (`/stocks/search`)
- Click-to-add watchlist chips with remove/clear controls
- Briefing configuration controls (hours back, max articles, target minutes)
- One-click generation flow with progress status
- Built-in audio player + MP3 download link
- Script and source citation tabs for review

## Files

- `app/main.py` - FastAPI app
- `app/stocks.py` - stock dataset + ticker/company search logic
- `app/service.py` - end-to-end orchestration
- `app/news.py` - NewsAPI fetch + basic relevance mapping
- `app/briefing.py` - script generation + TTS audio synthesis
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
