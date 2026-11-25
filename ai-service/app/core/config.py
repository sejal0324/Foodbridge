"""Service configuration, validated at startup with pydantic-settings.

Values come from environment variables. For local development the root
``../.env`` and a service-local ``.env`` are also read (later files win, real
environment variables win over both). Missing or invalid required settings stop
the process.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

SERVICE_NAME = "foodbridge-ai"
SERVICE_VERSION = "1.0.0"

LLMProviderName = Literal["none", "gemini", "openai"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        # Empty values in .env (e.g. ``GEMINI_MODEL=``) fall back to defaults.
        env_ignore_empty=True,
        case_sensitive=False,
    )

    internal_service_token: SecretStr = Field(min_length=32)
    llm_provider: LLMProviderName = "none"
    gemini_api_key: SecretStr | None = None
    gemini_model: str = Field(default="gemini-2.5-flash", pattern=r"^[A-Za-z0-9._-]{1,100}$")
    openai_api_key: SecretStr | None = None
    openai_model: str = Field(default="gpt-4.1-mini", pattern=r"^[A-Za-z0-9._:-]{1,100}$")
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    ai_service_port: int = Field(default=8001, ge=1, le=65535)

    # Not read from the environment in practice; overridable in tests.
    max_body_bytes: int = Field(default=1_048_576, ge=1024)
    llm_timeout_s: float = Field(default=30.0, gt=0, le=120)

    @field_validator("log_level", mode="before")
    @classmethod
    def _upper_log_level(cls, value: object) -> object:
        return value.upper() if isinstance(value, str) else value

    @field_validator("llm_provider", mode="before")
    @classmethod
    def _lower_provider(cls, value: object) -> object:
        return value.strip().lower() if isinstance(value, str) else value

    @property
    def llm_configured(self) -> bool:
        """True when the selected provider has an API key."""
        if self.llm_provider == "openai":
            return bool(self.openai_api_key and self.openai_api_key.get_secret_value())
        if self.llm_provider == "gemini":
            return bool(self.gemini_api_key and self.gemini_api_key.get_secret_value())
        return False
