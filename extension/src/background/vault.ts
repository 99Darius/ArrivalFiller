/**
 * The background's door to saved data. Same shape as chrome.storage.local
 * (get/set/remove), so the traveller code reads the same either way.
 *
 * Lock off (default): values pass through unchanged, as before.
 * Lock on: personal keys (lib/secureKeys) are AES-GCM encrypted at rest. The
 * unlocked data key lives only in chrome.storage.session (memory, cleared when
 * the browser closes), which content scripts can't read. While locked, reading
 * or writing personal data throws LockedError and nothing is returned.
 *
 * Every write of a country's personal data also changes that country's rev key
 * (no personal data), which pages watch to know when to ask again.
 */
import { checkSecret, createVault, importDek, isEnvelope, openVault, seal, unseal, type SecretKind, type VaultHeader } from "../lib/vaultCrypto";
import { COUNTRY_KEYS, LEGACY_PERSONAL_KEYS, SENSITIVE_KEYS, countryOf } from "../lib/secureKeys";
import { LOCK_REQUIRED } from "../lib/lockPolicy";

export const VAULT_KEY = "vault";
const SESSION_KEY = "vault_key";
/** Wrong-try count, in local storage so a browser restart doesn't reset it. No personal data. */
const ATTEMPTS_KEY = "vault_attempts";
/** After this many wrong tries, the wait doubles with each one: 30s, 1m, 2m… up to an hour. */
const FREE_ATTEMPTS = 5;
const LOCKOUT_MS = 30_000;
const MAX_LOCKOUT_MS = 60 * 60_000;

export class LockedError extends Error {
  constructor() { super("locked"); this.name = "LockedError"; }
}

const sensitive = (k: string) => SENSITIVE_KEYS.includes(k);
const list = (keys: string | string[]) => [keys].flat();

let cachedKey: CryptoKey | undefined;
let cachedRaw: string | undefined;

/** The unlocked data key, or undefined if locked. */
async function dataKey(): Promise<CryptoKey | undefined> {
  const res = await chrome.storage.session?.get(SESSION_KEY);
  const raw = res?.[SESSION_KEY] as string | undefined;
  if (!raw) { cachedKey = cachedRaw = undefined; return undefined; }
  if (raw !== cachedRaw) { cachedKey = await importDek(raw); cachedRaw = raw; }
  return cachedKey;
}

async function header(): Promise<VaultHeader | undefined> {
  return (await chrome.storage.local.get(VAULT_KEY))[VAULT_KEY] as VaultHeader | undefined;
}

function revs(keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const c = countryOf(k);
    if (c) out[COUNTRY_KEYS[c].rev] = crypto.randomUUID();
  }
  return out;
}

/**
 * Fails closed: with the lock on, no personal key is returned while locked,
 * even one still in plain text after an interrupted switch-over.
 */
export async function get(keys: string | string[]): Promise<Record<string, any>> {
  const wanted = list(keys);
  const res = await chrome.storage.local.get([...wanted, VAULT_KEY]);
  const lockOn = !!res[VAULT_KEY];
  if (!wanted.includes(VAULT_KEY)) delete res[VAULT_KEY];
  let key: CryptoKey | undefined;
  for (const k of wanted.filter(sensitive)) {
    if (!lockOn && !isEnvelope(res[k])) continue;
    key ??= await dataKey();
    if (!key) throw new LockedError();
    if (isEnvelope(res[k])) res[k] = await unseal(key, k, res[k]);
  }
  return res;
}

export async function set(items: Record<string, unknown>): Promise<void> {
  const out: Record<string, unknown> = { ...items };
  const touched = Object.keys(items).filter(sensitive);
  const lockOn = touched.length ? !!(await header()) : false;
  // Lock required but not set up yet: save nothing personal until it is.
  if (touched.length && LOCK_REQUIRED && !lockOn) throw new LockedError();
  if (lockOn) {
    const key = await dataKey();
    if (!key) throw new LockedError();
    for (const k of touched) out[k] = await seal(key, k, items[k]);
  }
  await chrome.storage.local.set({ ...out, ...revs(touched) });
}

export async function remove(keys: string | string[]): Promise<void> {
  await chrome.storage.local.remove(list(keys));
  const touched = list(keys).filter(sensitive);
  if (touched.length) await chrome.storage.local.set(revs(touched));
}

export async function status() {
  const h = await header();
  return { enabled: !!h, unlocked: !!h && !!(await dataKey()), kind: h?.kind, required: LOCK_REQUIRED };
}

/**
 * Encrypt any personal value still in plain text. Run after turning the lock on
 * and on every unlock, so an interrupted switch-over finishes next time.
 */
async function sealAll() {
  const out = await sealedPlainValues();
  if (Object.keys(out).length) await chrome.storage.local.set(out);
  await chrome.storage.local.remove([...LEGACY_PERSONAL_KEYS]);
}

/** Encrypted copies of the personal values still in plain text. */
async function sealedPlainValues(): Promise<Record<string, unknown>> {
  const key = await dataKey();
  if (!key) throw new LockedError();
  const res = await chrome.storage.local.get([...SENSITIVE_KEYS]);
  const out: Record<string, unknown> = {};
  for (const k of SENSITIVE_KEYS) if (k in res && !isEnvelope(res[k])) out[k] = await seal(key, k, res[k]);
  return out;
}

/** Locking or unlocking changes what every page may see: tell them all to ask again. */
const touchAll = () => chrome.storage.local.set(revs([...SENSITIVE_KEYS]));

async function remember(raw: string) {
  await chrome.storage.session.set({ [SESSION_KEY]: raw });
  await chrome.storage.local.remove(ATTEMPTS_KEY);
  await touchAll();
}

export async function enable(secret: string, kind: SecretKind) {
  const problem = checkSecret(secret, kind);
  if (problem) return { ok: false as const, error: problem };
  if (await header()) return { ok: false as const, error: "The lock is already on." };
  const { header: h, raw } = await createVault(secret, kind);
  // The header and the encrypted data are written in one call, so there is no
  // moment where the lock is on but data is still plain (or encrypted with no
  // header to open it). Anything saved in between is caught by the next unlock.
  await remember(raw);
  await chrome.storage.local.set({ ...(await sealedPlainValues()), [VAULT_KEY]: h });
  // Old-format data nothing reads any more: delete rather than leave it in plain text.
  await chrome.storage.local.remove([...LEGACY_PERSONAL_KEYS]);
  return { ok: true as const };
}

/** Wrong tries are counted across restarts; after a few, each try waits longer. */
async function tryOpen(secret: string): Promise<{ raw?: string; error?: string }> {
  const h = await header();
  if (!h) return { error: "The lock is off." };
  const res = await chrome.storage.local.get(ATTEMPTS_KEY);
  const attempts = (res[ATTEMPTS_KEY] as { n: number; until: number } | undefined) ?? { n: 0, until: 0 };
  const wait = attempts.until - Date.now();
  if (wait > 0) return { error: `Too many tries. Wait ${Math.ceil(wait / 1000)} seconds.` };
  try {
    return { raw: await openVault(h, secret) };
  } catch {
    const n = attempts.n + 1;
    const wait = n >= FREE_ATTEMPTS ? Math.min(LOCKOUT_MS * 2 ** (n - FREE_ATTEMPTS), MAX_LOCKOUT_MS) : 0;
    await chrome.storage.local.set({ [ATTEMPTS_KEY]: { n, until: wait ? Date.now() + wait : 0 } });
    return { error: h.kind === "pin" ? "Wrong PIN." : "Wrong passphrase." };
  }
}

export async function unlock(secret: string) {
  const { raw, error } = await tryOpen(secret);
  if (!raw) return { ok: false as const, error };
  await remember(raw);
  await sealAll();
  return { ok: true as const };
}

export async function lock() {
  cachedKey = cachedRaw = undefined;
  await chrome.storage.session.remove(SESSION_KEY);
  await touchAll();
  return { ok: true as const };
}

/** Turn the lock off: needs the secret, and stores everything in plain text again. */
export async function disable(secret: string) {
  if (LOCK_REQUIRED) return { ok: false as const, error: "The lock can't be turned off." };
  const { raw, error } = await tryOpen(secret);
  if (!raw) return { ok: false as const, error };
  await remember(raw);
  const plain = await get([...SENSITIVE_KEYS]);
  // Data first, then the header: an interruption leaves the lock on with
  // readable data, never data nobody can read.
  if (Object.keys(plain).length) await chrome.storage.local.set(plain);
  await chrome.storage.local.remove(VAULT_KEY);
  await lock();
  return { ok: true as const };
}

/** For "Erase all data": the lock goes with the data, so a forgotten secret has a way out. */
export async function forget() {
  await chrome.storage.local.remove([VAULT_KEY, ATTEMPTS_KEY, ...Object.values(COUNTRY_KEYS).map((k) => k.rev)]);
  await chrome.storage.session?.remove(SESSION_KEY);
  cachedKey = cachedRaw = undefined;
}
