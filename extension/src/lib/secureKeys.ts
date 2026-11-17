/**
 * Which storage keys hold personal data (encrypted when the lock is on), and the
 * per-country change counters that tell pages to ask the background again.
 * Pages never read the personal keys directly; they watch the counter.
 */
import type { CountryId } from "./countries";
import { DRAFT_KEY, LEARNED_KEY } from "./keys";
import * as TH from "./keysTh";

/** Indonesia's travellers. localStore.PROFILES_KEY is this same constant. */
export const ID_PROFILES_KEY = "local_profiles";

/**
 * Written by pre-1.0 builds, read by nothing now, possibly holding personal data
 * in plain text. Deleted when the lock is turned on or unlocked, and by "Erase all data".
 */
export const LEGACY_PERSONAL_KEYS: readonly string[] = ["local_submissions", "local_trip_defaults"];

export const COUNTRY_KEYS: Record<CountryId, { profiles: string; learned: string; draft: string; rev: string }> = {
  id: { profiles: ID_PROFILES_KEY, learned: LEARNED_KEY, draft: DRAFT_KEY, rev: "id_rev" },
  th: { profiles: TH.PROFILES_KEY, learned: TH.LEARNED_KEY, draft: TH.DRAFT_KEY, rev: "th_rev" },
};

export const SENSITIVE_KEYS: readonly string[] = Object.values(COUNTRY_KEYS).flatMap((k) => [k.profiles, k.learned, k.draft]);

/** No personal data: a random value that changes whenever that country's saved data does. */
export const REV_KEYS: readonly string[] = Object.values(COUNTRY_KEYS).map((k) => k.rev);

export function countryOf(key: string): CountryId | undefined {
  return (Object.keys(COUNTRY_KEYS) as CountryId[]).find((c) => {
    const k = COUNTRY_KEYS[c];
    return key === k.profiles || key === k.learned || key === k.draft;
  });
}

export const asCountry = (v: unknown): CountryId => (v === "th" ? "th" : "id");
