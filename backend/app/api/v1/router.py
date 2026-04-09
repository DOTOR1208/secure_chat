from fastapi import APIRouter

from app.api.v1.routes import health, websocket

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(websocket.router, tags=["websocket"])
