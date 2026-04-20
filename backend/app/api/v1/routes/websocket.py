import json
from typing import Dict, Set
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

# Store active WebSocket connections: {user_id: set[WebSocket]}
active_connections: Dict[str, Set[WebSocket]] = {}


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, Set[WebSocket]] = {}

    async def connect(self, user_id: str, websocket: WebSocket):
        """Register WebSocket connection for user."""
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = set()
        self.active_connections[user_id].add(websocket)

    async def disconnect(self, user_id: str, websocket: WebSocket):
        """Remove WebSocket connection."""
        if user_id in self.active_connections:
            self.active_connections[user_id].discard(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]

    async def broadcast_to_user(self, user_id: str, message: dict):
        """Send message to all connections of a user."""
        if user_id in self.active_connections:
            disconnected = set()
            for connection in self.active_connections[user_id]:
                try:
                    await connection.send_json(message)
                except Exception:
                    disconnected.add(connection)
            
            # Clean up disconnected connections
            for connection in disconnected:
                self.active_connections[user_id].discard(connection)


manager = ConnectionManager()


@router.websocket("/ws/{user_id}")
async def relay_socket(websocket: WebSocket, user_id: str) -> None:
    """
    Real-time message relay (blind relay - ciphertext only).
    
    Expected message format:
    {
        "type": "message",
        "conv_id": "...",
        "message_index": 123,
        "ciphertext": "...",
        "recipient_id": "..." (optional, for direct messages)
    }
    """
    await manager.connect(user_id, websocket)
    
    try:
        while True:
            # Receive encrypted message from client
            data = await websocket.receive_text()
            message = json.loads(data)
            
            # Relay based on message type
            if message.get("type") == "message":
                # In real implementation, you might query database
                # for conversation participants and relay to them
                # For now, we just echo back or relay to specific recipient
                if "recipient_id" in message:
                    await manager.broadcast_to_user(message["recipient_id"], message)
                # Could also relay to all conversation participants
                # by querying Participants table with conv_id
            
    except WebSocketDisconnect:
        await manager.disconnect(user_id, websocket)
    except Exception as e:
        await manager.disconnect(user_id, websocket)

