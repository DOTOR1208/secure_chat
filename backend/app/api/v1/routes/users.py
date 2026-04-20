from uuid import uuid4

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.security import hash_password, verify_password, create_access_token
from app.models import User
from app.schemas.user import UserRegisterRequest, UserLoginRequest, TokenResponse, UserResponse

router = APIRouter()


@router.post("/register", response_model=TokenResponse)
async def register(
    request: UserRegisterRequest,
    session: AsyncSession = Depends(get_session)
):
    """Register new user and return JWT token."""
    # Check if username already exists
    result = await session.execute(
        select(User).where(User.username == request.username)
    )
    if result.scalars().first():
        raise HTTPException(status_code=400, detail="Username already exists")
    
    # Create new user
    user_id = str(uuid4())
    user = User(
        user_id=user_id,
        username=request.username,
        password_hash=hash_password(request.password),
        identity_pubkey=request.identity_pubkey or ""
    )
    session.add(user)
    await session.commit()
    
    # Generate token
    access_token = create_access_token(data={"sub": user_id})
    return TokenResponse(
        access_token=access_token,
        user_id=user_id
    )


@router.post("/login", response_model=TokenResponse)
async def login(
    request: UserLoginRequest,
    session: AsyncSession = Depends(get_session)
):
    """Login user and return JWT token."""
    result = await session.execute(
        select(User).where(User.username == request.username)
    )
    user = result.scalars().first()
    
    if not user or not verify_password(request.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    # Generate token
    access_token = create_access_token(data={"sub": user.user_id})
    return TokenResponse(
        access_token=access_token,
        user_id=user.user_id
    )


@router.get("/users/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: str,
    session: AsyncSession = Depends(get_session)
):
    """Get user by ID (public profile lookup)."""
    result = await session.execute(
        select(User).where(User.user_id == user_id)
    )
    user = result.scalars().first()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return UserResponse.from_orm(user)


@router.get("/search/{username}", response_model=UserResponse)
async def search_user(
    username: str,
    session: AsyncSession = Depends(get_session)
):
    """Search user by username (public endpoint)."""
    result = await session.execute(
        select(User).where(User.username == username)
    )
    user = result.scalars().first()
    
    if not user:
        raise HTTPException(status_code=404, detail=f"User '{username}' not found")
    
    return UserResponse.from_orm(user)


@router.get("/by-username/{username}", response_model=UserResponse)
async def get_user_by_username(
    username: str,
    session: AsyncSession = Depends(get_session)
):
    """Get user by username (alias for /search)."""
    result = await session.execute(
        select(User).where(User.username == username)
    )
    user = result.scalars().first()
    
    if not user:
        raise HTTPException(status_code=404, detail=f"User '{username}' not found")
    
    return UserResponse.from_orm(user)


@router.get("/users/by-username/{username}", response_model=UserResponse)
async def get_user_by_username(
    username: str,
    session: AsyncSession = Depends(get_session)
):
    """Get user by username for starting a chat."""
    result = await session.execute(
        select(User).where(User.username == username)
    )
    user = result.scalars().first()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return UserResponse.from_orm(user)
