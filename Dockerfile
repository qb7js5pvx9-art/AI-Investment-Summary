FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install dependencies first to leverage Docker layer caching.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code and web assets.
COPY app ./app
COPY static ./static

# Generated audio output directory (Settings.output_dir defaults to "outputs").
RUN mkdir -p outputs

EXPOSE 8000

# Default: run the FastAPI server (serves the web UI + API).
# Override to use the CLI, e.g.:
#   docker run --rm ai-investment-summary python -m app.cli --tickers AAPL MSFT NVDA
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
