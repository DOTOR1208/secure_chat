from pydantic import BaseModel, Field
from datetime import datetime


class EncryptedPayload(BaseModel):
    device_id: str = Field(..., description="Target device identifier")
    sender_device_id: str = Field(..., description="Sender device identifier used to derive the shared secret")
    ciphertext: str = Field(..., description="Base64 encoded ciphertext")
    tag: str = Field(..., description="Base64 encoded AES-GCM authentication tag")
    iv: str = Field(..., description="Base64 encoded AES-GCM IV")
    target_user_id: str | None = Field(default=None, description="Optional target user identifier for fan-out payloads")


class MessagePostRequest(BaseModel):
    conv_id: str
    message_index: int = Field(..., description="Message index used for ordering and IV derivation fallback")
    ciphertexts: list[EncryptedPayload] = Field(
        ...,
        min_items=1,
        description="Device fan-out payloads; each entry is encrypted for one target device"
    )


class MessageResponse(BaseModel):
    m_id: str
    conv_id: str
    sender_id: str
    timestamp: datetime
    message_index: int
    ciphertexts: list[EncryptedPayload] = Field(default_factory=list)

    class Config:
        from_attributes = True


class ConversationCreateRequest(BaseModel):
    participant_ids: list[str] = Field(default_factory=list, description="List of participant user IDs (creator is auto-added)")


class ConversationResponse(BaseModel):
    conv_id: str
    created_at: datetime
    participant_ids: list[str] = Field(default_factory=list)
    participant_usernames: list[str] = Field(default_factory=list)

    class Config:
        from_attributes = True
