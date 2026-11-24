"""Optional Ollama adapter for local prompt rewriting and motion intent."""

import os
import re

import httpx


class OllamaMotionPlanner:
    """Turn conversational or Chinese motion descriptions into HY-Motion prompts."""

    def __init__(self, base_url: str | None = None, model: str | None = None) -> None:
        self.base_url = (base_url or os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")).rstrip("/")
        self.model = model or os.getenv("OLLAMA_MODEL", "qwen3.5:4b")

    async def rewrite(self, prompt: str) -> str:
        """Ask Ollama for a concise English humanoid motion prompt."""
        instruction = (
            "Rewrite the input as one concise English full-body humanoid motion prompt "
            "for HY-Motion text-to-motion. Return only the prompt, no quotes or JSON. "
            "Do not describe a scene, camera, clothing, emotion, or multiple people. "
            f"Input: {prompt}"
        )
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                response = await client.post(
                    f"{self.base_url}/api/generate",
                    json={
                        "model": self.model,
                        "prompt": instruction,
                        "stream": False,
                        "think": False,
                    },
                )
                response.raise_for_status()
                value = str(response.json().get("response", "")).strip()
                value = re.sub(r"^```(?:text)?|```$", "", value).strip()
                return value[:500] or prompt
        except (httpx.HTTPError, ValueError, KeyError):
            return prompt
