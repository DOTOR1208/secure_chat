/**
 * Central place for API paths. With Vite dev server, `/api` is proxied to FastAPI.
 * Production: serve the SPA and reverse-proxy `/api` and WebSocket to the backend.
 */
export const API_PREFIX = "/api/v1";

export function apiUrl(path) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${API_PREFIX}${p}`;
}

/** WebSocket URL for the relay (dev: same host as Vite; proxied to backend). */
export function relayWebSocketUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${API_PREFIX}/ws`;
}
