import { describe, expect, it } from "vitest";
import { checkSecret, createVault, importDek, isEnvelope, openVault, seal, unseal } from "./vaultCrypto";

const FAST = 1_000; // iterations: real vaults use 600k; tests only check the mechanics

describe("vault crypto", () => {
  it("opens with the right secret and refuses a wrong one", async () => {
    const { header, raw } = await createVault("correct horse battery", "passphrase", FAST);
    expect(await openVault(header, "correct horse battery")).toBe(raw);
    await expect(openVault(header, "correct horse batterY")).rejects.toThrow();
    expect(JSON.stringify(header)).not.toContain("correct horse");
  });

  it("encrypts values so the plain text isn't in storage, and reads them back", async () => {
    const { raw } = await createVault("123456", "pin", FAST);
    const dek = await importDek(raw);
    const traveller = [{ id: "a", label: "Alex Tan", learned: [{ value: "K0000000X" }] }];
    const env = await seal(dek, "local_profiles", traveller);
    expect(isEnvelope(env)).toBe(true);
    expect(JSON.stringify(env)).not.toMatch(/K0000000X|Alex Tan/);
    expect(await unseal(dek, "local_profiles", env)).toEqual(traveller);
  });

  it("won't read a value moved to another key", async () => {
    const dek = await importDek((await createVault("123456", "pin", FAST)).raw);
    const env = await seal(dek, "local_profiles", ["x"]);
    await expect(unseal(dek, "th_local_profiles", env)).rejects.toThrow();
  });

  it("uses a fresh IV every time", async () => {
    const dek = await importDek((await createVault("123456", "pin", FAST)).raw);
    const a = await seal(dek, "k", "same");
    const b = await seal(dek, "k", "same");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it("checks the secret's length and kind", () => {
    expect(checkSecret("short", "passphrase")).toMatch(/10 characters/);
    expect(checkSecret("long enough pass", "passphrase")).toBeNull();
    expect(checkSecret("12345", "pin")).toMatch(/6 digits/);
    expect(checkSecret("12345a", "pin")).toMatch(/6 digits/);
    expect(checkSecret("123456", "pin")).toBeNull();
  });
});
