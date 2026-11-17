import { describe, expect, it } from "vitest";
import manifest from "../../manifest.json";
import { COUNTRIES, isOfficialSite } from "./countries";

const covers = (patterns: string[], site: RegExp) => patterns.some(p => site.test(p.replace("*", "")));

describe("every country", () => {
  for (const c of COUNTRIES) {
    it(`${c.name} works on install, with no extra permission to ask for`, () => {
      expect(covers(manifest.host_permissions, c.site)).toBe(true);
      expect(covers(manifest.content_scripts.flatMap(s => s.matches), c.site)).toBe(true);
    });
  }
  it("theAsianparent shows everywhere, Rumah123 only on Indonesia", () => {
    for (const c of COUNTRIES) {
      expect(c.ads).toContain("theasianparent");
      expect(c.ads.includes("rumah123")).toBe(c.id === "id");
    }
  });
  it("knows the official sites, and nothing else", () => {
    expect(isOfficialSite("https://allindonesia.imigrasi.go.id/arrival-card-submission/personal-information")).toBe(true);
    expect(isOfficialSite("https://tdac.immigration.go.th/arrival-card/#/tac/arrival-card/add")).toBe(true);
    // Lookalikes, plain http, and pages the extension can't see (no address).
    expect(isOfficialSite("https://allindonesia.imigrasi.go.id.example.com/")).toBe(false);
    expect(isOfficialSite("https://tdac-immigration.go.th.example.com/")).toBe(false);
    expect(isOfficialSite("http://tdac.immigration.go.th/")).toBe(false);
    expect(isOfficialSite("https://example.com/thailand-arrival-card")).toBe(false);
    expect(isOfficialSite(undefined)).toBe(false);
    for (const c of COUNTRIES) expect(isOfficialSite("https://" + c.officialHost + "/")).toBe(true);
  });
  it("links each warning to that country's fake-sites guide on ArrivalFiller's own website", () => {
    for (const c of COUNTRIES) {
      expect(c.fakeSitesGuide.startsWith(manifest.homepage_url + "/")).toBe(true);
      expect(c.fakeSitesGuide).toContain("fake-websites");
    }
  });
  it("no permission is left to ask for later", () => {
    expect(manifest).not.toHaveProperty("optional_host_permissions");
  });
});
