import { describe, expect, it } from "vitest";
import manifest from "../../manifest.json";
import { OFFICIAL_SITES, fillSite, officialNotice, officialSite, pageKind } from "./officialSites";

describe("official sites", () => {
  it("recognises every official site on ArrivalFiller's website, on any page of them", () => {
    const at = (url: string) => officialSite(url)?.country;
    expect(at("https://allindonesia.imigrasi.go.id/arrival-card-submission/personal-information")).toBe("Indonesia");
    expect(at("https://tdac.immigration.go.th/arrival-card/#/tac/arrival-card/add")).toBe("Thailand");
    expect(at("https://imigresen-online.imi.gov.my/mdac/main")).toBe("Malaysia");
    expect(at("https://eservices.ica.gov.sg/sgarrivalcard/")).toBe("Singapore");
    expect(at("https://prearrival.immigration.gov.vn/")).toBe("Vietnam");
    expect(at("https://etravel.gov.ph/")).toBe("Philippines");
  });

  it("rejects lookalikes, plain http, and anything unreadable", () => {
    for (const url of [
      "https://tdac.immigration.go.th.example.com/",
      "https://tdac-immigration.go.th/",
      "https://example.com/tdac.immigration.go.th/",
      "https://example.com/?next=https://tdac.immigration.go.th/",
      "http://tdac.immigration.go.th/",
      "https://allindonesia.imigrasi.go.id.example.com/",
      "https://mdac-imigresen-online.imi.gov.my.example.com/",
      "https://etravel.gov.ph.example.com/",
      "https://etravel-gov.ph/",
      "https://sg-arrival-card.example.com/eservices.ica.gov.sg",
      "http://prearrival.immigration.gov.vn/",
      "not a url",
      "",
      undefined,
    ]) expect(officialSite(url), url).toBeUndefined();
  });

  it("runs only on the sites it can fill: the same ones Chrome is told about", () => {
    const hosts = OFFICIAL_SITES.filter((s) => s.fills).map((s) => `https://${s.host}/*`).sort();
    expect([...manifest.host_permissions].sort()).toEqual(hosts);
    expect(manifest.content_scripts.flatMap((s) => s.matches).sort()).toEqual(hosts);
    expect(fillSite("id").host).toBe("allindonesia.imigrasi.go.id");
    expect(fillSite("th").host).toBe("tdac.immigration.go.th");
  });

  it("asks for no permission that shows a warning to recognise the other sites", () => {
    // activeTab: the popup reads the open tab's address only when the user opens it.
    expect([...manifest.permissions].sort()).toEqual(["activeTab", "storage"]);
  });

  it("warns on other websites, but says nothing on Chrome's own pages", () => {
    expect(pageKind("https://tdac.immigration.go.th/").kind).toBe("official");
    expect(pageKind("https://example.com/thailand-arrival-card").kind).toBe("website");
    expect(pageKind("http://tdac.immigration.go.th/").kind).toBe("website"); // a copy over plain http still warns
    expect(pageKind("https://tdac.immigration.go.th.example.com/").kind).toBe("website");
    for (const url of [
      "chrome://extensions/",
      "chrome://newtab/",
      "chrome://settings/",
      "chrome-extension://abcdefghijklmnop/src/popup/index.html",
      "about:blank",
      "file:///C:/Users/test/card.html",
      "",
      undefined,
    ]) expect(pageKind(url).kind, String(url)).toBe("browser");
  });

  it("names the site in the notice", () => {
    expect(officialNotice(fillSite("th"))).toBe("Official Thailand arrival card site: tdac.immigration.go.th");
  });
});
