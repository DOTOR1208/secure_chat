import {
  getHealth,
  registerUser,
  loginUser,
  getUserByUsername,
  registerDeviceKey,
  fetchUserDeviceKeys,
  createConversation,
  listConversations,
  getMessages,
  postMessage,
  HttpError,
} from "./api/index.js";
import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  performKeyAgreement,
  encryptMessage,
  decryptMessage,
  importPrivateKey,
  exportPrivateKey,
  deriveContextualKey,
} from "./crypto/index.js";
import { relayWebSocketUrl } from "./config.js";
import * as storage from "./storage/index.js";

// ===== DOM ELEMENTS =====

const authScreen = document.getElementById("auth-screen");
const chatScreen = document.getElementById("chat-screen");

const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("login-btn");
const registerBtn = document.getElementById("register-btn");
const authError = document.getElementById("auth-error");
const apiHealthEl = document.getElementById("api-health");

const conversationsList = document.getElementById("conversations-list");
const messagesContainer = document.getElementById("messages-container");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const logoutBtn = document.getElementById("logout-btn");
const currentUserEl = document.getElementById("current-user");
const loadingOverlay = document.getElementById("loading-overlay");
const loadingText = document.getElementById("loading-text");
const messageFormEl = document.getElementById("message-input-form");
const noConvPlaceholder = document.getElementById("no-conv-placeholder");
const newChatBtn = document.getElementById("new-chat-btn");
const chatStatusEl = document.getElementById("chat-status");
const conversationTitleEl = document.getElementById("conv-title");

// ===== STATE =====

let currentUser = null;
let currentConversation = null;
let messageIndexes = {};
let ws = null;
const deviceKeyDirectoryCache = new Map();

// ===== UTILITIES =====

function showLoading(text = "Loading...") {
  loadingText.textContent = text;
  loadingOverlay.style.display = "flex";
}

function hideLoading() {
  loadingOverlay.style.display = "none";
}

function showError(message) {
  authError.textContent = message;
  setTimeout(() => {
    authError.textContent = "";
  }, 5000);
}

function showChatStatus(message) {
  if (!chatStatusEl) return;
  chatStatusEl.textContent = message;
  chatStatusEl.hidden = false;
}

function clearChatStatus() {
  if (!chatStatusEl) return;
  chatStatusEl.hidden = true;
  chatStatusEl.textContent = "";
}

function showScreen(screen) {
  document.querySelectorAll(".screen").forEach((element) => element.classList.remove("active"));
  screen.classList.add("active");
}

function getConversationLabel(conv) {
  if (Array.isArray(conv.participant_usernames) && conv.participant_usernames.length > 0) {
    return conv.participant_usernames.join(", ");
  }
  return `Chat ${conv.conv_id.slice(0, 8)}`;
}

function displayPlaceholder(text) {
  messagesContainer.innerHTML = `<div class="no-messages"><p>${text}</p></div>`;
}

function resetRuntimeState() {
  currentUser = null;
  currentConversation = null;
  messageIndexes = {};
  deviceKeyDirectoryCache.clear();
  if (ws) {
    ws.close();
    ws = null;
  }
}

function ensureSessionConsistency() {
  const session = storage.getSession();
  if (!currentUser) {
    return session;
  }

  if (!session.token || !session.userId) {
    resetRuntimeState();
    showScreen(authScreen);
    showError("Session was signed out in another tab.");
    return null;
  }

  if (session.userId !== currentUser.id || session.username !== currentUser.username) {
    resetRuntimeState();
    showScreen(authScreen);
    showError("Detected account switch in another tab. Please sign in again here.");
    return null;
  }

  return session;
}

function getMessageContext({ convId, messageIndex, senderUserId, senderDeviceId, targetUserId, targetDeviceId }) {
  return [
    `conv:${convId}`,
    `msg:${messageIndex}`,
    `sender:${senderUserId}:${senderDeviceId}`,
    `target:${targetUserId}:${targetDeviceId}`,
  ].join("|");
}

async function ensureLocalDeviceMaterial() {
  const existingDeviceId = storage.getDeviceId();
  const existingPrivateKey = storage.getPrivateKey();
  const existingPublicKey = storage.getIdentityPublicKey();

  if (existingDeviceId && existingPrivateKey && existingPublicKey) {
    return {
      deviceId: existingDeviceId,
      privateKey: await importPrivateKey(existingPrivateKey),
      privateKeyString: existingPrivateKey,
      publicKeyString: existingPublicKey,
    };
  }

  const { privateKey, publicKey } = await generateKeyPair();
  const privateKeyString = await exportPrivateKey(privateKey);
  const publicKeyString = await exportPublicKey(publicKey);
  const deviceId = crypto.randomUUID();

  storage.saveDeviceId(deviceId);
  storage.savePrivateKey(privateKeyString);
  storage.saveIdentityPublicKey(publicKeyString);

  return {
    deviceId,
    privateKey,
    privateKeyString,
    publicKeyString,
  };
}

async function createAuthenticatedUser(userId, username) {
  const localIdentity = await ensureLocalDeviceMaterial();
  return {
    id: userId,
    username,
    deviceId: localIdentity.deviceId,
    privateKey: localIdentity.privateKey,
    publicKeyString: localIdentity.publicKeyString,
  };
}

async function syncCurrentDeviceKey() {
  const session = ensureSessionConsistency();
  if (!session?.token || !currentUser) {
    return;
  }

  const registeredKey = await registerDeviceKey(
    currentUser.deviceId,
    currentUser.publicKeyString,
    session.token
  );

  deviceKeyDirectoryCache.delete(currentUser.id);
  const currentDirectory = await getUserDeviceDirectory(currentUser.id, { force: true });
  if (!currentDirectory.keys.some((key) => key.device_id === registeredKey.device_id)) {
    currentDirectory.keys.unshift(registeredKey);
  }
}

async function getUserDeviceDirectory(userId, { force = false } = {}) {
  if (!force && deviceKeyDirectoryCache.has(userId)) {
    return deviceKeyDirectoryCache.get(userId);
  }

  const directory = await fetchUserDeviceKeys(userId);
  deviceKeyDirectoryCache.set(userId, directory);
  return directory;
}

async function buildFanoutTargets(conv) {
  const targetMap = new Map();
  const participantIds = Array.isArray(conv.participant_ids) ? conv.participant_ids : [];

  for (const participantId of participantIds) {
    const directory = await getUserDeviceDirectory(participantId, { force: true });
    if (!directory.keys.length) {
      throw new Error(`User ${participantId} has no active device keys`);
    }

    for (const key of directory.keys) {
      targetMap.set(`${participantId}:${key.device_id}`, {
        user_id: participantId,
        device_id: key.device_id,
        pubkey: key.pubkey,
      });
    }
  }

  const ownDirectory = await getUserDeviceDirectory(currentUser.id, { force: true });
  for (const key of ownDirectory.keys) {
    targetMap.set(`${currentUser.id}:${key.device_id}`, {
      user_id: currentUser.id,
      device_id: key.device_id,
      pubkey: key.pubkey,
    });
  }

  return Array.from(targetMap.values());
}

async function encryptForTargetDevice(plaintext, target, convId, messageIndex) {
  const targetPublicKey = await importPublicKey(target.pubkey);
  const sharedSecret = await performKeyAgreement(currentUser.privateKey, targetPublicKey);
  const messageKey = await deriveContextualKey(
    sharedSecret,
    getMessageContext({
      convId,
      messageIndex,
      senderUserId: currentUser.id,
      senderDeviceId: currentUser.deviceId,
      targetUserId: target.user_id,
      targetDeviceId: target.device_id,
    })
  );

  const { ciphertext, tag, iv } = await encryptMessage(plaintext, messageKey, messageIndex);
  return {
    device_id: target.device_id,
    sender_device_id: currentUser.deviceId,
    ciphertext,
    tag,
    iv,
    target_user_id: target.user_id,
  };
}

function pickCiphertextForCurrentDevice(message) {
  if (!Array.isArray(message.ciphertexts)) {
    return null;
  }

  return (
    message.ciphertexts.find(
      (entry) => entry.device_id === currentUser.deviceId && entry.target_user_id === currentUser.id
    ) ||
    message.ciphertexts.find((entry) => entry.device_id === currentUser.deviceId) ||
    null
  );
}

async function decryptServerMessage(message) {
  const envelope = pickCiphertextForCurrentDevice(message);
  if (!envelope) {
    return null;
  }

  const senderDirectory = await getUserDeviceDirectory(message.sender_id);
  const senderKey = senderDirectory.keys.find((key) => key.device_id === envelope.sender_device_id);
  if (!senderKey) {
    throw new Error(`Missing sender device key ${envelope.sender_device_id}`);
  }

  const senderPublicKey = await importPublicKey(senderKey.pubkey);
  const sharedSecret = await performKeyAgreement(currentUser.privateKey, senderPublicKey);
  const messageKey = await deriveContextualKey(
    sharedSecret,
    getMessageContext({
      convId: message.conv_id,
      messageIndex: message.message_index,
      senderUserId: message.sender_id,
      senderDeviceId: envelope.sender_device_id,
      targetUserId: envelope.target_user_id || currentUser.id,
      targetDeviceId: envelope.device_id,
    })
  );

  return await decryptMessage(
    envelope.ciphertext,
    envelope.tag,
    messageKey,
    envelope.iv,
    message.message_index
  );
}

function displayMessage(senderId, plaintext, timestamp) {
  const messageEl = document.createElement("div");
  messageEl.className = `message ${senderId === currentUser.id ? "own" : "other"}`;

  const contentEl = document.createElement("div");
  contentEl.className = "message-content";
  contentEl.textContent = plaintext;

  const timeEl = document.createElement("div");
  timeEl.className = "message-time";
  timeEl.textContent = timestamp.toLocaleTimeString();

  messageEl.appendChild(contentEl);
  messageEl.appendChild(timeEl);
  messagesContainer.appendChild(messageEl);
}

function scrollMessagesToBottom() {
  requestAnimationFrame(() => {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });
}

// ===== AUTH =====

async function checkAPI() {
  try {
    const data = await getHealth();
    if (data?.status === "ok") {
      apiHealthEl.textContent = "connected";
      apiHealthEl.classList.add("ok");
    } else {
      apiHealthEl.textContent = "error";
      apiHealthEl.classList.add("err");
    }
  } catch {
    apiHealthEl.textContent = "disconnected";
    apiHealthEl.classList.add("err");
  }
}

async function handleRegister() {
  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) {
    showError("Username and password required");
    return;
  }

  showLoading("Preparing secure device identity...");

  try {
    await ensureLocalDeviceMaterial();
    showLoading("Registering account...");
    const response = await registerUser(username, password);

    storage.saveSession(response.access_token, response.user_id, username);
    currentUser = await createAuthenticatedUser(response.user_id, username);
    await syncCurrentDeviceKey();

    hideLoading();
    showChat();
  } catch (error) {
    hideLoading();
    showError(error.message || "Registration failed");
  }
}

async function handleLogin() {
  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) {
    showError("Username and password required");
    return;
  }

  showLoading("Logging in...");

  try {
    await ensureLocalDeviceMaterial();
    const response = await loginUser(username, password);

    storage.saveSession(response.access_token, response.user_id, username);
    currentUser = await createAuthenticatedUser(response.user_id, username);
    await syncCurrentDeviceKey();

    hideLoading();
    showChat();
  } catch (error) {
    hideLoading();
    showError(error.message || "Login failed");
  }
}

function handleLogout() {
  storage.clearSession();
  resetRuntimeState();

  usernameInput.value = "";
  passwordInput.value = "";
  showScreen(authScreen);
}

// ===== CHAT =====

function showChat() {
  currentUserEl.textContent = `${currentUser.username} • device ${currentUser.deviceId.slice(0, 8)}`;
  if (!ensureSessionConsistency()) {
    return;
  }
  clearChatStatus();
  showScreen(chatScreen);
  loadConversations();
  connectWebSocket();
}

async function loadConversations() {
  const session = ensureSessionConsistency();
  if (!session) {
    return;
  }

  try {
    const conversations = await listConversations(session.token);
    conversationsList.innerHTML = "";

    if (!conversations.length) {
      conversationsList.innerHTML = '<p class="placeholder">No conversations yet</p>';
      return;
    }

    for (const conv of conversations) {
      const item = document.createElement("div");
      item.className = "conversation-item";
      item.innerHTML = `
        <div class="conversation-item-title">${getConversationLabel(conv)}</div>
        <div class="conversation-item-info">${new Date(conv.created_at).toLocaleDateString()}</div>
      `;
      item.addEventListener("click", () => selectConversation(conv, item));
      conversationsList.appendChild(item);
    }
  } catch (error) {
    console.error("Failed to load conversations:", error);
    showChatStatus("Failed to load conversations from server.");
  }
}

async function selectConversation(conv, clickedElement = null) {
  if (!ensureSessionConsistency()) {
    return;
  }

  currentConversation = conv;
  clearChatStatus();

  document.querySelectorAll(".conversation-item").forEach((item) => {
    item.classList.remove("active");
  });
  if (clickedElement) {
    clickedElement.classList.add("active");
  }

  conversationTitleEl.textContent = getConversationLabel(conv);
  messageFormEl.style.display = "flex";
  noConvPlaceholder.style.display = "none";

  await loadMessages(conv.conv_id);
  scrollMessagesToBottom();
}

async function loadMessages(convId) {
  const session = ensureSessionConsistency();
  if (!session) {
    return;
  }

  try {
    displayPlaceholder("Loading...");

    const serverMessages = await getMessages(convId, 0, 100, session.token);
    serverMessages.sort((a, b) => a.message_index - b.message_index);
    messageIndexes[convId] = serverMessages.length
      ? Math.max(...serverMessages.map((message) => message.message_index)) + 1
      : 0;

    if (!serverMessages.length) {
      const localMessages = await storage.getAllMessagesByConversation(convId);
      if (!localMessages.length) {
        displayPlaceholder("No messages yet");
        return;
      }

      messagesContainer.innerHTML = "";
      for (const message of localMessages) {
        displayMessage(message.sender_id, message.plaintext, new Date(message.timestamp));
      }
      scrollMessagesToBottom();
      return;
    }

    messagesContainer.innerHTML = "";

    for (const message of serverMessages) {
      try {
        const plaintext = await decryptServerMessage(message);
        if (plaintext === null) {
          const placeholder =
            message.sender_id === currentUser.id
              ? "[Sent from another device before this browser was registered]"
              : "[No ciphertext for this device]";
          displayMessage(message.sender_id, placeholder, new Date(message.timestamp));
          continue;
        }

        displayMessage(message.sender_id, plaintext, new Date(message.timestamp));
        await storage.saveMessage({
          m_id: message.m_id,
          conv_id: message.conv_id,
          sender_id: message.sender_id,
          timestamp: new Date(message.timestamp).getTime(),
          plaintext,
        });
      } catch (error) {
        console.error("Failed to decrypt message:", error);
        displayMessage(message.sender_id, "[Failed to decrypt]", new Date(message.timestamp));
      }
    }

    scrollMessagesToBottom();
  } catch (error) {
    console.error("Failed to load messages:", error);
    const localMessages = await storage.getAllMessagesByConversation(convId);

    if (localMessages.length) {
      messagesContainer.innerHTML = "";
      for (const message of localMessages) {
        displayMessage(message.sender_id, message.plaintext, new Date(message.timestamp));
      }
      showChatStatus("Server sync failed. Showing locally cached plaintext history.");
      scrollMessagesToBottom();
      return;
    }

    displayPlaceholder("Failed to load messages");
    showChatStatus("Failed to load messages.");
  }
}

async function handleSendMessage() {
  const session = ensureSessionConsistency();
  if (!session || !currentConversation) {
    return;
  }

  const plaintext = messageInput.value.trim();
  if (!plaintext) {
    return;
  }

  messageInput.value = "";

  try {
    clearChatStatus();
    const convId = currentConversation.conv_id;
    const messageIndex = messageIndexes[convId] || 0;
    const targets = await buildFanoutTargets(currentConversation);

    if (!targets.length) {
      throw new Error("No active device keys found for this conversation");
    }

    const ciphertexts = await Promise.all(
      targets.map((target) => encryptForTargetDevice(plaintext, target, convId, messageIndex))
    );

    await postMessage(session.token, convId, messageIndex, ciphertexts);

    displayMessage(currentUser.id, plaintext, new Date());
    await storage.saveMessage({
      m_id: `${convId}-${messageIndex}-${currentUser.id}-${currentUser.deviceId}`,
      conv_id: convId,
      sender_id: currentUser.id,
      timestamp: Date.now(),
      plaintext,
    });

    messageIndexes[convId] = messageIndex + 1;
    scrollMessagesToBottom();
  } catch (error) {
    showError(`Failed to send message: ${error.message}`);
    showChatStatus(`Failed to send message: ${error.message}`);
  }
}

// ===== WEBSOCKET =====

function connectWebSocket() {
  if (ws || !currentUser) {
    return;
  }

  ws = new WebSocket(`${relayWebSocketUrl()}/${currentUser.id}`);

  ws.addEventListener("open", () => {
    console.log("WebSocket connected");
  });

  ws.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === "new_message") {
        loadConversations();
        if (currentConversation?.conv_id === message.conv_id) {
          loadMessages(message.conv_id);
        }
      }
    } catch (error) {
      console.error("Failed to parse WebSocket message:", error);
    }
  });

  ws.addEventListener("close", () => {
    ws = null;
  });

  ws.addEventListener("error", (error) => {
    console.error("WebSocket error:", error);
  });
}

// ===== EVENT LISTENERS =====

loginBtn.addEventListener("click", handleLogin);
registerBtn.addEventListener("click", handleRegister);
sendBtn.addEventListener("click", handleSendMessage);
messageInput.addEventListener("keypress", (event) => {
  if (event.key === "Enter") {
    handleSendMessage();
  }
});
logoutBtn.addEventListener("click", handleLogout);

async function handleCreateChat() {
  const session = ensureSessionConsistency();
  if (!session) {
    return;
  }

  const username = window.prompt("Nhap username nguoi ban muon chat:");
  const normalizedUsername = username?.trim();

  if (!normalizedUsername) {
    return;
  }

  if (normalizedUsername === currentUser.username) {
    showChatStatus("You cannot create a conversation with yourself.");
    return;
  }

  try {
    clearChatStatus();
    showLoading("Finding user...");
    const user = await getUserByUsername(normalizedUsername);

    showLoading("Creating conversation...");
    const conv = await createConversation([user.user_id], session.token);
    hideLoading();
    await loadConversations();
    await selectConversation(conv);
  } catch (error) {
    hideLoading();
    showChatStatus(`Failed to create conversation: ${error.message}`);
  }
}

newChatBtn.addEventListener("click", handleCreateChat);

window.addEventListener("storage", (event) => {
  if (!["auth_token", "user_id", "username"].includes(event.key)) {
    return;
  }
  ensureSessionConsistency();
});

window.addEventListener("focus", () => {
  ensureSessionConsistency();
});

// ===== INIT =====

document.addEventListener("DOMContentLoaded", () => {
  (async () => {
    await ensureLocalDeviceMaterial();
    await checkAPI();

    const session = storage.getSession();
    if (!session.token || !session.userId) {
      return;
    }

    currentUser = await createAuthenticatedUser(session.userId, session.username);
    await syncCurrentDeviceKey();
    showChat();
  })().catch((error) => {
    console.error("Failed to restore session:", error);
    handleLogout();
    if (error instanceof HttpError) {
      showError(`Failed to restore secure session: HTTP ${error.status}`);
      return;
    }
    showError("Failed to restore secure session");
  });
});
