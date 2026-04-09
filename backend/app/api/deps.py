"""FastAPI dependencies shared by routes."""

from app.core.database import get_db

__all__ = ["get_db"]
