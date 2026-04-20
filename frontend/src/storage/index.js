/**
 * Storage Module: IndexedDB + LocalStorage
 * 
 * - LocalStorage: Session tokens, user info
 * - IndexedDB: Message history (plaintext decrypted locally)
 */

const DB_NAME = "e2ee_chat";
const DB_VERSION = 1;

let db = null;

/**
 * Initialize IndexedDB
 */
async function initDB() {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Messages object store
      if (!db.objectStoreNames.contains("messages")) {
        const msgStore = db.createObjectStore("messages", { keyPath: "m_id" });
        msgStore.createIndex("conv_id_timestamp", ["conv_id", "timestamp"]);
      }

      // Conversation sessions object store
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "conv_id" });
      }

      // User keys object store (local)
      if (!db.objectStoreNames.contains("keys")) {
        db.createObjectStore("keys", { keyPath: "key_type" });
      }
    };
  });
}

/**
 * Session Management (LocalStorage)
 */

export function saveSession(token, userId, username) {
  localStorage.setItem("auth_token", token);
  localStorage.setItem("user_id", userId);
  localStorage.setItem("username", username);
}

export function getSession() {
  return {
    token: localStorage.getItem("auth_token"),
    userId: localStorage.getItem("user_id"),
    username: localStorage.getItem("username"),
  };
}

export function clearSession() {
  localStorage.removeItem("auth_token");
  localStorage.removeItem("user_id");
  localStorage.removeItem("username");
}

/**
 * Key Storage (LocalStorage - risky but necessary for demo)
 * In production, use device keystore
 */

export function savePrivateKey(privateKeyJwk) {
  localStorage.setItem("private_key", privateKeyJwk);
}

export function getPrivateKey() {
  return localStorage.getItem("private_key");
}

export function saveIdentityPublicKey(pubKeyJwk) {
  localStorage.setItem("identity_pubkey", pubKeyJwk);
}

export function getIdentityPublicKey() {
  return localStorage.getItem("identity_pubkey");
}

export function saveDeviceId(deviceId) {
  localStorage.setItem("device_id", deviceId);
}

export function getDeviceId() {
  return localStorage.getItem("device_id");
}

/**
 * Conversation Session Keys (IndexedDB)
 * Stores derived master keys for each conversation
 */

export async function saveConversationKey(convId, masterKeyJwk) {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(["sessions"], "readwrite");
    const store = tx.objectStore("sessions");
    const request = store.put({ conv_id: convId, master_key: masterKeyJwk });

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function getConversationKey(convId) {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(["sessions"], "readonly");
    const store = tx.objectStore("sessions");
    const request = store.get(convId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function saveConversationSession(sessionRecord) {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(["sessions"], "readwrite");
    const store = tx.objectStore("sessions");
    const request = store.put(sessionRecord);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

/**
 * Message Storage (IndexedDB)
 */

export async function saveMessage(message) {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(["messages"], "readwrite");
    const store = tx.objectStore("messages");
    const request = store.put(message);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function getMessages(convId, skip = 0, limit = 50) {
  const database = await initDB();
  const tx = database.transaction(["messages"], "readonly");
  const store = tx.objectStore("messages");
  const index = store.index("conv_id_timestamp");

  return new Promise((resolve, reject) => {
    const range = IDBKeyRange.bound([convId, Number.MIN_SAFE_INTEGER], [convId, Number.MAX_SAFE_INTEGER]);
    const request = index.getAll(range);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const messages = request.result
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(skip, skip + limit);
      resolve(messages);
    };
  });
}

export async function getAllMessagesByConversation(convId) {
  const database = await initDB();
  const tx = database.transaction(["messages"], "readonly");
  const store = tx.objectStore("messages");
  const index = store.index("conv_id_timestamp");

  return new Promise((resolve, reject) => {
    const range = IDBKeyRange.bound([convId, Number.MIN_SAFE_INTEGER], [convId, Number.MAX_SAFE_INTEGER]);
    const request = index.getAll(range);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const messages = request.result.sort((a, b) => a.timestamp - b.timestamp);
      resolve(messages);
    };
  });
}

export async function deleteMessage(messageId) {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(["messages"], "readwrite");
    const store = tx.objectStore("messages");
    const request = store.delete(messageId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function clearAllMessages(convId) {
  const database = await initDB();
  const tx = database.transaction(["messages"], "readwrite");
  const store = tx.objectStore("messages");
  const index = store.index("conv_id_timestamp");

  return new Promise((resolve, reject) => {
    const range = IDBKeyRange.bound([convId, Number.MIN_SAFE_INTEGER], [convId, Number.MAX_SAFE_INTEGER]);
    const request = index.openCursor(range);

    request.onerror = () => reject(request.error);
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
  });
}
