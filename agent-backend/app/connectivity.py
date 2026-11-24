"""Short-lived, configuration-bound proofs of an actual client round trip.

No secrets, audio, transcripts or key hashes are sent to the client. A successful
provider response alone is deliberately insufficient for a green status light.
"""
import hashlib
import json
import secrets
import time


class ConnectivityProofs:
    lifetime = 600

    def __init__(self):
        self.records = {}
        self.tickets = {}
        self.revisions = {}

    def _prune(self):
        """Drop expired verification state from long-lived desktop sessions."""
        now = time.time()
        self.tickets = {
            key: item for key, item in self.tickets.items()
            if now - item.get("at", 0) < self.lifetime
        }
        self.records = {
            key: item for key, item in self.records.items()
            if now - item.get("at", 0) < self.lifetime * 2
        }
        if len(self.records) > 256:
            oldest = sorted(self.records, key=lambda key: self.records[key].get("at", 0))
            for key in oldest[:len(self.records) - 256]:
                self.records.pop(key, None)
        if len(self.tickets) > 256:
            oldest = sorted(self.tickets, key=lambda key: self.tickets[key].get("at", 0))
            for key in oldest[:len(self.tickets) - 256]:
                self.tickets.pop(key, None)
        if len(self.revisions) > 512:
            for key in list(self.revisions):
                if key not in self.records:
                    self.revisions.pop(key, None)
                    if len(self.revisions) <= 256:
                        break

    def signature(self, kind, store):
        from .config import normalized_role
        if kind == 'speech':
            value = store.audio_config()
            config = {k: value.get(k) for k in (
                'audio_enabled', 'audio_provider', 'audio_base_url', 'audio_model', 'audio_voice',
                'audio_format', 'audio_speed', 'audio_sample_rate', 'voice_connection_mode', 'api_key')}
        elif kind == 'recognition':
            value = store.asr_config()
            config = {k: value.get(k) for k in (
                'asr_enabled', 'asr_provider', 'asr_base_url', 'asr_model', 'asr_language',
                'api_key', 'hearing_connection_mode', 'hearing_local_provider')}
        elif kind == 'chat':
            value = store.get()
            config = {k: value.get(k) for k in ('base_url', 'model', 'provider', 'chat_image_mode', 'brain_enabled', 'brain_connection_mode')}
            config['key'] = store._get_key()
        elif kind == 'vision':
            from .vision import signature as vision_signature
            config = {"vision_signature": vision_signature(store)}
        else:
            raise ValueError('Unknown verification kind')
        return hashlib.sha256(json.dumps([normalized_role(), config, self.revisions.get(self._record_key(kind), 0)], sort_keys=True).encode()).hexdigest()

    @staticmethod
    def _record_key(kind):
        from .config import normalized_role
        role_id = normalized_role()
        return kind if role_id == "default" else f"{role_id}:{kind}"

    def revoke(self, kind):
        self._prune()
        record_key = self._record_key(kind)
        self.revisions[record_key] = self.revisions.get(record_key, 0) + 1
        self.records.pop(record_key, None)
        self.tickets = {key: item for key, item in self.tickets.items() if item.get("record_key", item["kind"]) != record_key}

    def issue(self, kind, signature):
        self._prune()
        token = secrets.token_urlsafe(24)
        record_key = self._record_key(kind)
        self.tickets = {key: item for key, item in self.tickets.items() if time.time() - item['at'] < self.lifetime and item.get("record_key", item["kind"]) != record_key}
        self.tickets[token] = {'kind': kind, 'record_key': record_key, 'signature': signature, 'at': time.time()}
        self.records[record_key] = {'signature': signature, 'verified': False, 'at': time.time(), 'detail': '接口已返回 · 等待客户端完成验证'}
        return token

    def fail(self, kind, signature, detail='本次全链路未通过，请重新检测'):
        self._prune()
        record_key = self._record_key(kind)
        self.records[record_key] = {'signature': signature, 'verified': False, 'at': time.time(), 'detail': detail}
        self.tickets = {key: item for key, item in self.tickets.items() if item.get("record_key", item["kind"]) != record_key}

    def confirm(self, token, success, store):
        self._prune()
        item = self.tickets.pop(token, None)
        if not item or time.time() - item['at'] >= self.lifetime:
            return False
        kind = item['kind']
        if item['signature'] != self.signature(kind, store):
            return False
        detail = ('全链路已验证 · 音频已完整播放' if kind == 'speech' else '全链路已验证 · 客户端已收到识别文字' if kind == 'recognition' else '全链路已验证 · 摄像头已识别人脸' if kind == 'vision' else '全链路已验证 · 客户端已收到模型回复') if success else '客户端播放或接收失败 · 请重新检测'
        self.records[self._record_key(kind)] = {**item, 'verified': success, 'at': time.time(), 'detail': detail}
        return True

    def status(self, kind, store):
        self._prune()
        item = self.records.get(self._record_key(kind), {})
        matches = item.get('signature') == self.signature(kind, store)
        fresh = matches and time.time() - item.get('at', 0) < self.lifetime
        return {'client_verified': bool(fresh and item.get('verified')),
                'verification_stale': bool(matches and not fresh and item.get('verified')),
                'client_attempted': bool(fresh),
                'client_detail': item.get('detail') if fresh else '尚未完成全链路验证' if not matches else '验证已过期 · 请重新检测',
                'client_verified_at': int(item['at']) if fresh and item.get('verified') else None}
