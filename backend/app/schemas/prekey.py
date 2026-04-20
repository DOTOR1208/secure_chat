from pydantic import BaseModel, Field


class DeviceKeyRegisterRequest(BaseModel):
    device_id: str = Field(..., min_length=1, max_length=128)
    pubkey: str = Field(..., description="Base64/JSON encoded public key")


class DeviceKeyResponse(BaseModel):
    key_id: str
    user_id: str
    device_id: str
    pubkey: str
    is_active: bool

    class Config:
        from_attributes = True


class DeviceKeyDirectoryResponse(BaseModel):
    user_id: str
    keys: list[DeviceKeyResponse] = Field(default_factory=list)
