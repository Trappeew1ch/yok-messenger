'use client';

/**
 * YOK E2EE — End-to-End Encryption Module
 * 
 * Uses ECDH (P-256) for key exchange + AES-256-GCM for message encryption.
 * All crypto ops happen client-side via Web Crypto API.
 * Keys are stored in IndexedDB — never sent to the server.
 * The server only ever sees encrypted ciphertext.
 */

const DB_NAME = 'yok_e2ee';
const DB_VERSION = 1;
const KEY_STORE = 'keys';
const IDENTITY_STORE = 'identity';

// ─── IndexedDB helpers ────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE);
      if (!db.objectStoreNames.contains(IDENTITY_STORE)) db.createObjectStore(IDENTITY_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(store: string, key: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Key Generation ────────────────────────────

/** Generate an ECDH key pair for the current user (identity key). */
export async function generateIdentityKeyPair(): Promise<CryptoKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true, // extractable
    ['deriveKey', 'deriveBits']
  );
  return keyPair;
}

/** Export a public key to JWK for sharing with other users. */
export async function exportPublicKey(key: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey('jwk', key);
}

/** Import a public key from JWK (received from another user). */
export async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk', jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );
}

/** Derive a shared AES-256-GCM key from our private key + their public key. */
export async function deriveSharedKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey
): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: publicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false, // not extractable
    ['encrypt', 'decrypt']
  );
}

// ─── Encryption / Decryption ────────────────────

export interface EncryptedPayload {
  iv: string;     // base64 12-byte nonce
  ct: string;     // base64 ciphertext
  v: 1;           // version
}

/** Encrypt plaintext using AES-256-GCM. */
export async function encryptMessage(
  plaintext: string,
  key: CryptoKey
): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit nonce
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );
  return {
    iv: bufToBase64(iv),
    ct: bufToBase64(new Uint8Array(ciphertext)),
    v: 1,
  };
}

/** Decrypt ciphertext using AES-256-GCM. */
export async function decryptMessage(
  payload: EncryptedPayload,
  key: CryptoKey
): Promise<string> {
  const ivBuf = base64ToBuf(payload.iv);
  const ct = base64ToBuf(payload.ct);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBuf as BufferSource },
    key,
    ct as BufferSource
  );
  return new TextDecoder().decode(decrypted);
}

// ─── Identity Management ────────────────────────

/** Get or create the local identity key pair. Stores in IndexedDB. */
export async function getOrCreateIdentity(userId: string): Promise<{
  keyPair: CryptoKeyPair;
  publicJwk: JsonWebKey;
}> {
  const stored = await dbGet<{ priv: JsonWebKey; pub: JsonWebKey }>(IDENTITY_STORE, userId);
  if (stored) {
    const privateKey = await crypto.subtle.importKey(
      'jwk', stored.priv,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits']
    );
    const publicKey = await importPublicKey(stored.pub);
    return { keyPair: { privateKey, publicKey }, publicJwk: stored.pub };
  }

  const keyPair = await generateIdentityKeyPair();
  const pubJwk = await exportPublicKey(keyPair.publicKey);
  const privJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  await dbPut(IDENTITY_STORE, userId, { priv: privJwk, pub: pubJwk });
  return { keyPair, publicJwk: pubJwk };
}

/** Store a conversation's derived shared key in IndexedDB. */
export async function storeConversationKey(
  conversationId: string,
  key: CryptoKey
): Promise<void> {
  // We export the raw key material and re-import on load
  const raw = await crypto.subtle.exportKey('raw', key);
  await dbPut(KEY_STORE, conversationId, bufToBase64(new Uint8Array(raw as ArrayBuffer)));
}

/** Load a conversation's shared key from IndexedDB. */
export async function loadConversationKey(
  conversationId: string
): Promise<CryptoKey | null> {
  const raw = await dbGet<string>(KEY_STORE, conversationId);
  if (!raw) return null;
  return crypto.subtle.importKey(
    'raw',
    base64ToBuf(raw) as BufferSource,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

/** 
 * Exchange keys for a conversation.
 * For DMs: derive key from our private + their public.
 * For groups: generate a random AES key and share it (simplified).
 */
export async function setupConversationKey(
  conversationId: string,
  myPrivateKey: CryptoKey,
  theirPublicJwk?: JsonWebKey
): Promise<CryptoKey> {
  // 1. Try loading existing key first (fast path)
  const existing = await loadConversationKey(conversationId);
  if (existing) return existing;

  let key: CryptoKey;

  if (theirPublicJwk) {
    // DM: ECDH key agreement → derive shared secret
    const theirPub = await importPublicKey(theirPublicJwk);
    // deriveBits gives us raw shared secret material
    const rawBits = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: theirPub },
      myPrivateKey,
      256
    );
    // Import as AES-256-GCM key (extractable for storage)
    key = await crypto.subtle.importKey(
      'raw', rawBits as BufferSource,
      { name: 'AES-GCM', length: 256 },
      true, // extractable — needed for IndexedDB export
      ['encrypt', 'decrypt']
    );
  } else {
    // Group/Channel: generate random AES-256-GCM key
    key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  }

  await storeConversationKey(conversationId, key);
  return key;
}

// ─── Utility ────────────────────────────

function bufToBase64(buf: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  return btoa(binary);
}

function base64ToBuf(b64: string): Uint8Array {
  const binary = atob(b64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return buf;
}

/**
 * Check if a message content string is an encrypted payload.
 * Encrypted messages are JSON with { iv, ct, v } fields.
 */
export function isEncryptedPayload(content: string): boolean {
  if (!content || !content.startsWith('{')) return false;
  try {
    const parsed = JSON.parse(content);
    return parsed.v === 1 && typeof parsed.iv === 'string' && typeof parsed.ct === 'string';
  } catch {
    return false;
  }
}

/** Parse encrypted payload from message content. */
export function parseEncryptedPayload(content: string): EncryptedPayload | null {
  try {
    const parsed = JSON.parse(content);
    if (parsed.v === 1 && parsed.iv && parsed.ct) return parsed as EncryptedPayload;
  } catch {}
  return null;
}
