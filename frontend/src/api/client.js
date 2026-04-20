import { requestJson } from "./http.js";

/** @returns {Promise<{ status: string }>} */
export function getHealth() {
  return requestJson("/health");
}

// ===== AUTH ENDPOINTS =====

/**
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{ access_token, token_type, user_id }>}
 */
export function registerUser(username, password) {
  return requestJson("/auth/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username, password }),
  });
}

/**
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{ access_token, token_type, user_id }>}
 */
export function loginUser(username, password) {
  return requestJson("/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username, password }),
  });
}

/**
 * Get user profile by user_id
 * @param {string} user_id
 * @returns {Promise<{ user_id, username, identity_pubkey }>}
 */
export function getUserPublicKey(user_id) {
  return requestJson(`/auth/users/${user_id}`);
}

/**
 * Get user by username
 * @param {string} username
 * @returns {Promise<{ user_id, username, identity_pubkey }>}
 */
export function getUserByUsername(username) {
  return requestJson(`/auth/users/by-username/${encodeURIComponent(username)}`);
}

// ===== PREKEY ENDPOINTS =====

/**
 * Register or refresh the current device public key
 * @param {string} device_id
 * @param {string} pubkey
 * @param {string} token - JWT token
 * @returns {Promise<{ key_id, user_id, device_id, pubkey, is_active }>}
 */
export function registerDeviceKey(device_id, pubkey, token) {
  return requestJson("/prekeys/register", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ device_id, pubkey }),
  });
}

/**
 * Fetch active device public keys for a user
 * @param {string} user_id
 * @returns {Promise<{ user_id, keys: Array<{ key_id, user_id, device_id, pubkey, is_active }> }>}
 */
export function fetchUserDeviceKeys(user_id) {
  return requestJson(`/prekeys/fetch/${user_id}`);
}

// ===== MESSAGE ENDPOINTS =====

/**
 * Create a conversation
 * @param {Array<string>} participant_ids
 * @param {string} token
 * @returns {Promise<{ conv_id, created_at }>}
 */
export function createConversation(participant_ids, token) {
  return requestJson("/messages/conversations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ participant_ids }),
  });
}

/**
 * Get conversation
 * @param {string} conv_id
 * @param {string} token
 * @returns {Promise<{ conv_id, created_at }>}
 */
export function getConversation(conv_id, token) {
  return requestJson(`/messages/conversations/${conv_id}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

/**
 * List user's conversations
 * @param {string} token
 * @returns {Promise<Array<{ conv_id, created_at }>>}
 */
export function listConversations(token) {
  return requestJson("/messages/conversations", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

/**
 * Post encrypted message
 * @param {string} conv_id
 * @param {number} message_index
 * @param {Array<{ device_id: string, sender_device_id: string, ciphertext: string, tag: string, iv: string, target_user_id?: string }>} ciphertexts
 * @param {string} token
 * @returns {Promise<{ m_id, conv_id, sender_id, timestamp, message_index, ciphertexts }>}
 */
export function postMessage(token, conv_id, message_index, ciphertexts) {
  return requestJson("/messages/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ conv_id, message_index, ciphertexts }),
  });
}

/**
 * Get messages from conversation
 * @param {string} conv_id
 * @param {number} skip
 * @param {number} limit
 * @param {string} token
 * @returns {Promise<Array<{ m_id, conv_id, sender_id, timestamp, message_index, ciphertexts }>>}
 */
export function getMessages(conv_id, skip = 0, limit = 100, token) {
  const params = new URLSearchParams({ skip, limit });
  return requestJson(`/messages/messages/${conv_id}?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}
