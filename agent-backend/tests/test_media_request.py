from app.llm import CompanionLLM
from app.config import ModelSettings, INTERACTION_DEFAULTS

def test_media_request_normalization_bounds_and_legacy():
    for source in ('screen', 'camera'):
        value = CompanionLLM._normalize({'text': '请确认', 'media_request': {'source': source, 'kind': 'record', 'duration': 300}})
        assert value['media_request'] == {'source': source, 'kind': 'record', 'duration': 8}
    assert CompanionLLM._normalize({'capture_action': {'type': 'capture_screen'}})['media_request']['source'] == 'screen'
    assert 'media_request' not in CompanionLLM._normalize({'media_request': {'source': 'hidden', 'kind': 'record'}})
    assert CompanionLLM._normalize({'media_request': {'source': 'camera', 'kind': 'record', 'duration': 'oops'}})['media_request']['duration'] == 4

def test_gaze_defaults_are_face_and_can_be_disabled():
    assert INTERACTION_DEFAULTS['gaze_mode'] == 'face' and INTERACTION_DEFAULTS['gaze_enabled'] is True
    assert ModelSettings(gaze_enabled=False).gaze_enabled is False
