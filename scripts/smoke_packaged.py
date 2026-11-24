"""Read-only HTTP smoke checks against isolated instances of the packaged sidecar.

Never loads user settings and never calls LLM, TTS or cloud-generation endpoints.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import httpx

ROOT = Path(__file__).resolve().parents[1]
EXE = ROOT / 'companion-frontend/src-tauri/binaries/deskaura-backend/deskaura-backend-x86_64-pc-windows-msvc.exe'

def main():
    data = Path(tempfile.mkdtemp(prefix='packaged-smoke-', dir=ROOT / 'build'))
    runtime = subprocess.run([str(EXE), "self-test", "--data-dir", str(data)],
        env={**os.environ, "DESKAURA_LOCAL_MODELS_DIR": str(ROOT / "companion-frontend/src-tauri/target/release/local-models")},
        stdin=subprocess.DEVNULL, capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW,
        timeout=90, check=True)
    runtime_result = json.loads(runtime.stdout)
    assert all(runtime_result[k] for k in ("memu_runtime", "builtin_embedding", "builtin_hearing", "mcp_runtime"))
    children = []
    with httpx.Client(timeout=8, trust_env=False) as client:
        # Do not interfere with an already-running app.
        for port in (8000, 8001, 8002):
            try:
                client.get(f'http://127.0.0.1:{port}/health')
            except httpx.ConnectError:
                continue
            raise RuntimeError(f'Port {port} is in use; close the app before packaged smoke')
        try:
            for service in ('memory-service', 'motion-service', 'agent-backend'):
                log = (data / f'{service}.log').open('wb')
                child = subprocess.Popen([str(EXE), service, '--data-dir', str(data)],
                    stdin=subprocess.DEVNULL, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
                log.close()
                children.append(child)
            deadline = time.monotonic() + 45
            pending = {8000, 8001, 8002}
            while pending and time.monotonic() < deadline:
                for port in list(pending):
                    try:
                        if client.get(f'http://127.0.0.1:{port}/health').is_success:
                            pending.remove(port)
                    except httpx.HTTPError:
                        pass
                if pending:
                    time.sleep(.2)
            if pending:
                raise RuntimeError(f'Sidecar failed readiness: {pending}; logs: {data}')
            index = client.get('http://127.0.0.1:8002/api/motion/emotions').json()
            assert len(index['emotions']) == 14 and all(e['available'] for e in index['emotions'])
            for entry in index['emotions']:
                spec = client.get('http://127.0.0.1:8002/api/motion/emotion/' + entry['emotion']).json()['motion']
                assert spec['loop'] and not spec['archive_fallback']
                clip = client.get('http://127.0.0.1:8002' + spec['url']).json()
                assert len(clip['poses']) >= 30 and all(len(frame) == 156 for frame in clip['poses'])
                assert abs(len(clip['poses']) / clip['fps'] - clip['duration']) < 1 / clip['fps']
            for ident in ('idle', 'thinking_loop', 'think', 'wave', 'nod', 'bow', 'clap', 'celebrate', 'point', 'shrug'):
                response = client.get('http://127.0.0.1:8002/api/motion/library/cloud_' + ident)
                assert response.is_success
                clip = response.json()
                assert clip['source'] in {'AutoDL HY-Motion-1.0', 'Tencent TokenHub HY-3D-Motion'} and len(clip['poses']) >= 30
            for ident in ('sleep', 'sing', 'sway', 'daydream', 'stretch', 'look_around'):
                response = client.get('http://127.0.0.1:8002/api/motion/library/cloud_standby_' + ident)
                assert response.is_success
                clip = response.json()
                assert clip['source'] == 'Tencent TokenHub HY-3D-Motion'
                assert clip['loop'] is True and len(clip['poses']) == 240
            settings = client.get('http://127.0.0.1:8000/api/settings/model').json()
            assert settings["persona_template"] == "无"
            assert settings["tools_mcp_config"] == {"mcpServers": {}}
            mcp = client.get('http://127.0.0.1:8000/api/tools/mcp').json()
            assert mcp["services"] == [] and mcp["total"] == 0
            assert client.put('http://127.0.0.1:8000/api/tools/mcp/config', json={
                "config": {"mcpServers": {}},
            }).is_success
            assert settings['audio_enabled'] is False and 'audio_api_key' not in settings
            assert settings['gaze_mode'] == 'face' and settings['gaze_enabled'] is True
            assert settings['motion_mode'] == 'hybrid' and settings['execution_enabled'] is False
            for kind in ("persona", "memory", "brain", "tools", "vision", "hearing", "voice", "motion"):
                state = client.get(f'http://127.0.0.1:8000/api/modules/{kind}/status').json()
                assert state["verified"] is False and "detail" in state
            assert client.get('http://127.0.0.1:8000/api/persona/status').json()["verified"] is False
            assert client.post('http://127.0.0.1:8000/api/persona/import?filename=persona.txt',
                               content="角色：测试".encode()).json()["text"] == "角色：测试"
            speech_status = client.get('http://127.0.0.1:8000/api/audio/status').json()
            assert speech_status['status'] == 'ok' and not speech_status['provider_verified']
            assert not speech_status['enabled']
            for kind in ('recognition', 'speech'):
                status = client.get(f'http://127.0.0.1:8000/api/audio/{kind}/status')
                assert status.is_success
                value = status.json()
                assert value['status'] == 'ok' and not value['provider_verified'] and not value['enabled']
            capabilities = client.get('http://127.0.0.1:8000/api/chat/capabilities').json()
            assert capabilities['max_attachments'] == 3 and not capabilities['audio_input']
            assert set(capabilities['image_mime_types']) == {'image/jpeg', 'image/png', 'image/webp'}
            connection = client.get('http://127.0.0.1:8002/api/motion/connection', timeout=12).json()
            assert isinstance(connection['ready'], bool) and 'detail' in connection
            motion_status = client.get('http://127.0.0.1:8002/api/motion/status', timeout=12)
            assert motion_status.is_success
            proof = motion_status.json()
            assert not proof['verified'] and not proof['client_verified']
            assert not client.post('http://127.0.0.1:8002/api/motion/receipt',
                json={'result_id': 'smoke-unknown-proof'}).json()['accepted']
            result = client.post('http://127.0.0.1:8000/api/audio/speech', json={'text': 'hello'})
            assert result.status_code == 409
            asr = client.post('http://127.0.0.1:8000/api/audio/transcribe', content=b'RIFF' + bytes(4) + b'WAVE' + bytes(44), headers={'content-type': 'audio/wav'})
            assert asr.status_code == 409
            # Exercises packaged diagnostic fixture lookup with disabled settings;
            # no provider call or microphone access is made.
            assert client.post('http://127.0.0.1:8000/api/connectivity/recognition/test').status_code == 409
            session = client.post('http://127.0.0.1:8000/api/chat/sessions').json()
            assert client.patch('http://127.0.0.1:8000/api/chat/sessions/' + session['id'], json={'title': 'packaged smoke'}).is_success
            assert client.get('http://127.0.0.1:8000/api/chat/sessions').json()['sessions'][0]['title'] == 'packaged smoke'
            assert client.delete('http://127.0.0.1:8000/api/chat/sessions/' + session['id']).is_success
            assert client.get('http://127.0.0.1:8000/api/chat/sessions').json()['sessions'] == []
            print(json.dumps({'packaged_motions': 30, 'packaged_standby': 6, 'packaged_emotions': 14, 'speech_disabled_status': 409, 'health': 'all three ready', 'logs': str(data)}), flush=True)
        finally:
            for child in children:
                # Explicit owned process IDs only; PyInstaller has a bootloader child.
                if child.poll() is None:
                    subprocess.run(['taskkill', '/PID', str(child.pid), '/T', '/F'], capture_output=True)
                child.wait(timeout=15)

if __name__ == '__main__':
    main()
