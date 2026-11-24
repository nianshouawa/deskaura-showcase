import asyncio
import json
from types import SimpleNamespace

from app.config import ConfigStore
from app.graph import CompanionGraph
from app.llm import CompanionLLM, OFFENDED_BLOCK
from app.session_store import SessionStore


def test_offline_demo_keeps_offended_attitude(monkeypatch):
    monkeypatch.delenv('LLM_API_KEY', raising=False)
    monkeypatch.setenv('LLM_PROVIDER', 'openai')
    async def run():
        deltas = []
        async def delta(text):
            deltas.append(text)
        response, demo = await CompanionLLM().respond('你好', '', {}, [], True, on_delta=delta)
        assert demo and response['emotion'] == 'angry'
        assert '生气' in ''.join(deltas) and '你好呀' not in response['text']
        assert not response['offended_cleared']
    asyncio.run(run())


def test_current_offense_reaches_provider_after_old_friendly_history(monkeypatch):
    monkeypatch.setenv('LLM_API_KEY', 'test-only-not-real')
    requests = []
    class Client:
        def __init__(self, **kwargs):
            self.chat = SimpleNamespace(completions=self)
        async def create(self, **kwargs):
            requests.append(kwargs)
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps({
                'text': '我还在生气，不想聊天。', 'emotion': 'angry', 'offended_cleared': False,
            })))])
    monkeypatch.setattr('app.llm.AsyncOpenAI', Client)
    response, demo = asyncio.run(CompanionLLM().respond('你好', '', {'relationship_level': 5},
        [{'role': 'assistant', 'content': '你好呀，真开心！'}], True))
    messages = requests[0]['messages']
    assert messages[-2] == {'role': 'system', 'content': OFFENDED_BLOCK}
    assert messages[-1]['role'] == 'user'
    assert response['emotion'] == 'angry' and not demo


def test_graph_forwards_durable_offense_and_only_model_forgiveness_clears(tmp_path, monkeypatch):
    monkeypatch.setenv('DESKAURA_CONFIG_PATH', str(tmp_path / 'config.json'))
    monkeypatch.setenv('SESSION_DATABASE_PATH', str(tmp_path / 'sessions.db'))
    monkeypatch.setattr('app.config.keyring.get_password', lambda *args: None)
    graph = CompanionGraph()
    graph.sessions = SessionStore(str(tmp_path / 'history.db'))
    store = ConfigStore(str(tmp_path / 'config.json'))
    store.set_offended(True)
    received = []
    class Memory:
        async def get_context(self, *args): return ''
        async def relationship(self): return {}
        async def add_conversation(self, *args): pass
        async def record_interaction(self, *args): pass
    graph.memory = Memory()
    class LLM:
        async def respond(self, *args, **kwargs):
            received.append(args[4])
            return {'text': '现在不想聊天。', 'emotion': 'angry', 'offended_cleared': False}, False
    graph.llm = LLM()
    async def run():
        state = {'message': '你好', 'session_id': 'test'}
        state.update(await graph._context(state))
        state.update(await graph._reply(state))
        await graph._persist(state)
        assert received == [True] and store.offended()
        state['response']['offended_cleared'] = True
        await graph._persist(state)
        assert not store.offended()
    asyncio.run(run())
