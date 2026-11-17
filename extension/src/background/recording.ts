/**
 * The in-progress recording and what the on-page panels show, served to the
 * popup and content scripts by message. They never read these keys from storage
 * themselves, so the data can be encrypted at rest (see vault.ts).
 */
import type { CountryId } from "../lib/countries";
import { ACTIVE_PROFILE_KEY, type RecordingDraft } from "../lib/keys";
import { ACTIVE_PROFILE_KEY as TH_ACTIVE_PROFILE_KEY } from "../lib/keysTh";
import { COUNTRY_KEYS } from "../lib/secureKeys";
import { serialize } from "./localStore";
import * as store from "./vault";

const activeKey = (c: CountryId) => (c === "th" ? TH_ACTIVE_PROFILE_KEY : ACTIVE_PROFILE_KEY);

export function getDraft(country: CountryId) {
  return serialize(async () => {
    const key = COUNTRY_KEYS[country].draft;
    return { draft: (await store.get(key))[key] as RecordingDraft | undefined };
  });
}

/** Recorders in every form tab of this country pick this up. */
export function startRecording(country: CountryId, travellerId: string | undefined) {
  return serialize(async () => {
    const draft: RecordingDraft = { active: true, fields: [], travellerId };
    await store.set({ [COUNTRY_KEYS[country].draft]: draft });
    return { draft };
  });
}

/** A recorder's latest answers. Ignored unless a recording is under way. */
export function updateDraft(country: CountryId, fields: unknown[]) {
  return serialize(async () => {
    const key = COUNTRY_KEYS[country].draft;
    const draft = (await store.get(key))[key] as RecordingDraft | undefined;
    if (!draft?.active || !Array.isArray(fields)) return { updated: false };
    await store.set({ [key]: { ...draft, fields } });
    return { updated: true };
  });
}

export function cancelRecording(country: CountryId) {
  return serialize(async () => {
    const key = COUNTRY_KEYS[country].draft;
    const draft = (await store.get(key))[key] as RecordingDraft | undefined;
    await store.remove(key);
    return { travellerId: draft?.travellerId };
  });
}

/** What the on-page panel needs: the active traveller's answers, the recording, and names to show. */
export function panelState(country: CountryId) {
  return serialize(async () => {
    const k = COUNTRY_KEYS[country];
    const res = await store.get([k.learned, k.draft, k.profiles, activeKey(country)]);
    const profiles = (res[k.profiles] as { id: string; label: string }[] | undefined) ?? [];
    return {
      learned: (res[k.learned] as unknown[] | undefined) ?? [],
      draft: res[k.draft] as RecordingDraft | undefined,
      travellerId: (res[activeKey(country)] as string | null | undefined) ?? undefined,
      travellers: profiles.map(({ id, label }) => ({ id, label })),
    };
  });
}
