"""Live replies stream prose and prepare motion concurrently, without API calls."""
import asyncio
import json
from types import SimpleNamespace

from app import llm
from app.config import ConfigStore, ModelSettings
from app.graph import CompanionGraph


def test_completed_stream_fields_do_not_guess_or_expose_partial_values():
    prefix = '{"emotion":"happy","motion_needed":false,"motion_prompt":"waves","file_action":null,'
    assert llm.CompanionLLM._stream_fields(prefix)['emotion'] == 'happy'
    assert llm.CompanionLLM._stream_fields('{"local_motion_duration":1') == {}
    assert llm.CompanionLLM._stream_fields('{"text":"part') == {}
    assert llm.CompanionLLM._stream_fields('prose {"emotion":"happy"}') == {}
    assert llm.CompanionLLM._stream_fields('```json\n{"emotion":"happy",')['emotion'] == 'happy'


def test_provider_emits_plan_before_finishing_text(monkeypatch):
    monkeypatch.setenv('LLM_API_KEY', 'not-a-real-key')
    planned, deltas = [], []
    fields = {
        'emotion': 'happy', 'motion_needed': False, 'motion_prompt': 'small open palm gesture',
        'motion_priority': 'low', 'file_action': None, 'system_action': None,
        'media_request': None, 'gaze_target': 'face',
    }
    class Stream:
        async def __aiter__(self):
            fragments = [json.dumps(fields)[:-1] + ',"text":"', '第一句。', '第二句。"}']
            for index, fragment in enumerate(fragments):
                if index == 1:
                    assert planned and not deltas
                if index == 2:
                    assert deltas == ['第一句。']
                yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=fragment))])
        async def close(self):
            pass
    async def create(**kwargs):
        assert kwargs['stream']
        return Stream()
    monkeypatch.setattr(llm, 'AsyncOpenAI', lambda **kw: SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))))
    async def run():
        async def plan(value):
            planned.append(value)
        async def delta(text):
            deltas.append(text)
        reply, _ = await llm.CompanionLLM().respond('hi', '', {}, [], on_delta=delta, on_plan=plan)
        assert ''.join(deltas) == reply['text'] == '第一句。第二句。'
        assert len(planned) == 1 and planned[0]['emotion'] == 'happy'
    asyncio.run(run())


def test_graph_motion_starts_while_reply_is_still_streaming_and_cancel_cleans_it(tmp_path, monkeypatch):
    monkeypatch.setenv('SESSION_DATABASE_PATH', str(tmp_path / 'sessions.db'))
    graph = CompanionGraph()
    motion_started, finish_reply, cancel_seen = asyncio.Event(), asyncio.Event(), []
    async def context(_):
        return {'context': '', 'relationship': {}}
    async def reply(_, on_delta=None, on_plan=None):
        await on_plan({'text': '', 'emotion': 'happy'})
        await motion_started.wait()
        await on_delta('第一句')
        await finish_reply.wait()
        return {'response': {'text': '第一句', 'emotion': 'happy'}}
    async def motion(_):
        motion_started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancel_seen.append(True)
    monkeypatch.setattr(graph, '_context', context)
    monkeypatch.setattr(graph, '_reply', reply)
    monkeypatch.setattr(graph, '_motion', motion)
    async def run():
        stream = graph.stream('你好', 'qa', None)
        assert (await anext(stream)) == {'type': 'delta', 'text': '第一句'}
        await stream.aclose()
    asyncio.run(run())
    assert cancel_seen == [True]


def test_ordinary_code_explanation_streams_but_file_operations_are_guarded():
    assert not CompanionGraph._tool_turn_requested('桌面程序的界面设计和代码结构是什么')
    assert not CompanionGraph._tool_turn_requested('请解释一下代码里的异常')
    assert CompanionGraph._tool_turn_requested('读取目录里的文件')
    assert CompanionGraph._tool_turn_requested('请看一下我的屏幕')
    assert CompanionGraph._tool_turn_requested('运行命令')


def test_unknown_emotion_uses_normal_reply_and_failed_specific_emotion_retries_normal(tmp_path, monkeypatch):
    monkeypatch.setenv('SESSION_DATABASE_PATH', str(tmp_path / 'sessions.db'))
    monkeypatch.setattr('app.config.keyring.get_password', lambda *_: '')
    graph = CompanionGraph()
    graph.config_store = ConfigStore(str(tmp_path / 'settings.json'))
    graph.config_store.save(ModelSettings(motion_mode='hybrid'))
    calls = []
    async def emotion(value):
        calls.append(value)
        if value == 'angry':
            raise RuntimeError('not available')
        return {'id': 'cloud_emotion_' + value, 'kind': 'hymotion'}
    monkeypatch.setattr(graph.motion, 'emotion_loop', emotion)
    async def run():
        first = await graph._motion({'response': {'emotion': 'not-known'}, 'relationship': {}})
        second = await graph._motion({'response': {'emotion': 'angry'}, 'relationship': {}})
        assert first['motion']['id'] == second['motion']['id'] == 'cloud_emotion_neutral'
    asyncio.run(run())
    assert calls == ['neutral', 'angry', 'neutral']
