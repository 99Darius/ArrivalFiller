import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVE_PROFILE_KEY, DRAFT_KEY, LEARNED_KEY } from "../lib/keys";
import * as TH from "../lib/keysTh";
import { PROFILES_KEY, wipeAll } from "./localStore";

// Real vaults use 600k PBKDF2 iterations; keep tests quick.
vi.mock("../lib/vaultCrypto", async (orig) => {
  const real = await orig<typeof import("../lib/vaultCrypto")>();
  return { ...real, createVault: (s: string, k: "pin" | "passphrase") => real.createVault(s, k, 1_000) };
});

const vault = await import("./vault");
const { addTraveller, listTravellers, saveRecording } = await import("./travellers");
const { panelState, startRecording } = await import("./recording");

let local: Record<string, unknown>;
let session: Record<string, unknown>;
const area = (store: () => Record<string, unknown>) => ({
  get: async (keys: string | string[]) => Object.fromEntries([keys].flat().filter((k) => k in store()).map((k) => [k, structuredClone(store()[k])])),
  set: async (items: Record<string, unknown>) => { Object.assign(store(), structuredClone(items)); },
  remove: async (keys: string | string[]) => { for (const k of [keys].flat()) delete store()[k]; },
});

beforeEach(async () => {
  local = {};
  session = {};
  (globalThis as any).chrome = { storage: { local: area(() => local), session: area(() => session) } };
  await vault.lock();
});

const P1 = "/arrival-card-submission/personal-information";
const passport = { selector: "#passport", control: "text", value: "K0000000X", step: P1 };
const PASS = "a long passphrase";

async function travellerWithPassport() {
  const { activeId } = await addTraveller("Alex Tan");
  await startRecording("id", activeId);
  await saveRecording([passport] as any);
  return activeId!;
}
const onDisk = () => JSON.stringify(local);

describe("lock off (default)", () => {
  it("stores as before, readable, and changes the country's rev key", async () => {
    await travellerWithPassport();
    expect(onDisk()).toContain("K0000000X");
    expect(local.id_rev).toBeTruthy();
    expect(await vault.status()).toEqual({ enabled: false, unlocked: false, kind: undefined, required: false });
  });
});

describe("lock on", () => {
  it("encrypts what was already saved, and everything saved after", async () => {
    await travellerWithPassport();
    local.local_submissions = [{ passport: "K0000000X" }]; // left by a pre-1.0 build
    expect((await vault.enable(PASS, "passphrase")).ok).toBe(true);
    expect(onDisk()).not.toMatch(/K0000000X|Alex Tan/);
    await addTraveller("Bea Lim");
    expect(onDisk()).not.toContain("Bea Lim");
    expect((await listTravellers()).travellers.map((t) => t.label)).toEqual(["Alex Tan", "Bea Lim"]);
    expect(local[ACTIVE_PROFILE_KEY]).toBeTypeOf("string"); // ids stay plain: no personal data
  });

  it("gives nothing while locked, and everything after the right passphrase", async () => {
    await travellerWithPassport();
    await vault.enable(PASS, "passphrase");
    await vault.lock();
    expect(await vault.status()).toMatchObject({ enabled: true, unlocked: false, kind: "passphrase" });
    await expect(vault.get(PROFILES_KEY)).rejects.toBeInstanceOf(vault.LockedError);
    await expect(addTraveller("Bea Lim")).rejects.toBeInstanceOf(vault.LockedError);
    await expect(panelState("id")).rejects.toBeInstanceOf(vault.LockedError);

    expect(await vault.unlock("wrong passphrase")).toEqual({ ok: false, error: "Wrong passphrase." });
    expect((await vault.unlock(PASS)).ok).toBe(true);
    const state = await panelState("id");
    expect((state.learned as { value: string }[])[0].value).toBe("K0000000X");
  });

  it("makes you wait after five wrong tries", async () => {
    await vault.enable("123456", "pin");
    await vault.lock();
    for (let i = 0; i < 5; i++) expect((await vault.unlock("000000")).error).toBe("Wrong PIN.");
    expect((await vault.unlock("123456")).error).toMatch(/Too many tries/);
    session = {}; // a browser restart doesn't reset the count
    expect((await vault.unlock("123456")).error).toMatch(/Too many tries/);
  });

  it("refuses a weak secret", async () => {
    expect(await vault.enable("123", "pin")).toMatchObject({ ok: false });
    expect(await vault.enable("short", "passphrase")).toMatchObject({ ok: false });
    expect(local.vault).toBeUndefined();
  });

  it("finishes an interrupted switch-over on the next unlock", async () => {
    await vault.enable(PASS, "passphrase");
    await vault.lock();
    // As if the browser closed after the header was written but before this was encrypted.
    local[TH.PROFILES_KEY] = [{ id: "t", label: "Alex Tan", learned: [] }];
    // Fails closed: not returned while locked, even though it's plain on disk.
    await expect(vault.get(TH.PROFILES_KEY)).rejects.toBeInstanceOf(vault.LockedError);
    await vault.unlock(PASS);
    expect((await vault.get(TH.PROFILES_KEY))[TH.PROFILES_KEY]).toHaveLength(1);
    expect(onDisk()).not.toContain("Alex Tan");
  });

  it("turning it off needs the secret, and leaves the data readable", async () => {
    await travellerWithPassport();
    await vault.enable(PASS, "passphrase");
    expect(await vault.disable("wrong passphrase")).toMatchObject({ ok: false });
    expect((await vault.disable(PASS)).ok).toBe(true);
    expect(local.vault).toBeUndefined();
    expect(onDisk()).toContain("K0000000X");
    expect((await listTravellers()).travellers).toHaveLength(1);
  });

  it("Erase all data also removes the lock (the way out of a forgotten passphrase)", async () => {
    await travellerWithPassport();
    await vault.enable(PASS, "passphrase");
    await vault.lock();
    await wipeAll();
    expect(local.vault).toBeUndefined();
    expect(local[PROFILES_KEY]).toBeUndefined();
    expect(local[LEARNED_KEY]).toBeUndefined();
    expect(local[DRAFT_KEY]).toBeUndefined();
    expect(await vault.status()).toMatchObject({ enabled: false });
  });

  it("keeps the unlocked key out of local storage", async () => {
    await vault.enable(PASS, "passphrase");
    const key = Object.values(session).find((v) => typeof v === "string") as string;
    expect(key).toBeTruthy();
    expect(onDisk()).not.toContain(key);
  });
});

describe("messages", () => {
  it("lock settings can't be changed from a web page's content script", async () => {
    let listener!: (msg: unknown, sender: unknown, respond: (r: unknown) => void) => boolean;
    (globalThis as any).chrome.runtime = { onMessage: { addListener: (l: typeof listener) => { listener = l; } } };
    vi.resetModules();
    await import("./index");
    const ask = (msg: unknown, sender: unknown) => new Promise((r) => listener(msg, sender, r));
    expect(await ask({ type: "ADD_TRAVELLER", label: "Alex Tan" }, {})).toMatchObject({ ok: true });
    expect(await ask({ type: "VAULT_DISABLE", secret: PASS }, { tab: { id: 1 } })).toEqual({ ok: false, error: "not allowed" });
    expect(await ask({ type: "WIPE_DATA" }, { tab: { id: 1 } })).toEqual({ ok: false, error: "not allowed" });
    expect(await ask({ type: "VAULT_ENABLE", secret: PASS, kind: "passphrase" }, {})).toEqual({ ok: true });
    expect(await ask({ type: "VAULT_LOCK" }, {})).toEqual({ ok: true });
    expect(await ask({ type: "GET_PANEL", country: "id" }, { tab: { id: 1 } })).toEqual({ ok: false, locked: true, error: "locked" });
  });
});

describe("when the maintainer makes the lock required", () => {
  it("saves nothing personal until it is set, then works, and can't be turned off", async () => {
    vi.resetModules();
    vi.doMock("../lib/lockPolicy", () => ({ LOCK_REQUIRED: true }));
    const v = await import("./vault");
    const t = await import("./travellers");
    await expect(t.addTraveller("Alex Tan")).rejects.toBeInstanceOf(v.LockedError);
    expect(JSON.stringify(local)).not.toContain("Alex Tan");
    expect(await v.status()).toMatchObject({ required: true, enabled: false });
    expect((await v.enable(PASS, "passphrase")).ok).toBe(true);
    await t.addTraveller("Alex Tan");
    expect(JSON.stringify(local)).not.toContain("Alex Tan");
    expect(await v.disable(PASS)).toMatchObject({ ok: false });
    vi.doUnmock("../lib/lockPolicy");
  });
});
