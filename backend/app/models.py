from sqlalchemy import Column, String, Text, Integer, DateTime, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime

Base = declarative_base()


class User(Base):
    __tablename__ = "Users"
    
    user_id = Column(String(36), primary_key=True)  # UUID v4
    username = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    identity_pubkey = Column(Text, nullable=False, default="")  # Legacy compatibility mirror


class UserDeviceKey(Base):
    __tablename__ = "UserDeviceKeys"
    
    key_id = Column(String(36), primary_key=True)  # UUID v4
    user_id = Column(String(36), ForeignKey("Users.user_id"), nullable=False, index=True)
    device_id = Column(String(128), nullable=False)
    pubkey = Column(Text, nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "device_id", name="uq_user_device_keys_user_device"),
    )


class Conversation(Base):
    __tablename__ = "Conversations"
    
    conv_id = Column(String(36), primary_key=True)  # UUID v4
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


class Participant(Base):
    __tablename__ = "Participants"
    
    user_id = Column(String(36), ForeignKey("Users.user_id"), primary_key=True)
    conv_id = Column(String(36), ForeignKey("Conversations.conv_id"), primary_key=True)
    role = Column(String(64), nullable=False, default="member")
    join_date = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


class Message(Base):
    __tablename__ = "Messages"
    
    m_id = Column(String(36), primary_key=True)  # UUID v4
    conv_id = Column(String(36), ForeignKey("Conversations.conv_id"), nullable=False, index=True)
    sender_id = Column(String(36), ForeignKey("Users.user_id"), nullable=False, index=True)
    timestamp = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, index=True)
    message_index = Column(Integer, nullable=False)
    ciphertext = Column(Text, nullable=False)  # JSON array of device-targeted ciphertext envelopes
    
    __table_args__ = (
        UniqueConstraint("conv_id", "message_index", name="uq_messages_conv_message_index"),
    )
