import json
from uuid import uuid4
from typing import Optional
from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends, Header
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.security import decode_token
from app.models import User, Conversation, Participant, Message
from app.api.v1.routes.websocket import manager
from app.schemas.message import (
    EncryptedPayload,
    MessagePostRequest,
    MessageResponse,
    ConversationCreateRequest,
    ConversationResponse
)

router = APIRouter()


def deserialize_ciphertexts(raw_ciphertext: str) -> list[EncryptedPayload]:
    try:
        parsed = json.loads(raw_ciphertext)
    except json.JSONDecodeError:
        return []

    if not isinstance(parsed, list):
        return []

    payloads: list[EncryptedPayload] = []
    for item in parsed:
        if isinstance(item, dict):
            payloads.append(EncryptedPayload(**item))
    return payloads


async def build_conversation_response(
    session: AsyncSession,
    conversation: Conversation,
    current_user_id: str,
) -> ConversationResponse:
    result = await session.execute(
        select(User.user_id, User.username)
        .join(Participant, Participant.user_id == User.user_id)
        .where(Participant.conv_id == conversation.conv_id)
        .order_by(User.username.asc())
    )
    participants = result.all()

    other_participants = [
        {"user_id": participant.user_id, "username": participant.username}
        for participant in participants
        if participant.user_id != current_user_id
    ]

    if not other_participants:
        other_participants = [
            {"user_id": participant.user_id, "username": participant.username}
            for participant in participants
        ]

    return ConversationResponse(
        conv_id=conversation.conv_id,
        created_at=conversation.created_at,
        participant_ids=[participant["user_id"] for participant in other_participants],
        participant_usernames=[participant["username"] for participant in other_participants],
    )


def get_current_user_id(authorization: Optional[str] = Header(None)) -> str:
    """Extract user_id from JWT token."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization")
    
    token = authorization[7:]
    payload = decode_token(token)
    
    if not payload or "user_id" not in payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    return payload["user_id"]


# ========== CONVERSATION ENDPOINTS ==========

@router.post("/conversations", response_model=ConversationResponse)
async def create_conversation(
    request: ConversationCreateRequest,
    session: AsyncSession = Depends(get_session),
    user_id: str = Depends(get_current_user_id)
):
    """Create a new conversation and add participants."""
    participant_ids = list(dict.fromkeys(
        participant_id for participant_id in request.participant_ids
        if participant_id != user_id
    ))

    if not participant_ids:
        raise HTTPException(status_code=400, detail="At least one other participant is required")

    conv_id = str(uuid4())
    
    # Create conversation
    conversation = Conversation(conv_id=conv_id, created_at=datetime.utcnow())
    session.add(conversation)
    
    # Add creator as participant
    creator_participant = Participant(
        user_id=user_id,
        conv_id=conv_id,
        role="creator"
    )
    session.add(creator_participant)
    
    # Add other participants
    for participant_id in participant_ids:
        # Verify participant exists
        result = await session.execute(
            select(User).where(User.user_id == participant_id)
        )
        if not result.scalars().first():
            raise HTTPException(status_code=404, detail=f"User {participant_id} not found")
        
        participant = Participant(
            user_id=participant_id,
            conv_id=conv_id,
            role="member"
        )
        session.add(participant)
    
    await session.commit()
    
    return await build_conversation_response(session, conversation, user_id)


@router.get("/conversations/{conv_id}", response_model=ConversationResponse)
async def get_conversation(
    conv_id: str,
    session: AsyncSession = Depends(get_session),
    user_id: str = Depends(get_current_user_id)
):
    """Get conversation if user is a participant."""
    # Verify user is participant
    result = await session.execute(
        select(Participant).where(
            and_(
                Participant.conv_id == conv_id,
                Participant.user_id == user_id
            )
        )
    )
    if not result.scalars().first():
        raise HTTPException(status_code=403, detail="Not a participant in this conversation")
    
    # Get conversation
    result = await session.execute(
        select(Conversation).where(Conversation.conv_id == conv_id)
    )
    conv = result.scalars().first()
    
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    return await build_conversation_response(session, conv, user_id)


@router.get("/conversations", response_model=list[ConversationResponse])
async def list_conversations(
    session: AsyncSession = Depends(get_session),
    user_id: str = Depends(get_current_user_id)
):
    """List all conversations for authenticated user."""
    result = await session.execute(
        select(Conversation)
        .join(Participant)
        .where(Participant.user_id == user_id)
    )
    conversations = result.scalars().all()
    
    return [
        await build_conversation_response(session, conversation, user_id)
        for conversation in conversations
    ]


# ========== MESSAGE ENDPOINTS ==========

@router.post("/messages", response_model=MessageResponse)
async def post_message(
    request: MessagePostRequest,
    session: AsyncSession = Depends(get_session),
    user_id: str = Depends(get_current_user_id)
):
    """Post encrypted message to conversation."""
    # Verify user is participant
    result = await session.execute(
        select(Participant).where(
            and_(
                Participant.conv_id == request.conv_id,
                Participant.user_id == user_id
            )
        )
    )
    if not result.scalars().first():
        raise HTTPException(status_code=403, detail="Not a participant in this conversation")
    
    # Create message
    m_id = str(uuid4())
    message = Message(
        m_id=m_id,
        conv_id=request.conv_id,
        sender_id=user_id,
        timestamp=datetime.utcnow(),
        message_index=request.message_index,
        ciphertext=json.dumps(
            [payload.model_dump() for payload in request.ciphertexts],
            separators=(",", ":"),
        )
    )
    session.add(message)
    
    try:
        await session.commit()
    except Exception:
        # Handle unique constraint violation on message_index
        raise HTTPException(
            status_code=400, 
            detail="Message index already exists for this conversation"
        )

    participant_result = await session.execute(
        select(Participant.user_id).where(Participant.conv_id == request.conv_id)
    )
    participant_ids = [
        participant_id
        for participant_id in participant_result.scalars().all()
        if participant_id != user_id
    ]

    for participant_id in participant_ids:
        await manager.broadcast_to_user(
            participant_id,
            {
                "type": "new_message",
                "conv_id": request.conv_id,
                "message_index": request.message_index,
                "sender_id": user_id,
            },
        )
    
    return MessageResponse(
        m_id=m_id,
        conv_id=request.conv_id,
        sender_id=user_id,
        timestamp=message.timestamp,
        message_index=request.message_index,
        ciphertexts=request.ciphertexts
    )


@router.get("/messages/{conv_id}", response_model=list[MessageResponse])
async def get_messages(
    conv_id: str,
    skip: int = 0,
    limit: int = 100,
    session: AsyncSession = Depends(get_session),
    user_id: str = Depends(get_current_user_id)
):
    """Get messages from conversation (paginated)."""
    # Verify user is participant
    result = await session.execute(
        select(Participant).where(
            and_(
                Participant.conv_id == conv_id,
                Participant.user_id == user_id
            )
        )
    )
    if not result.scalars().first():
        raise HTTPException(status_code=403, detail="Not a participant in this conversation")
    
    # Get messages
    result = await session.execute(
        select(Message)
        .where(Message.conv_id == conv_id)
        .order_by(Message.timestamp.asc())
        .offset(skip)
        .limit(limit)
    )
    messages = result.scalars().all()
    
    return [
        MessageResponse(
            m_id=m.m_id,
            conv_id=m.conv_id,
            sender_id=m.sender_id,
            timestamp=m.timestamp,
            message_index=m.message_index,
            ciphertexts=deserialize_ciphertexts(m.ciphertext)
        )
        for m in messages
    ]
