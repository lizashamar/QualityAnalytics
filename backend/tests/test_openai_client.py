import httpx
import pytest

from app.llm.base import LLMError, LLMParseError
from app.llm.openai_compat import OpenAICompatClient


def test_strict_request_and_usage(monkeypatch):
    def post(url, **kwargs):
        body = kwargs['json']
        assert body['model'] == 'gpt-6-luna'
        assert body['response_format']['type'] == 'json_schema'
        assert body['response_format']['json_schema']['strict'] is True
        assert body['max_completion_tokens'] == 16000
        assert 'temperature' not in body
        return httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {'content': '{"items": []}'}}],
                                        'usage': {'prompt_tokens': 100, 'completion_tokens': 25}})
    monkeypatch.setattr(httpx, 'post', post)
    data, usage = OpenAICompatClient('gpt-6-luna').complete_json('system', 'user')
    assert data == {'items': []}
    assert usage['input_tokens'] == 100 and usage['output_tokens'] == 25


@pytest.mark.parametrize('message,reason', [({'refusal': 'No'}, 'stop'), ({'content': '{'}, 'length')])
def test_refusal_and_truncation_preserve_usage(monkeypatch, message, reason):
    monkeypatch.setattr(httpx, 'post', lambda *a, **k: httpx.Response(200, json={
        'choices': [{'finish_reason': reason, 'message': message}], 'usage': {'completion_tokens': 10}}))
    with pytest.raises(LLMParseError) as error:
        OpenAICompatClient('gpt-6-luna').complete_json('system', 'user')
    assert error.value.usage['output_tokens'] == 10


def test_schema_error_never_falls_back(monkeypatch):
    calls = []
    def post(*args, **kwargs):
        calls.append(kwargs)
        return httpx.Response(400, text='unsupported response_format')
    monkeypatch.setattr(httpx, 'post', post)
    with pytest.raises(LLMError):
        OpenAICompatClient('gpt-6-luna').complete_json('system', 'user')
    assert len(calls) == 1


def test_invalid_envelope(monkeypatch):
    monkeypatch.setattr(httpx, 'post', lambda *a, **k: httpx.Response(200, text='not JSON'))
    with pytest.raises(LLMError):
        OpenAICompatClient('gpt-6-luna').complete_json('system', 'user')
