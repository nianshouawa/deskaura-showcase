"""Public request and response models for memory storage."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

MemoryCategory = Literal["preferences", "relationship", "important_events", "emotional_patterns", "interests"]

class ConversationIn(BaseModel):
    """A completed user and companion conversation turn."""
    user_message: str = Field(min_length=1, max_length=4000)
    ai_message: str = Field(min_length=1, max_length=4000)
    session_id: str = Field(default="default", max_length=128)
    user_emotion: str | None = Field(default=None, max_length=32)
    role_id: str = Field(default="default", min_length=1, max_length=128)

class MemoryItem(BaseModel):
    """A retrieved or stored long-term memory."""
    id: int
    category: MemoryCategory
    content: str
    confidence: float
    created_at: datetime

class RelationshipUpdate(BaseModel):
    """An auditable relationship-score adjustment."""
    delta: int = Field(ge=-10, le=10)
    reason: str = Field(min_length=1, max_length=200)
    role_id: str = Field(default="default", min_length=1, max_length=128)

class InteractionIn(BaseModel):
    """User interaction data used by relationship rules."""
    message: str = Field(min_length=1, max_length=4000)
    user_emotion: str | None = Field(default=None, max_length=32)
    role_id: str = Field(default="default", min_length=1, max_length=128)
