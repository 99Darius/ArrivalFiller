/**
 * The official arrival card sites, and the one check every part of the
 * extension uses to tell them apart from lookalikes: a secure (https) address
 * whose host is exactly the government's. "tdac.immigration.go.th.example.com"
 * or "http://tdac.immigration.go.th" is not official.
 *
 * Chrome itself checks the site's certificate for https, so a page that passes
 * this check really is served by that government host.
 *
 * The list matches the official sites named on ArrivalFiller's website. Only
 * sites with `fills` are ones the extension can fill (and runs on, see the
 * manifest); the others are recognised so the popup can confirm them.
 */
import type { CountryId } from "./countries";

export interface OfficialSite {
  country: string;
  card: string;
  host: string;
  /** Set when ArrivalFiller can fill this site's form. */
  fills?: CountryId;
}

export const OFFICIAL_SITES: readonly OfficialSite[] = [
  { country: "Indonesia", card: "All Indonesia arrival card", host: "allindonesia.imigrasi.go.id", fills: "id" },
  { country: "Thailand", card: "TDAC", host: "tdac.immigration.go.th", fills: "th" },
  { country: "Malaysia", card: "MDAC", host: "imigresen-online.imi.gov.my" },
  { country: "Singapore", card: "SG Arrival Card", host: "eservices.ica.gov.sg" },
  { country: "Vietnam", card: "pre-arrival form", host: "prearrival.immigration.gov.vn" },
  { country: "Philippines", card: "eTravel", host: "etravel.gov.ph" },
];

/** The official site this address belongs to, or undefined if it isn't one. */
export function officialSite(url: string | undefined): OfficialSite | undefined {
  if (!url) return undefined;
  let u: URL;
  try { u = new URL(url); } catch { return undefined; }
  if (u.protocol !== "https:") return undefined;
  return OFFICIAL_SITES.find((s) => u.hostname === s.host);
}

/**
 * What kind of page the popup was opened on:
 * - "official": one of the official sites (green notice);
 * - "website": any other http(s) website (warning: travellers could type details there);
 * - "browser": Chrome's own pages (chrome://extensions, new tab, settings, the
 *   Web Store), local files, or an address the extension can't see. These aren't
 *   websites anyone fills a form on, so no notice: a warning there only confuses.
 */
export type PageKind = { kind: "official"; site: OfficialSite } | { kind: "website" } | { kind: "browser" };

export function pageKind(url: string | undefined): PageKind {
  const site = officialSite(url);
  if (site) return { kind: "official", site };
  let protocol = "";
  try { protocol = new URL(url ?? "").protocol; } catch { /* no address */ }
  return protocol === "https:" || protocol === "http:" ? { kind: "website" } : { kind: "browser" };
}

/** The official site ArrivalFiller fills for this country. */
export function fillSite(country: CountryId): OfficialSite {
  return OFFICIAL_SITES.find((s) => s.fills === country)!;
}

/** Notice text for the on-page panel and the popup. */
export const officialNotice = (s: OfficialSite) => `Official ${s.country} arrival card site: ${s.host}`;
