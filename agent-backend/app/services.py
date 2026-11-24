"""HTTP clients with explicit timeouts and graceful caller-controlled failure."""
import os
import httpx
from .config import normalized_role


def role_headers() -> dict[str, str]:
    return {"X-DeskAura-Role": normalized_role()}


class MotionServiceError(RuntimeError):
    """Only fixed public messages cross the motion-service boundary."""

    def __init__(self, code: str, detail: str | None = None):
        messages = {
            'automatic_duration_unavailable': '云端原生时长预测器 Text2MotionPrompter 不可用',
            'automatic_duration_failed': '云端原生时长预测器 Text2MotionPrompter 运行失败',
            'duration_prediction_failed': '动作时长预测失败，请检查对话模型配置，或改用手动时长',
        }
        self.code = code
        provider_detail = (
            code in {'tencent_generation_failed', 'generation_failed'} and
            isinstance(detail, str) and bool(detail.strip()) and
            not any(mark in detail.lower() for mark in ('bearer ', 'api key:', 'authorization:'))
        )
        self.detail = (detail[:300] if provider_detail
                       else messages.get(code, '在线动作生成失败，请检查云端连接'))
        super().__init__(self.detail)

class MemoryClient:
    async def delete_role(self, role_id: str) -> None:
        from urllib.parse import quote
        async with httpx.AsyncClient(timeout=15, trust_env=False,
                                     headers={"X-DeskAura-Role": role_id}) as client:
            response = await client.delete(f'{self.base_url}/api/memory/roles/{quote(role_id, safe="")}')
            response.raise_for_status()

    async def delete_session(self, session_id: str) -> None:
        from urllib.parse import quote
        async with httpx.AsyncClient(timeout=5, trust_env=False, headers=role_headers()) as client:
            response = await client.delete(f'{self.base_url}/api/memory/sessions/{quote(session_id, safe="")}')
            response.raise_for_status()
    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = base_url or os.getenv("MEMORY_SERVICE_URL", "http://127.0.0.1:8001")
    async def get_context(self, query: str, top_k: int = 8) -> str:
        async with httpx.AsyncClient(timeout=30, trust_env=False, headers=role_headers()) as client:
            response = await client.get(f"{self.base_url}/api/memory/search", params={"query": query, "top_k": top_k})
            response.raise_for_status()
            return "\n".join(f"- {item['content']}" for item in response.json()["memories"])
    async def relationship(self) -> dict:
        async with httpx.AsyncClient(timeout=5, trust_env=False, headers=role_headers()) as client:
            response = await client.get(f"{self.base_url}/api/memory/status")
            response.raise_for_status()
            return response.json()
    async def add_conversation(self, user_message: str, ai_message: str, session_id: str, user_emotion: str | None) -> None:
        async with httpx.AsyncClient(timeout=120, trust_env=False, headers=role_headers()) as client:
            response = await client.post(f"{self.base_url}/api/memory/conversations", json={"user_message": user_message, "ai_message": ai_message, "session_id": session_id, "user_emotion": user_emotion})
            response.raise_for_status()
    async def update_relationship(self, delta: int, reason: str) -> dict:
        async with httpx.AsyncClient(timeout=5, trust_env=False, headers=role_headers()) as client:
            response = await client.post(f"{self.base_url}/api/memory/relationship", json={"delta": delta, "reason": reason})
            response.raise_for_status()
            return response.json()
    async def record_interaction(self, message: str, user_emotion: str | None) -> dict:
        async with httpx.AsyncClient(timeout=5, trust_env=False, headers=role_headers()) as client:
            response = await client.post(f"{self.base_url}/api/memory/interaction", json={"message": message, "user_emotion": user_emotion})
            response.raise_for_status()
            return response.json()
    async def proactive_messages(self) -> list[dict]:
        async with httpx.AsyncClient(timeout=5, trust_env=False, headers=role_headers()) as client:
            response = await client.get(f"{self.base_url}/api/memory/proactive")
            response.raise_for_status()
            return response.json()["messages"]

class MotionClient:
    async def emotion_loop(self, emotion: str) -> dict:
        async with httpx.AsyncClient(timeout=5, trust_env=False, headers=role_headers()) as client:
            response = await client.get(f"{self.base_url}/api/motion/emotion/{emotion}")
            response.raise_for_status()
            return response.json()["motion"]

    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = base_url or os.getenv("MOTION_SERVICE_URL", "http://127.0.0.1:8002")
    async def route(self, prompt: str, priority: str = "low", duration: float | None = None, mode: str = 'hybrid', local_duration: float | None = None) -> dict:
        # 注意：云端 HY-Motion 生成可能耗时 10-60 秒，超时必须放宽到足够久。
        # 若运动服务内部回退了 preset，则几乎秒回，此长超时不会产生额外延迟。
        # Native duration prediction and GPU generation may both take time.
        timeout = float(os.getenv("MOTION_ROUTE_TIMEOUT", "240"))
        body = {"prompt": prompt, "priority": priority, "mode": mode}
        if duration is not None:
            body["duration"] = duration
        if local_duration is not None:
            body['local_duration'] = local_duration
        async with httpx.AsyncClient(timeout=timeout, trust_env=False, headers=role_headers()) as client:
            response = await client.post(f"{self.base_url}/api/motion/generate", json=body)
            if response.is_error:
                try:
                    detail = response.json().get('detail')
                except (ValueError, AttributeError):
                    detail = None
                raise MotionServiceError(
                    response.headers.get('X-DeskAura-Motion-Error', 'generation_failed'),
                    detail if isinstance(detail, str) else None,
                )
            response.raise_for_status()
            return response.json()["motion"]
