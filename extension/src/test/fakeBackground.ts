/**
 * Plays the background's part for content-script tests: answers the draft and
 * panel requests from the test's stubbed storage, as background/recording.ts
 * does from real storage. Other messages go to the test's own sendMessage.
 */
import type { CountryId } from "../lib/countries";
import { ACTIVE_PROFILE_KEY } from "../lib/keys";
import { ACTIVE_PROFILE_KEY as TH_ACTIVE_PROFILE_KEY } from "../lib/keysTh";
import { COUNTRY_KEYS } from "../lib/secureKeys";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function withBackground<T extends { storage: any; runtime?: any }>(chrome: T): T {
  chrome.runtime ??= {};
  const own = chrome.runtime.sendMessage ?? (async () => ({ ok: true }));
  const read = async (key: string) => (await chrome.storage.local.get(key))?.[key];
  chrome.runtime.sendMessage = async (m: any) => {
    const country: CountryId = m?.country === "th" ? "th" : "id";
    const k = COUNTRY_KEYS[country];
    switch (m?.type) {
      case "GET_DRAFT":
        return { ok: true, draft: await read(k.draft) };
      case "UPDATE_DRAFT": {
        const draft = await read(k.draft);
        if (draft?.active) await chrome.storage.local.set({ [k.draft]: { ...draft, fields: m.fields }, [k.rev]: Math.random() });
        return { ok: true };
      }
      case "GET_PANEL":
        return {
          ok: true,
          learned: (await read(k.learned)) ?? [],
          draft: await read(k.draft),
          travellerId: (await read(country === "th" ? TH_ACTIVE_PROFILE_KEY : ACTIVE_PROFILE_KEY)) ?? undefined,
          travellers: ((await read(k.profiles)) ?? []).map(({ id, label }: any) => ({ id, label })),
        };
    }
    return own(m);
  };
  return chrome;
}

/** Lets a page finish asking the background after a change (a few promise turns, no timers). */
export async function answered(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** The storage change a page sees when that country's saved data changes. */
export const revChange = (country: CountryId) => ({ [COUNTRY_KEYS[country].rev]: { newValue: Math.random() } });
