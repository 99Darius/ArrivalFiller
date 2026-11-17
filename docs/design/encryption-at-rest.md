# Design: encrypt saved traveller data at rest

Status: implemented on branch `feat/encrypt-at-rest` with these decisions:
- **Optional by default, mandatory is the maintainer's call.** Off by default; turned on from the popup ("Lock with passphrase or PIN"). Setting `LOCK_REQUIRED = true` in `extension/src/lib/lockPolicy.ts` makes it mandatory: the popup asks for a passphrase or PIN before anything else (existing users on next open, which encrypts their data), it can't be turned off, and the background refuses to save personal data until it is set.
- **User chooses** a passphrase (default, 10+ characters) or a PIN (6+ digits, with a warning that it is weaker).
- **Locks when the browser closes**, plus a "Lock now" link. No idle timer.
- Passphrase change = turn off, turn on again (not a separate screen yet).
- Five wrong tries, then 30 seconds between tries (session memory only).
- While locked, the on-page panel stays hidden; unlock from the toolbar popup.

## Problem

Everything ArrivalFiller saves (names, passport numbers and expiry dates,
dates of birth, contact details, health answers) for every traveller is plain
JSON in `chrome.storage.local`, i.e. in LevelDB files under the browser
profile folder. Infostealer malware routinely copies profile folders and
parses them offline. A copied profile today yields complete identity records
for the user and their family.

Chrome encrypts its own password and autofill stores with an OS-protected key.
Extension storage gets no such protection, so the extension has to provide it.

## Goals and non-goals

Goals:
- A copied profile folder (offline attacker) does not reveal traveller data.
- Fill and record still work after one unlock per browser session.
- Existing users are migrated without losing data.

Non-goals (out of reach for an extension, stated so nobody over-promises):
- Malware running as the user while the browser is open and unlocked. It can
  read process memory or capture the PIN as it is typed.
- Someone using the unlocked browser in person.
- A determined attacker cracking a short PIN offline (see "PIN strength").

## Scheme

All crypto via WebCrypto (`crypto.subtle`), available in the service worker
and popup. No new dependencies.

1. **Data key (DEK):** random 256-bit AES-GCM key, generated once.
2. **Key-encryption key (KEK):** `PBKDF2-SHA256(passphrase, salt, 600_000)`,
   where the salt is 16 random bytes. 600k matches OWASP's current PBKDF2-SHA256 guidance.
3. **Stored header** (`chrome.storage.local`, key `vault`):
   `{ v: 1, kdf: "pbkdf2-sha256", iter, salt, wrappedDek: { iv, ct } }`.
   The DEK is wrapped with AES-GCM under the KEK. A wrong passphrase fails
   the GCM tag check, so there is no separate verifier to leak.
4. **Each sensitive value** is stored as `{ v: 1, iv, ct }`. Fresh 96-bit
   random IV per write. AAD = the storage key name, so ciphertext can't be
   moved from one key to another (e.g. Thai profiles swapped into the
   Indonesian slot).
5. **Unlocked DEK** is exported raw and held only in `chrome.storage.session`
   (memory only, gone when the browser closes or the extension reloads).
   Session storage keeps its default `TRUSTED_CONTEXTS` access level, so
   content scripts can never read it. Optional auto-lock after N hours of
   inactivity via `chrome.alarms` (clears the session entry).
6. **Change passphrase** re-wraps the DEK only. No data re-encryption.

### What is encrypted

| Key (both countries) | Encrypted | Why |
| --- | --- | --- |
| `local_profiles`, `th_local_profiles` | yes | names, all answers |
| `learned`, `th_learned` | yes | active traveller's answers |
| `recording_draft`, `th_recording_draft` | yes | answers mid-recording |
| `active_profile`, `consent`, `review_ask`, `ad_turn`, `shared_offer_closed`, country | no | ids and counters, no personal data |

## Architecture prerequisite

Today several content scripts read `learned`, `recording_draft` and the Thai
profile list straight from `chrome.storage.local`, and react to
`storage.onChanged`. Once those values are ciphertext, that stops working,
and the DEK must never be given to a content script.

So, before encryption lands:
- All reads and writes of those keys move to the background service worker
  (the background already owns most writes): add draft get/save messages,
  extend `GET_LEARNED`, and replace content-script `onChanged` listeners with
  a background-to-tab notification carrying only what that page needs.
- Call `chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })`
  so content scripts can't read storage directly at all.

This is a self-contained refactor and should be its own PR first.

## UX

- **Setup:** the popup asks for a passphrase the first time a traveller is
  saved (new installs) or on first open after the update (existing users).
- **Locked:** the popup shows an unlock field. On the government page the
  Fill button says "Unlock ArrivalFiller from the toolbar to fill". The
  passphrase is **only ever typed into the extension popup**, never into a
  field on a government page.
- **Recording** requires the vault to be unlocked when it starts (the user
  already opens the popup to pick a traveller).
- **Forgotten passphrase:** data is unrecoverable by design. The only path is
  "Erase all data" and re-teach. The setup screen says this plainly. No
  recovery key, because a recovery key stored on the device defeats the purpose.
- **Wrong attempts:** increasing delay in the popup. This helps only against
  someone at the keyboard, not offline cracking.

## PIN strength (needs a decision)

PBKDF2 slows guessing but doesn't fix low entropy. A 6-digit PIN is 10^6
guesses × 600k iterations, which is minutes to hours on one GPU. That still
defeats bulk, automated harvesting (stealers parse plaintext at scale and
won't crack per victim), but not a targeted attacker.

Options:
- (a) Passphrase with a minimum (e.g. 10+ characters or 4 words). Strongest,
  more friction.
- (b) PIN allowed, with honest wording ("stops automated theft, not a
  determined attacker").
- (c) Argon2id via WASM instead of PBKDF2: memory-hard, much costlier on GPUs.
  It adds a dependency, and WebCrypto doesn't provide it.
- Future: WebAuthn PRF (passkey-derived key, hardware-bound). Worth checking
  how well it's supported in extension pages before relying on it.

Recommendation: (a) by default, (b) as an explicit, warned choice.

## Migration

chrome.storage has no transactions, so the migration must be safe to
interrupt:
1. Generate DEK, write `vault` header.
2. For each sensitive key: encrypt, write to `enc:<key>`, read back and
   decrypt to verify.
3. Only then `remove()` the plaintext keys.
4. On startup, if both plaintext and `enc:` exist, a previous run was
   interrupted: redo from step 2 (idempotent).

Honest caveat for the privacy policy: removing a key doesn't guarantee the
old plaintext is gone from LevelDB files on disk until compaction. The
extension can't shred it. Users who want certainty can erase and re-teach
after migrating.

## Testing

- Unit (vitest, Node WebCrypto): wrap/unwrap, wrong passphrase, AAD swap
  rejected, IV uniqueness, change-passphrase.
- Migration: interrupt after each step, then restart, with no data loss and
  no leftover plaintext.
- Locked state: no fill, no plaintext returned by any message.
- Manual check: with fake data (Alex Tan, K0000000X), copy the profile's
  `Local Extension Settings/<id>` folder and grep for `K0000000X`.
  Expect no match after migration and compaction.

## Privacy policy

Replace the storage sentence with, once shipped:

> ArrivalFiller encrypts the details it saves with a key made from your
> passphrase. Without the passphrase, someone who copies your browser profile
> can't read them. While ArrivalFiller is unlocked, the key is kept in memory
> only until you close the browser. If you forget your passphrase, your saved
> details can't be recovered. Erase them and teach the form again.

## Open questions for the maintainer

1. Mandatory for everyone, or opt-in? (One-line switch: `LOCK_REQUIRED` in `lib/lockPolicy.ts`.)
2. PIN vs passphrase (see above).
3. Auto-lock timeout, or only on browser close?
4. OK to require the storage-routing refactor as a separate PR first?
