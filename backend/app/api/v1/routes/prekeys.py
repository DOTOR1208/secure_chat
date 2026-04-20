from uuid import uuid4
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Header
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.security import decode_token
from app.models import User, UserDeviceKey
from app.schemas.prekey import (
    DeviceKeyDirectoryResponse,
    DeviceKeyRegisterRequest,
    DeviceKeyResponse,
)

router = APIRouter()


def get_current_user_id(authorization: Optional[str] = Header(None)) -> str:
    """Extract user_id from JWT token."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization")

    token = authorization[7:]
    payload = decode_token(token)

    if not payload or "user_id" not in payload:
        raise HTTPException(status_code=401, detail="Invalid token")

    return payload["user_id"]


@router.post("/register", response_model=DeviceKeyResponse)
@router.post("/upload", response_model=DeviceKeyResponse)
async def register_device_key(
    request: DeviceKeyRegisterRequest,
    session: AsyncSession = Depends(get_session),
    user_id: str = Depends(get_current_user_id),
):
    """Register or refresh the authenticated user's public key for a specific device."""
    result = await session.execute(
        select(User).where(User.user_id == user_id)
    )
    user = result.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    existing_result = await session.execute(
        select(UserDeviceKey).where(
            UserDeviceKey.user_id == user_id,
            UserDeviceKey.device_id == request.device_id,
        )
    )
    device_key = existing_result.scalars().first()

    if device_key:
        device_key.pubkey = request.pubkey
        device_key.is_active = True
    else:
        device_key = UserDeviceKey(
            key_id=str(uuid4()),
            user_id=user_id,
            device_id=request.device_id,
            pubkey=request.pubkey,
            is_active=True,
        )
        session.add(device_key)

    if not user.identity_pubkey:
        user.identity_pubkey = request.pubkey

    await session.commit()
    await session.refresh(device_key)
    return DeviceKeyResponse.model_validate(device_key)


@router.get("/fetch/{target_user_id}", response_model=DeviceKeyDirectoryResponse)
async def fetch_user_device_keys(
    target_user_id: str,
    session: AsyncSession = Depends(get_session),
):
    """Return all active device public keys for the requested user."""
    user_result = await session.execute(
        select(User).where(User.user_id == target_user_id)
    )
    user = user_result.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    result = await session.execute(
        select(UserDeviceKey)
        .where(UserDeviceKey.user_id == target_user_id)
        .where(UserDeviceKey.is_active == True)
        .order_by(UserDeviceKey.updated_at.desc(), UserDeviceKey.created_at.desc())
    )
    keys = result.scalars().all()

    return DeviceKeyDirectoryResponse(
        user_id=target_user_id,
        keys=[DeviceKeyResponse.model_validate(key) for key in keys],
    )
