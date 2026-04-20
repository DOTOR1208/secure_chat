from fastapi import APIRouter

from app.api.v1.routes import health, websocket, users, prekeys, messages

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(users.router, prefix="/auth", tags=["auth"])
api_router.include_router(prekeys.router, prefix="/prekeys", tags=["prekeys"])
api_router.include_router(messages.router, prefix="/messages", tags=["messages"])
api_router.include_router(websocket.router, tags=["websocket"])
