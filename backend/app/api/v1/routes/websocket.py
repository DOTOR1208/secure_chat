from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()


@router.websocket("/ws")
async def relay_socket(websocket: WebSocket) -> None:
    """
    Real-time channel (use WSS in production). Blind relay: routing only; no decryption here.
    """
    await websocket.accept()
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
