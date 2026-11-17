/**
 * Background service worker: the only writer of saved answers. Content scripts
 * and the popup send messages; traveller data changes here, one at a time.
 * Each country has its own travellers: messages say `country: "th"` for Thailand,
 * and anything else is Indonesia. Nothing is sent off the device.
 */
import { serialize, wipeAll } from "./localStore";
import * as vault from "./vault";
import { cancelRecording, getDraft, panelState, startRecording, updateDraft } from "./recording";
import { asCountry } from "../lib/secureKeys";
import * as indonesia from "./travellers";
import * as thailand from "./th/travellers";
import { closeOffer, offersFor, reopenOffer } from "./sharedAnswers";
import { LEARNED_KEY } from "../lib/keys";
import { LEARNED_KEY as TH_LEARNED_KEY } from "../lib/keysTh";
import type { LearnedField } from "../content/formFill";
import type { Answer } from "../content/th/fields";

/** Lock settings and erasing only from the extension's own pages (the popup), never from a content script. */
const POPUP_ONLY = new Set(["VAULT_STATUS", "VAULT_ENABLE", "VAULT_UNLOCK", "VAULT_LOCK", "VAULT_DISABLE", "WIPE_DATA"]);

async function handle(msg: { type: string; country?: string; [k: string]: unknown }, fromPage: boolean): Promise<unknown> {
  if (fromPage && POPUP_ONLY.has(msg.type)) return { ok: false, error: "not allowed" };
  const thai = msg.country === "th";
  const country = asCountry(msg.country);
  const store = thai ? thailand : indonesia;
  switch (msg.type) {
    case "GET_TRAVELLERS":
      return { ok: true, ...(await store.listTravellers()) };
    case "SELECT_TRAVELLER":
      return { ok: true, ...(await store.selectTraveller(msg.id as string)) };
    case "ADD_TRAVELLER":
      return { ok: true, ...(await store.addTraveller(String(msg.label ?? "").trim() || "Traveller")) };
    case "DELETE_TRAVELLER":
      return { ok: true, ...(await store.removeTraveller(msg.id as string)) };
    case "SAVE_LEARNED":
      // End of a recording: merge into the traveller being learned.
      return { ok: true, ...(thai ? await thailand.saveRecording((msg.fields ?? []) as Answer[]) : await indonesia.saveRecording((msg.fields ?? []) as LearnedField[])) };
    case "LEARN_UPDATE":
      // A correction after Fill: only applies if that traveller is still active.
      return { ok: true, ...(thai ? await thailand.learnUpdate(msg.travellerId as string, (msg.fields ?? []) as Answer[]) : await indonesia.learnUpdate(msg.travellerId as string, (msg.fields ?? []) as LearnedField[])) };
    case "GET_LEARNED": {
      const key = thai ? TH_LEARNED_KEY : LEARNED_KEY;
      const { [key]: learned } = await serialize(() => vault.get(key));
      return { ok: true, learned: learned ?? [] };
    }
    case "GET_DRAFT":
      return { ok: true, ...(await getDraft(country)) };
    case "START_RECORDING":
      return { ok: true, ...(await startRecording(country, msg.travellerId as string | undefined)) };
    case "UPDATE_DRAFT":
      return { ok: true, ...(await updateDraft(country, (msg.fields ?? []) as unknown[])) };
    case "CANCEL_RECORDING":
      return { ok: true, ...(await cancelRecording(country)) };
    case "GET_PANEL":
      return { ok: true, ...(await panelState(country)) };
    case "VAULT_STATUS":
      return { ok: true, ...(await vault.status()) };
    case "VAULT_ENABLE":
      return serialize(() => vault.enable(String(msg.secret ?? ""), msg.kind === "pin" ? "pin" : "passphrase"));
    case "VAULT_UNLOCK":
      return serialize(() => vault.unlock(String(msg.secret ?? "")));
    case "VAULT_LOCK":
      return serialize(() => vault.lock());
    case "VAULT_DISABLE":
      return serialize(() => vault.disable(String(msg.secret ?? "")));
    case "GET_SHARED":
      // What the other country has saved that could help the traveller being taught.
      return { ok: true, ...(await offersFor(thai ? "th" : "id", msg.travellerId as string)) };
    case "CLOSE_SHARED":
      return { ok: true, ...(await closeOffer(thai ? "th" : "id", msg.travellerId as string)) };
    case "REOPEN_SHARED":
      return { ok: true, ...(await reopenOffer(thai ? "th" : "id", msg.travellerId as string)) };
    case "WIPE_DATA":
      return { ok: true, result: await wipeAll() };
    default:
      return { ok: false, error: "unknown message" };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, !!sender.tab)
    .then(sendResponse)
    .catch((e) => sendResponse(e instanceof vault.LockedError ? { ok: false, locked: true, error: "locked" } : { ok: false, error: (e as Error).message }));
  return true; // async
});
