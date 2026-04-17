from __future__ import annotations

import argparse
import asyncio
import json

from app.models import BriefingRequest
from app.service import build_briefing


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate a morning stock briefing (script + MP3).")
    parser.add_argument("--tickers", nargs="+", required=True, help="Space-separated list, e.g. AAPL MSFT NVDA")
    parser.add_argument("--hours-back", type=int, default=18)
    parser.add_argument("--max-articles", type=int, default=30)
    parser.add_argument("--target-minutes", type=int, default=7)
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    req = BriefingRequest(
        tickers=args.tickers,
        hours_back=args.hours_back,
        max_articles=args.max_articles,
        target_minutes=args.target_minutes,
    )
    result = await build_briefing(req)
    print(
        json.dumps(
            {
                "generated_at": result.generated_at.isoformat(),
                "tickers": result.tickers,
                "article_count": result.article_count,
                "audio_file": result.audio_file,
                "audio_url": result.audio_url,
                "citations": result.citations,
                "script_preview": result.script[:700],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
