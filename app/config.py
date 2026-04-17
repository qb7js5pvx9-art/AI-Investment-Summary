from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    openai_api_key: str = ""
    newsapi_key: str = ""
    newsapi_base_url: str = "https://newsapi.org/v2/everything"
    output_dir: str = "outputs"

    # LLM / TTS defaults are intentionally configurable.
    summary_model: str = "gpt-4.1-mini"
    tts_model: str = "gpt-4o-mini-tts"
    tts_voice: str = "alloy"

    # extra="ignore" keeps this POC tolerant of unrelated env vars.
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
