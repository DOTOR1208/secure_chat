import { requestJson } from "./http.js";

/** @returns {Promise<{ status: string }>} */
export function getHealth() {
  return requestJson("/health");
}
