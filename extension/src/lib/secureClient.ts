/**
 * How the popup and content scripts reach saved answers: by asking the
 * background, never by reading storage. When the lock is on and locked, the
 * background answers { locked: true } and nothing else.
 */
import type { CountryId } from "./countries";
import type { RecordingDraft } from "./keys";
import { COUNTRY_KEYS } from "./secureKeys";

export interface PanelState<A> {
  locked?: boolean;
  learned: A[];
  draft?: RecordingDraft<A>;
  travellerId?: string;
  travellers: { id: string; label: string }[];
}

async function ask<T>(country: CountryId, type: string, extra: Record<string, unknown> = {}): Promise<(T & { ok: true }) | { ok: false; locked?: boolean }> {
  try {
    return (await chrome.runtime.sendMessage({ type, country, ...extra })) ?? { ok: false };
  } catch {
    return { ok: false }; // extension reloaded under this page
  }
}

export async function getDraft<A>(country: CountryId): Promise<RecordingDraft<A> | undefined> {
  const res = await ask<{ draft?: RecordingDraft<A> }>(country, "GET_DRAFT");
  return res.ok ? res.draft : undefined;
}

export async function updateDraft(country: CountryId, fields: unknown[]): Promise<void> {
  await ask(country, "UPDATE_DRAFT", { fields });
}

export async function panelState<A>(country: CountryId): Promise<PanelState<A>> {
  const res = await ask<PanelState<A>>(country, "GET_PANEL");
  return res.ok ? res : { locked: !!res.locked, learned: [], travellers: [] };
}

/** Calls back whenever this country's saved answers or recording change. */
export function onSavedChange(country: CountryId, cb: () => void, alsoKeys: string[] = []): void {
  const watch = [COUNTRY_KEYS[country].rev, ...alsoKeys];
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && watch.some((k) => k in changes)) cb();
  });
}
