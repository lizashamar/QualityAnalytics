"""Claude через официальный SDK anthropic."""
from __future__ import annotations

import anthropic

from .base import LLMClient, LLMError


class AnthropicClient(LLMClient):
    provider = "anthropic"

    def __init__(self, model: str, api_key: str, *, effort: str = "medium", fallbacks: bool = True,
                 max_tokens: int = 16000, base_url: str = ""):
        super().__init__(model)
        if not api_key:
            raise LLMError("Не задан LLM_API_KEY для провайдера anthropic")
        self.client = anthropic.Anthropic(api_key=api_key, base_url=base_url or None, max_retries=2, timeout=300)
        self.effort = effort
        self.fallbacks = fallbacks
        self.max_tokens = max_tokens

    def complete(self, system: str, user: str) -> tuple[str, dict]:
        kwargs = dict(
            model=self.model,
            max_tokens=self.max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        if self.effort:
            kwargs["output_config"] = {"effort": self.effort}
        try:
            if self.fallbacks:
                # Серверный fallback при отказе классификатора: запрос повторяется на подходящей модели.
                resp = self.client.beta.messages.create(**kwargs, betas=["server-side-fallback-2026-07-01"], fallbacks="default")
            else:
                resp = self.client.messages.create(**kwargs)
        except anthropic.AuthenticationError:
            raise LLMError("Anthropic: неверный API-ключ") from None
        except anthropic.PermissionDeniedError:
            raise LLMError("Anthropic: у ключа нет доступа к модели") from None
        except anthropic.NotFoundError:
            raise LLMError(f"Anthropic: модель {self.model} не найдена") from None
        except anthropic.RateLimitError:
            raise LLMError("Anthropic: превышен лимит запросов, повторите позже") from None
        except anthropic.BadRequestError as e:
            raise LLMError(f"Anthropic: некорректный запрос ({e.message})") from None
        except anthropic.APIStatusError as e:
            raise LLMError(f"Anthropic: ошибка сервера {e.status_code}") from None
        except anthropic.APIConnectionError:
            raise LLMError("Anthropic: нет соединения с API") from None

        if resp.stop_reason == "refusal":
            raise LLMError("Модель отказалась отвечать (refusal)")
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
        u = resp.usage
        input_tokens = (u.input_tokens or 0) + (getattr(u, "cache_creation_input_tokens", 0) or 0) + (getattr(u, "cache_read_input_tokens", 0) or 0)
        return text, {"input_tokens": input_tokens, "output_tokens": u.output_tokens or 0,
                      "request_id": getattr(resp, "_request_id", None), "served_by": getattr(resp, "model", self.model)}
