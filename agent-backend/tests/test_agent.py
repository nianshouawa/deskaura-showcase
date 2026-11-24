import asyncio
from types import SimpleNamespace
from app.llm import CompanionLLM


def test_plain_text_model_reply_without_json_mode(monkeypatch):
    captured = {}

    class FakeCompletions:
        async def create(self, **request):
            captured.update(request)
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='你好，我在这里。'))])

    class FakeClient:
        def __init__(self, **kwargs):
            self.chat = SimpleNamespace(completions=FakeCompletions())

    monkeypatch.setenv('LLM_API_KEY', 'test-key')
    monkeypatch.setenv('LLM_PROVIDER', 'openai')
    monkeypatch.setattr('app.llm.AsyncOpenAI', FakeClient)
    result, demo = asyncio.run(CompanionLLM().respond('你好', '', {'relationship_level': 1}, []))
    assert demo is False
    assert result['text'] == '你好，我在这里。'
    assert result['motion_prompt']
    assert 'response_format' not in captured


def test_no_key_is_demo(monkeypatch):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    result, demo = asyncio.run(CompanionLLM().respond("你好", "", {"relationship_level": 1}, []))
    assert demo is True
    assert result["motion_prompt"]


def test_normalizes_invalid_structured_values():
    result = CompanionLLM._normalize({"text": "你好", "emotion": "other", "motion_priority": "urgent"})
    assert result["emotion"] == "neutral"
    assert result["motion_priority"] == "low"


def test_graph_compiles(tmp_path, monkeypatch):
    monkeypatch.setenv("SESSION_DATABASE_PATH", str(tmp_path / "sessions.db"))
    from app.graph import CompanionGraph
    assert CompanionGraph().graph is not None
