/**
 * The optional passphrase/PIN lock. Off by default. When on, saved travellers
 * are encrypted and the popup asks for the passphrase or PIN once per browser
 * session. The secret is only ever typed here, never on a government page.
 */
import { createContext, Fragment, useContext, useEffect, useState, type ReactNode } from "react";
import { MIN_PASSPHRASE, MIN_PIN, type SecretKind } from "../lib/vaultCrypto";
import { LOCK_REQUIRED } from "../lib/lockPolicy";

interface Status { enabled: boolean; unlocked: boolean; kind?: SecretKind }
type Screen = "none" | "setup" | "off";

const VaultContext = createContext<{ status: Status; show: (s: Screen) => void; lockNow: () => void }>({
  status: { enabled: false, unlocked: false },
  show: () => {},
  lockNow: () => {},
});
export const useVault = () => useContext(VaultContext);

const send = (msg: Record<string, unknown>) => chrome.runtime.sendMessage(msg);

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="ia">
      <div className="ia-head">
        <div className="ia-mark"><b>ArrivalFiller</b><span>lock</span></div>
      </div>
      <div className="ia-body">
        <h1 className="ia-h1">{title}</h1>
        {children}
      </div>
    </div>
  );
}

function SecretInput({ id, kind, value, onChange, onEnter, autoFocus }: {
  id: string; kind: SecretKind; value: string; onChange: (v: string) => void; onEnter?: () => void; autoFocus?: boolean;
}) {
  return (
    <input
      id={id}
      className="ia-input"
      type="password"
      inputMode={kind === "pin" ? "numeric" : undefined}
      autoComplete="off"
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(kind === "pin" ? e.target.value.replace(/\D/g, "") : e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") onEnter?.(); }}
    />
  );
}

function Unlock({ kind, done }: { kind: SecretKind; done: () => void }) {
  const [secret, setSecret] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const word = kind === "pin" ? "PIN" : "passphrase";

  async function unlock() {
    if (busy || !secret) return;
    setBusy(true);
    setStatus("Unlocking…");
    const res = await send({ type: "VAULT_UNLOCK", secret });
    setBusy(false);
    setSecret("");
    if (res?.ok) return done();
    setStatus(res?.error ?? "Couldn't unlock.");
  }

  async function erase() {
    if (!window.confirm(`Without your ${word} your saved details can't be read. Erase every traveller and saved answer, and remove the lock?`)) return;
    await send({ type: "WIPE_DATA" });
    done();
  }

  return (
    <Shell title="Unlock ArrivalFiller">
      <p className="ia-lede">Your saved travellers are locked. Enter your {word} to use them until you close the browser.</p>
      <label className="ia-label" htmlFor="ia-secret">{kind === "pin" ? "PIN" : "Passphrase"}</label>
      <SecretInput id="ia-secret" kind={kind} value={secret} onChange={setSecret} onEnter={unlock} autoFocus />
      <button className="ia-btn ia-btn-primary" onClick={unlock} disabled={busy || !secret}>Unlock</button>
      {status && <div className="ia-status">{status}</div>}
      <div className="ia-row ia-foot">
        <span />
        <button className="ia-link" onClick={erase}>Forgot it? Erase all data</button>
      </div>
    </Shell>
  );
}

function Setup({ done, required }: { done: () => void; required?: boolean }) {
  const [kind, setKind] = useState<SecretKind>("passphrase");
  const [secret, setSecret] = useState("");
  const [again, setAgain] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  function pick(k: SecretKind) { setKind(k); setSecret(""); setAgain(""); setStatus(""); }

  async function turnOn() {
    if (busy) return;
    if (secret !== again) return setStatus("They don't match. Type it again.");
    setBusy(true);
    setStatus("Locking your saved details…");
    const res = await send({ type: "VAULT_ENABLE", secret, kind });
    setBusy(false);
    if (res?.ok) return done();
    setStatus(res?.error ?? "Couldn't turn on the lock.");
  }

  return (
    <Shell title="Lock your saved details">
      <p className="ia-lede">
        ArrivalFiller encrypts the passports and answers it saves. Without your {kind === "pin" ? "PIN" : "passphrase"}, someone who copies
        this browser's files can't read them. You enter it once each time you open the browser.
      </p>
      <div className="ia-countries" role="radiogroup" aria-label="Lock type">
        <button role="radio" aria-checked={kind === "passphrase"} className={kind === "passphrase" ? "on" : ""} onClick={() => pick("passphrase")}>Passphrase</button>
        <button role="radio" aria-checked={kind === "pin"} className={kind === "pin" ? "on" : ""} onClick={() => pick("pin")}>PIN</button>
      </div>
      {kind === "pin" && (
        <p className="ia-note-muted">
          A PIN is quicker but weaker. It stops automated theft, but someone determined who copies your browser's files could guess it. A passphrase is much safer.
        </p>
      )}
      <label className="ia-label" htmlFor="ia-new">{kind === "pin" ? `PIN (at least ${MIN_PIN} digits)` : `Passphrase (at least ${MIN_PASSPHRASE} characters)`}</label>
      <SecretInput id="ia-new" kind={kind} value={secret} onChange={setSecret} autoFocus />
      <label className="ia-label" htmlFor="ia-again">Type it again</label>
      <SecretInput id="ia-again" kind={kind} value={again} onChange={setAgain} onEnter={turnOn} />
      <p className="ia-note-muted">If you forget it, your saved details can't be recovered. You'd erase them and fill each form once again.</p>
      <button className="ia-btn ia-btn-primary" onClick={turnOn} disabled={busy || !secret || !again}>Turn on lock</button>
      {status && <div className="ia-status">{status}</div>}
      {!required && (
        <div className="ia-row ia-foot">
          <button className="ia-link" onClick={done}>Not now</button>
          <span />
        </div>
      )}
    </Shell>
  );
}

function TurnOff({ kind, done }: { kind: SecretKind; done: () => void }) {
  const [secret, setSecret] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const word = kind === "pin" ? "PIN" : "passphrase";

  async function turnOff() {
    if (busy || !secret) return;
    setBusy(true);
    const res = await send({ type: "VAULT_DISABLE", secret });
    setBusy(false);
    setSecret("");
    if (res?.ok) return done();
    setStatus(res?.error ?? "Couldn't turn off the lock.");
  }

  return (
    <Shell title="Turn off the lock">
      <p className="ia-lede">Your saved details will be stored without encryption again. Enter your {word} to confirm.</p>
      <label className="ia-label" htmlFor="ia-off">{kind === "pin" ? "PIN" : "Passphrase"}</label>
      <SecretInput id="ia-off" kind={kind} value={secret} onChange={setSecret} onEnter={turnOff} autoFocus />
      <button className="ia-btn ia-btn-primary" onClick={turnOff} disabled={busy || !secret}>Turn off lock</button>
      {status && <div className="ia-status">{status}</div>}
      <div className="ia-row ia-foot">
        <button className="ia-link" onClick={done}>Back</button>
        <span />
      </div>
    </Shell>
  );
}

/** Shows the unlock screen while locked; otherwise the popup, with lock settings one link away. */
export function VaultGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status | undefined>();
  const [screen, setScreen] = useState<Screen>("none");
  // Remount the popup after any lock change, so it re-reads travellers.
  const [round, setRound] = useState(0);

  async function refresh() {
    const res = await send({ type: "VAULT_STATUS" });
    setStatus({ enabled: !!res?.enabled, unlocked: !!res?.unlocked, kind: res?.kind });
    setScreen("none");
    setRound((r) => r + 1);
  }
  useEffect(() => { void refresh(); }, []);

  if (!status) return null;
  const kind = status.kind ?? "passphrase";
  if (status.enabled && !status.unlocked) return <Unlock kind={kind} done={refresh} />;
  if (LOCK_REQUIRED && !status.enabled) return <Setup done={refresh} required />;
  if (screen === "setup" && !status.enabled) return <Setup done={refresh} />;
  if (screen === "off" && status.enabled) return <TurnOff kind={kind} done={refresh} />;

  const lockNow = () => void send({ type: "VAULT_LOCK" }).then(refresh);
  return (
    <VaultContext.Provider value={{ status, show: setScreen, lockNow }}>
      <Fragment key={round}>{children}</Fragment>
    </VaultContext.Provider>
  );
}

/** Footer links for the home screen. */
export function LockLinks() {
  const { status, show, lockNow } = useVault();
  if (!status.enabled) return <button className="ia-link" onClick={() => show("setup")}>Lock with passphrase or PIN</button>;
  return (
    <>
      <button className="ia-link" onClick={lockNow}>Lock now</button>
      {!LOCK_REQUIRED && <button className="ia-link" onClick={() => show("off")}>Turn off lock</button>}
    </>
  );
}
