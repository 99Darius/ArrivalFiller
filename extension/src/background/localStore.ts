/**
 * Storage for travellers. Everything lives in chrome.storage.local in this
 * browser profile — there is no server. Personal data goes through vault.ts:
 * plain text unless the user turns on the passphrase/PIN lock, then AES-GCM
 * encrypted. (Unlike Chrome's own password and autofill stores, extension
 * storage gets no encryption from the browser.)
 */
import type { LearnedField } from "../content/formFill";
import { ACTIVE_PROFILE_KEY, AD_TURN_KEY, DRAFT_KEY, LEARNED_KEY, OPEN_FORM_KEY, REVIEW_KEY, SHARED_CLOSED_KEY } from "../lib/keys";
import { COUNTRY_KEY } from "../lib/countries";
import * as TH from "../lib/keysTh";
import { forget as forgetVault } from "./vault";
import { ID_PROFILES_KEY, LEGACY_PERSONAL_KEYS } from "../lib/secureKeys";

export interface LocalProfile {
  id: string;
  label: string;
  /** Answers typed into the pre-1.0 profile form; migrated to `learned` (see travellers.ts). */
  values: Record<string, string>;
  /** This traveller's answers, learned on the form. */
  learned?: LearnedField[];
}

export const PROFILES_KEY = ID_PROFILES_KEY;

// Serialize every read-modify-write of traveller data so concurrent messages
// (popup, panel, corrections) can't interleave and lose or misfile a write.
let mutationLock: Promise<unknown> = Promise.resolve();
export function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutationLock.then(fn, fn);
  mutationLock = run.catch(() => undefined);
  return run;
}

export function wipeAll(): Promise<{ ok: true }> {
  return serialize(async () => {
    await chrome.storage.local.remove([PROFILES_KEY, LEARNED_KEY, DRAFT_KEY, OPEN_FORM_KEY, ACTIVE_PROFILE_KEY, REVIEW_KEY, SHARED_CLOSED_KEY, AD_TURN_KEY, COUNTRY_KEY, "consent", TH.PROFILES_KEY, TH.LEARNED_KEY, TH.DRAFT_KEY, TH.ACTIVE_PROFILE_KEY, ...LEGACY_PERSONAL_KEYS]);
    // Also removes the lock, so erasing is the way out of a forgotten passphrase.
    await forgetVault();
    return { ok: true } as const;
  });
}
