/**
 * Encryption for saved traveller data. WebCrypto only, no dependencies.
 *
 * - A random 256-bit data key (DEK) encrypts every sensitive value with AES-GCM.
 * - The DEK is stored wrapped by a key derived from the user's passphrase or PIN
 *   (PBKDF2-SHA256, 600k iterations, random salt). A wrong secret fails the GCM
 *   tag check, so nothing else about the secret is stored.
 * - Each value is bound to its storage key (AES-GCM additional data), so a
 *   ciphertext can't be moved to another key, e.g. one country's travellers into
 *   the other's slot.
 */

export type SecretKind = "passphrase" | "pin";

export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSPHRASE = 10;
export const MIN_PIN = 6;

export interface VaultHeader {
  v: 1;
  kdf: "pbkdf2-sha256";
  iter: number;
  salt: string;
  kind: SecretKind;
  /** The DEK, AES-GCM encrypted under the passphrase-derived key. */
  wrapped: { iv: string; ct: string };
}

/** What a sensitive value looks like in storage once encrypted. */
export interface Envelope {
  __vault: 1;
  iv: string;
  ct: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const DEK_AAD = enc.encode("arrivalfiller/dek");

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const random = (n: number): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(n));

export function isEnvelope(v: unknown): v is Envelope {
  return !!v && typeof v === "object" && (v as Envelope).__vault === 1 && typeof (v as Envelope).ct === "string";
}

/** Null if acceptable, otherwise what's wrong, in words for the popup. */
export function checkSecret(secret: string, kind: SecretKind): string | null {
  if (kind === "pin") return /^\d+$/.test(secret) && secret.length >= MIN_PIN ? null : `Use at least ${MIN_PIN} digits.`;
  return secret.length >= MIN_PASSPHRASE ? null : `Use at least ${MIN_PASSPHRASE} characters.`;
}

async function deriveKek(secret: string, salt: Uint8Array<ArrayBuffer>, iter: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(secret.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: iter },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** A new vault: the header to store, and the raw DEK to keep for this session. */
export async function createVault(secret: string, kind: SecretKind, iter = PBKDF2_ITERATIONS) {
  const raw = random(32);
  const salt = random(16);
  const iv = random(12);
  const kek = await deriveKek(secret, salt, iter);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: DEK_AAD }, kek, raw));
  const header: VaultHeader = { v: 1, kdf: "pbkdf2-sha256", iter, salt: b64(salt), kind, wrapped: { iv: b64(iv), ct: b64(ct) } };
  return { header, raw: b64(raw) };
}

/** The raw DEK (base64) if the secret is right; throws if it isn't. */
export async function openVault(header: VaultHeader, secret: string): Promise<string> {
  const kek = await deriveKek(secret, unb64(header.salt), header.iter);
  const raw = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(header.wrapped.iv), additionalData: DEK_AAD },
    kek,
    unb64(header.wrapped.ct),
  );
  return b64(new Uint8Array(raw));
}

export function importDek(rawB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", unb64(rawB64), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(dek: CryptoKey, key: string, value: unknown): Promise<Envelope> {
  const iv = random(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(key) }, dek, enc.encode(JSON.stringify(value)));
  return { __vault: 1, iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}

export async function unseal(dek: CryptoKey, key: string, env: Envelope): Promise<unknown> {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(env.iv), additionalData: enc.encode(key) }, dek, unb64(env.ct));
  return JSON.parse(dec.decode(pt));
}
