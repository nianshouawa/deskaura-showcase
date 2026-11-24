import asyncio

from app.ollama import OllamaMotionPlanner


def test_ollama_falls_back_when_unavailable():
    planner = OllamaMotionPlanner("http://127.0.0.1:1", "missing")
    assert asyncio.run(planner.rewrite("开心地挥手")) == "开心地挥手"
