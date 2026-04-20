/**
 * E2EE Crypto Module
 * 
 * Implements:
 * - ECDH P-256 key generation and agreement
 * - HKDF for key derivation
 * - AES-GCM for authenticated encryption
 * 
 * Following the design spec:
 * - Master key derived from ECDH + HKDF
 * - Message index used as AES-GCM nonce/IV
 * - MAC tag included for integrity verification
 */

/**
 * Generate ECDH P-256 key pair
 * @returns {Promise<{privateKey, publicKey}>}
 */
export async function generateKeyPair() {
  const key = await window.crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true, // extractable
    ["deriveBits"]
  );

  return {
    privateKey: key.privateKey,
    publicKey: key.publicKey,
  };
}

/**
 * Export public key to JWK format (for sharing)
 * @param {CryptoKey} publicKey
 * @returns {Promise<string>} - JSON stringified JWK
 */
export async function exportPublicKey(publicKey) {
  const jwk = await window.crypto.subtle.exportKey("jwk", publicKey);
  return JSON.stringify(jwk);
}

/**
 * Import public key from JWK format
 * @param {string} jwkString - JSON stringified JWK
 * @returns {Promise<CryptoKey>}
 */
export async function importPublicKey(jwkString) {
  const jwk = JSON.parse(jwkString);
  return await window.crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    []
  );
}

/**
 * Export private key to JWK format (for local storage)
 * @param {CryptoKey} privateKey
 * @returns {Promise<string>} - JSON stringified JWK
 */
export async function exportPrivateKey(privateKey) {
  const jwk = await window.crypto.subtle.exportKey("jwk", privateKey);
  return JSON.stringify(jwk);
}

/**
 * Import private key from JWK format (from storage)
 * @param {string} jwkString - JSON stringified JWK
 * @returns {Promise<CryptoKey>}
 */
export async function importPrivateKey(jwkString) {
  const jwk = JSON.parse(jwkString);
  return await window.crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
}

/**
 * Perform ECDH key agreement
 * @param {CryptoKey} privateKey - Our private key
 * @param {CryptoKey} publicKey - Peer's public key
 * @returns {Promise<ArrayBuffer>} - Shared secret (256 bits)
 */
export async function performKeyAgreement(privateKey, publicKey) {
  const bits = await window.crypto.subtle.deriveBits(
    { name: "ECDH", public: publicKey },
    privateKey,
    256
  );
  return bits;
}

/**
 * HKDF-SHA256: Derive key material from shared secret
 * @param {ArrayBuffer} ikm - Input key material (shared secret)
 * @param {ArrayBuffer} salt - Optional salt (can be zero-length)
 * @param {string} info - Optional context/info string
 * @param {number} length - Desired output length in bytes (32 for 256-bit key)
 * @returns {Promise<ArrayBuffer>} - Derived key material
 */
export async function hkdf(ikm, salt = null, info = "", length = 32) {
  // Step 1: Extract (HMAC-SHA256)
  const hashAlg = "SHA-256";
  const actualSalt = salt || new Uint8Array(32); // Default salt (zeros)
  
  const prk = await window.crypto.subtle.sign(
    { name: "HMAC", hash: hashAlg },
    await window.crypto.subtle.importKey(
      "raw",
      actualSalt,
      { name: "HMAC", hash: hashAlg },
      false,
      ["sign"]
    ),
    ikm
  );

  // Step 2: Expand (HMAC-SHA256)
  const infoBytes = new TextEncoder().encode(info);
  const hashLen = 32; // SHA-256 = 32 bytes
  const n = Math.ceil(length / hashLen);
  
  let okm = new Uint8Array(0);
  let t = new Uint8Array(0);

  for (let i = 1; i <= n; i++) {
    const msg = new Uint8Array(t.length + infoBytes.length + 1);
    msg.set(t);
    msg.set(infoBytes, t.length);
    msg[msg.length - 1] = i;

    const prkKey = await window.crypto.subtle.importKey(
      "raw",
      prk,
      { name: "HMAC", hash: hashAlg },
      false,
      ["sign"]
    );

    t = new Uint8Array(await window.crypto.subtle.sign("HMAC", prkKey, msg));
    okm = new Uint8Array([...okm, ...t]);
  }

  return okm.slice(0, length).buffer;
}

/**
 * Encrypt plaintext using AES-GCM
 * @param {string} plaintext - Message to encrypt
 * @param {CryptoKey} key - AES key (256-bit)
 * @param {number} messageIndex - Used as nonce/IV to ensure uniqueness
 * @returns {Promise<{ciphertext: string, tag: string}>} - Base64 encoded ciphertext + auth tag
 */
export async function encryptMessage(plaintext, key, messageIndex) {
  // Create 12-byte IV for AES-GCM.
  // Include the message index in the last 4 bytes, and randomize the first 8 bytes.
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv.subarray(0, 8));
  new DataView(iv.buffer).setUint32(8, messageIndex, false); // Big-endian

  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  const encrypted = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    data
  );

  // Extract ciphertext and tag
  // AES-GCM: encrypted ArrayBuffer contains [ciphertext || tag]
  // Last 16 bytes = tag
  const ciphertextBytes = new Uint8Array(encrypted);
  const ciphertext = ciphertextBytes.slice(0, -16);
  const tag = ciphertextBytes.slice(-16);

  const ivBase64 = btoa(String.fromCharCode(...iv));

  // Return as base64
  return {
    ciphertext: btoa(String.fromCharCode(...ciphertext)),
    tag: btoa(String.fromCharCode(...tag)),
    iv: ivBase64,
  };
}

/**
 * Decrypt AES-GCM ciphertext
 * @param {string} ciphertextB64 - Base64 encoded ciphertext
 * @param {string} tagB64 - Base64 encoded authentication tag
 * @param {CryptoKey} key - AES key (256-bit)
 * @param {string|null} ivB64 - Base64 encoded IV, if available
 * @param {number|null} messageIndex - Fallback index for legacy messages
 * @returns {Promise<string>} - Decrypted plaintext
 */
export async function decryptMessage(ciphertextB64, tagB64, key, ivB64 = null, messageIndex = null) {
  let iv;
  if (ivB64) {
    iv = new Uint8Array(
      atob(ivB64)
        .split("")
        .map((c) => c.charCodeAt(0))
    );
  } else {
    if (messageIndex === null) {
      throw new Error("Missing IV and message index for decryption");
    }
    iv = new Uint8Array(12);
    new DataView(iv.buffer).setUint32(8, messageIndex, false);
  }

  // Decode from base64
  const ciphertext = new Uint8Array(
    atob(ciphertextB64)
      .split("")
      .map((c) => c.charCodeAt(0))
  );
  const tag = new Uint8Array(
    atob(tagB64)
      .split("")
      .map((c) => c.charCodeAt(0))
  );

  // Combine ciphertext + tag for decryption
  const encryptedData = new Uint8Array([...ciphertext, ...tag]);

  try {
    const decrypted = await window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
      },
      key,
      encryptedData
    );

    return new TextDecoder().decode(decrypted);
  } catch (e) {
    throw new Error("Message authentication failed - data may be tampered");
  }
}

/**
 * Derive an AES-GCM key from an ECDH shared secret and an arbitrary message context.
 * This is used for multi-device fan-out where each target device gets its own envelope.
 * @param {ArrayBuffer} sharedSecret
 * @param {string} context
 * @returns {Promise<CryptoKey>}
 */
export async function deriveContextualKey(sharedSecret, context) {
  const keyMaterial = await hkdf(sharedSecret, null, context, 32);
  return await window.crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"]
  );
}
