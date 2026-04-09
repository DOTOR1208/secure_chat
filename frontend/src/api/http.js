import { apiUrl } from "../config.js";

export class HttpError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

/**
 * @param {string} path - Path under API_PREFIX (e.g. `/health`)
 * @param {RequestInit} [init]
 */
export async function requestJson(path, init = {}) {
  const url = apiUrl(path);
  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    throw new HttpError(`HTTP ${res.status}`, res.status, data);
  }
  return data;
}
