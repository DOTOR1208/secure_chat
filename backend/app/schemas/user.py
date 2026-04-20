from pydantic import BaseModel, Field


class UserRegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=255)
    password: str = Field(..., min_length=6)
    identity_pubkey: str | None = Field(default=None, description="Legacy optional device public key mirror")


class UserLoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str


class UserResponse(BaseModel):
    user_id: str
    username: str
    identity_pubkey: str | None = None

    class Config:
        from_attributes = True
