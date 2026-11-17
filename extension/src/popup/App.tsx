/**
 * Popup: country, then travellers.
 *
 *   Consent (gate) -> Country -> Travellers <-> Add traveller -> Learning
 *
 * Each traveller's answers are learned by demonstration: they fill the real gov
 * form once while the recorder watches. Picking a traveller loads their answers;
 * "Fill" replays them on the form page. The popup never submits: the human
 * reviews and presses the government Submit. Each country keeps its own
 * travellers, because each form asks different questions.
 */
import { useEffect, useState } from "react";
import { AdFooter } from "../ui/AdFooter";
import { ConsentGate } from "../ui/ConsentGate";
import type { RecordingDraft } from "../lib/keys";
import { COUNTRY_KEY, type CountryId } from "../lib/countries";
import { getDraft } from "../lib/secureClient";
import { COUNTRY_KEYS } from "../lib/secureKeys";
import { LockLinks, VaultGate } from "./Lock";
import { COUNTRIES, INDONESIA, type Country } from "./countries";
import { officialNotice, pageKind, type OfficialSite, type PageKind } from "../lib/officialSites";
import "./popup.css";

type Phase = "loading" | "home" | "add" | "recording";

interface Traveller { id: string; label: string; count: number }

function Header({ chip, country }: { chip: { label: string; kind?: string }; country?: string }) {
  return (
    <div className="ia-head">
      <div className="ia-mark">
        <b>ArrivalFiller</b>
        <span>{country ?? "arrival card"}</span>
      </div>
      <div className={`ia-chip ${chip.kind ?? ""}`}>Status: {chip.label}</div>
    </div>
  );
}

/** Shown on an official arrival card site, so people know they're in the right place. */
function Official({ site }: { site: OfficialSite }) {
  return (
    <div className="ia-ok" role="note">
      <b>✓ {officialNotice(site)}.</b> Filling in the {site.card} here is free.
      {!site.fills && " ArrivalFiller can't fill this card yet, so fill it in yourself."}
    </div>
  );
}

/** Which notice to show: the official site's, or the warning. */
function SiteNotice({ page, country }: { page: PageKind; country: Country }) {
  if (page.kind === "official") return <Official site={page.site} />;
  if (page.kind === "website") return <NotOfficial country={country} />;
  return null; // Chrome's own pages (chrome://extensions, new tab…): not a website, no notice
}

/** Shown when the popup is opened anywhere but an official arrival card site. */
function NotOfficial({ country }: { country: Country }) {
  return (
    <div className="ia-warn" role="note">
      <b>This isn't the official arrival card site.</b> {country.name}'s arrival card is free, and only at{" "}
      <b>{country.officialHost}</b>. Don't enter passport details on other sites.{" "}
      <button className="ia-link ia-warn-link" onClick={() => void chrome.tabs.create({ url: country.fakeSitesGuide })}>
        How to spot a fake site
      </button>
    </div>
  );
}

function Picker({ country, choose }: { country: Country; choose: (id: CountryId) => void }) {
  return (
    <div className="ia-countries" role="radiogroup" aria-label="Country">
      {COUNTRIES.map((c) => (
        <button key={c.id} role="radio" aria-checked={c.id === country.id} className={c.id === country.id ? "on" : ""} onClick={() => choose(c.id)}>
          {c.name}
        </button>
      ))}
    </div>
  );
}

function Main({ country, picker }: { country: Country; picker: JSX.Element }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [travellers, setTravellers] = useState<Traveller[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>();
  const [recCount, setRecCount] = useState(0);
  const [name, setName] = useState("");
  const [status, setStatus] = useState("");
  const [onForm, setOnForm] = useState(true);
  const [onSite, setOnSite] = useState(true);
  // No notice until the tab's address has been checked.
  const [page, setPage] = useState<PageKind>({ kind: "browser" });
  const [filling, setFilling] = useState(false);

  const active = travellers.find((t) => t.id === activeId);
  const arrived = country.arrived({ onSite, onForm });
  const send = (msg: Record<string, unknown>) => chrome.runtime.sendMessage({ ...msg, country: country.id });

  function apply(res: { travellers?: Traveller[]; activeId?: string } | undefined) {
    setTravellers(res?.travellers ?? []);
    setActiveId(res?.activeId);
    return res?.travellers ?? [];
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!cancelled) {
        setOnForm(!!tab?.url && country.form.test(tab.url));
        setOnSite(!!tab?.url && country.site.test(tab.url));
        setPage(pageKind(tab?.url));
      }
      const res = await send({ type: "GET_TRAVELLERS" });
      if (cancelled) return;
      const list = apply(res);
      // The popup closes whenever you click into the page; a recording carries
      // on in storage, so come back to it.
      const draft = await readDraft();
      if (cancelled) return;
      if (draft?.active) {
        setRecCount(draft.fields?.length ?? 0);
        setPhase("recording");
      } else {
        setPhase(list.length ? "home" : "add");
      }
    })();
    const rev = COUNTRY_KEYS[country.id].rev;
    const onChanged = (changes: { [k: string]: chrome.storage.StorageChange }, area: string) => {
      if (area !== "local" || !(rev in changes)) return;
      void readDraft().then((draft) => { if (!cancelled && draft?.active) setRecCount(draft.fields?.length ?? 0); });
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => { cancelled = true; chrome.storage.onChanged.removeListener(onChanged); };
  }, []);

  async function readDraft(): Promise<RecordingDraft | undefined> {
    return getDraft(country.id);
  }

  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function select(id: string) {
    setStatus("");
    apply(await send({ type: "SELECT_TRAVELLER", id }));
  }

  /** Start learning a traveller's answers. Recorders pick this up in every form tab. */
  async function startLearning(travellerId = activeId) {
    await send({ type: "START_RECORDING", travellerId });
    setRecCount(0);
    setStatus("");
    setPhase("recording");
    if (!arrived) await country.open();
  }

  async function addTraveller() {
    const label = name.trim();
    if (!label) return setStatus("Type the traveller's name first.");
    const res = await send({ type: "ADD_TRAVELLER", label });
    apply(res);
    setName("");
    // By id, never by name: two travellers can share a name.
    await startLearning(res?.activeId);
  }

  async function finishLearning() {
    const tab = await activeTab();
    let fields: unknown[] = (await readDraft())?.fields ?? [];
    // Only this country's form: another country's recorder answers in its own format.
    if (tab?.url && country.site.test(tab.url)) {
      try {
        // The live recorder may hold keystrokes it hasn't written to the draft yet.
        const res = await chrome.tabs.sendMessage(tab.id!, { type: "FLUSH_RECORDING" });
        if ((res?.fields?.length ?? 0) >= fields.length) fields = res.fields;
      } catch {
        /* the form isn't ready: the saved draft has everything */
      }
    }
    const saved = await send({ type: "SAVE_LEARNED", fields });
    apply(await send({ type: "GET_TRAVELLERS" }));
    setPhase("home");
    setStatus(saved?.saved ? "Saved." : "Nothing new was filled in, so nothing changed.");
  }

  async function cancelLearning() {
    const res = await send({ type: "CANCEL_RECORDING" });
    if (res?.travellerId) await send({ type: "REOPEN_SHARED", travellerId: res.travellerId });
    setPhase(travellers.length ? "home" : "add");
  }

  async function fill() {
    if (filling) return;
    setFilling(true);
    setStatus("Filling…");
    const tab = await activeTab();
    const res = await send({ type: "GET_LEARNED" });
    chrome.tabs.sendMessage(tab!.id!, { type: "REPLAY_LEARNED", fields: res?.learned ?? [], travellerId: activeId }, (r) => {
      setFilling(false);
      if (chrome.runtime.lastError || !r?.ok) return setStatus(r?.error ?? country.fillError);
      const { filled, opened, missing } = r.result;
      const bits = [`Filled ${filled.length}`];
      if (opened.length) bits.push(`${opened.length} to do yourself`);
      if (missing.length) bits.push(`${missing.length} not on this ${country.unit}`);
      setStatus(`${bits.join(" · ")}. Check every field before moving on.`);
    });
  }

  async function remove(t: Traveller) {
    if (!window.confirm(`Delete ${t.label} and their saved answers?`)) return;
    const list = apply(await send({ type: "DELETE_TRAVELLER", id: t.id }));
    if (!list.length) setPhase("add");
  }

  async function eraseAll() {
    if (!window.confirm("Erase every traveller and all saved answers, for every country, from this browser?")) return;
    await send({ type: "WIPE_DATA" });
    apply(undefined);
    setPhase("add");
  }

  const ad = <AdFooter ads={country.ads} />;

  // ---- render ----
  if (phase === "loading") {
    return <div className="ia"><Header chip={{ label: "···" }} country={country.name} /><div className="ia-body" /></div>;
  }

  if (phase === "recording") {
    return (
      <div className="ia">
        <Header chip={{ label: "Learning", kind: "rec" }} country={country.name} />
        <div className="ia-body">
          <SiteNotice page={page} country={country} />
          <h1 className="ia-h1">{active ? `Learning ${active.label}'s answers` : "Learning answers"}</h1>
          <p className="ia-lede">{country.learningHint}</p>
          <div className="ia-panel">
            <div className="ia-stat"><b>{recCount}</b><span>answers so far</span></div>
          </div>
          <button className="ia-btn ia-btn-primary" onClick={finishLearning}>
            <span className="ia-rec-dot" /> Done: save answers
          </button>
          <button className="ia-link" onClick={cancelLearning}>Cancel</button>
          {status && <div className="ia-status">{status}</div>}
        </div>
        {ad}
      </div>
    );
  }

  if (phase === "add") {
    const first = travellers.length === 0;
    return (
      <div className="ia">
        <Header chip={{ label: "Setup" }} country={country.name} />
        <div className="ia-body">
          {picker}
          <SiteNotice page={page} country={country} />
          <h1 className="ia-h1">{first ? `Fill ${country.name}'s card once` : "Add a traveller"}</h1>
          <p className="ia-lede">
            {first
              ? "Next trip, it fills itself. Type who is travelling, then fill the form as usual. ArrivalFiller remembers the answers."
              : "Fill the form for them once. ArrivalFiller remembers their answers for next time."}
          </p>
          <label className="ia-label" htmlFor="ia-name">Traveller's name</label>
          <input
            id="ia-name"
            className="ia-input"
            value={name}
            placeholder="e.g. Alex"
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void addTraveller(); }}
          />
          <button className="ia-btn ia-btn-primary" onClick={addTraveller}>
            {arrived ? "Start" : `Start: opens ${country.opens}`}
          </button>
          {!first && (
            <div className="ia-row ia-foot">
              <button className="ia-link" onClick={() => { setStatus(""); setPhase("home"); }}>Back</button>
              <button className="ia-link" onClick={eraseAll}>Erase all data</button>
            </div>
          )}
          {status && <div className="ia-status">{status}</div>}
        </div>
        {ad}
      </div>
    );
  }

  // home
  const ready = !!active?.count;
  return (
    <div className="ia">
      <Header chip={ready ? { label: "Ready", kind: "ready" } : { label: "Setup" }} country={country.name} />
      <div className="ia-body">
        {picker}
        <SiteNotice page={page} country={country} />
        <h1 className="ia-h1">Who's travelling?</h1>
        <div className="ia-people" role="radiogroup" aria-label="Traveller">
          {travellers.map((t) => (
            <div key={t.id} className={`ia-person ${t.id === activeId ? "on" : ""}`}>
              <button role="radio" aria-checked={t.id === activeId} className="ia-person-pick" onClick={() => select(t.id)}>
                <span className="ia-dot" />
                <span className="ia-person-name">{t.label}</span>
                <span className="ia-person-meta">{t.count ? `${t.count} answers` : "not learned yet"}</span>
              </button>
              <button className="ia-x" aria-label={`Delete ${t.label}`} title="Delete" onClick={() => remove(t)}>×</button>
            </div>
          ))}
          <button className="ia-person-add" onClick={() => { setStatus(""); setPhase("add"); }}>+ Add traveller</button>
        </div>

        {!ready ? (
          <button className="ia-btn ia-btn-primary" onClick={() => startLearning()}>
            Learn {active?.label}'s answers{arrived ? "" : `: opens ${country.opens}`}
          </button>
        ) : onForm ? (
          <button className="ia-btn ia-btn-primary" onClick={fill} disabled={filling}>
            {filling ? "Filling…" : `Fill this ${country.unit} as ${active?.label}`}
          </button>
        ) : onSite && country.clickThrough ? (
          <p className="ia-lede">Press <b>{country.clickThrough}</b> on the site, then press Fill on each {country.unit}.</p>
        ) : (
          <button className="ia-btn ia-btn-primary" onClick={() => country.open()}>Open the arrival card form</button>
        )}
        <p className="ia-note-muted">{ready ? country.fillHint : country.learnHint}</p>
        {status && <div className="ia-status">{status}</div>}

        <div className="ia-row ia-foot">
          {ready ? <button className="ia-link" onClick={() => startLearning()}>Teach {active?.label} more</button> : <span />}
          <button className="ia-link" onClick={eraseAll}>Erase all data</button>
        </div>
        <div className="ia-row ia-foot"><LockLinks /></div>
      </div>
      {ad}
    </div>
  );
}

/** Which country to show: a recording in progress first, then the open tab, then the last pick. */
function Countries() {
  const [country, setCountry] = useState<Country | undefined>();

  useEffect(() => {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const saved = await chrome.storage.local.get(COUNTRY_KEY);
      const drafts = await Promise.all(COUNTRIES.map((c) => getDraft(c.id)));
      const recording = COUNTRIES.filter((_, i) => drafts[i]?.active);
      const fromTab = COUNTRIES.find((c) => !!tab?.url && c.site.test(tab.url));
      const picked = COUNTRIES.find((c) => c.id === saved[COUNTRY_KEY]);
      setCountry(recording.find((c) => c === fromTab) ?? recording[0] ?? fromTab ?? picked ?? INDONESIA);
    })();
  }, []);

  if (!country) return null;

  function choose(id: CountryId) {
    setCountry(COUNTRIES.find((c) => c.id === id));
    void chrome.storage.local.set({ [COUNTRY_KEY]: id });
  }

  const picker = <Picker country={country} choose={choose} />;
  // Keyed: switching country starts from that country's own travellers.
  return <Main key={country.id} country={country} picker={picker} />;
}

export function App() {
  return (
    <ConsentGate>
      <VaultGate>
        <Countries />
      </VaultGate>
    </ConsentGate>
  );
}
