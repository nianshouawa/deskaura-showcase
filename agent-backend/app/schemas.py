"""Agent public API models."""
from typing import Literal
from pydantic import BaseModel, Field, model_validator
from .chat_capabilities import MAX_IMAGE_BYTES, validate_image_data_uri

class Attachment(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    kind: Literal['text', 'image'] = 'text'
    content: str = Field(max_length=4 * ((MAX_IMAGE_BYTES + 2) // 3) + 64, repr=False)
    mime_type: str = Field(default='', max_length=32)

    @model_validator(mode='after')
    def valid_content(self):
        if self.kind == 'image':
            validate_image_data_uri(self.content, self.mime_type)
        elif len(self.content) > 12000 or len(self.content.encode('utf-8')) > 48 * 1024 or '\0' in self.content:
            raise ValueError('文本附件最多 48 KB / 12000 字，不能含空字符。')
        return self

class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    session_id: str = Field(default="default", max_length=128)
    role_id: str = Field(default="default", max_length=128)
    user_emotion: str | None = Field(default=None, max_length=32)
    attachments: list[Attachment] = Field(default_factory=list, max_length=3)

class InteractionState(BaseModel):
    offended: bool = False
    role_id: str = Field(default="default", max_length=128)

class MotionSpec(BaseModel):
    id: str
    role_id: str | None = None
    kind: str
    url: str
    duration: float
    loop: bool = False
    emotion: str | None = None
    archive_fallback: bool = False
    generation_error: str | None = None
    reply_motion: bool = False
    playback: Literal['once', 'speech'] = 'once'
    source_duration: float | None = None
    duration_source: str | None = None

class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)

class SystemAction(BaseModel):
    type: str
    app: str | None = None
    url: str | None = None
    command: str | None = None

class ChatResponse(BaseModel):
    verification_id: str | None = None
    text: str
    emotion: str
    motion: MotionSpec
    demo_mode: bool
    system_action: SystemAction | None = None
    file_approval: dict | None = None
    gaze_target: Literal['mouse', 'face'] = 'face'
    capture_action: dict | None = None
    media_request: dict | None = None
