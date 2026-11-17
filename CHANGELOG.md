# Changelog

## Unreleased

### Added
- **Optional passphrase or PIN lock.** Saved travellers (names, passport numbers, dates of birth, health answers) can be locked from the toolbar window. Once locked, they are stored encrypted, so a copy of the browser's files shows only scrambled data.
  - The user unlocks once per browser session, and it locks again when the browser closes. "Lock now" locks it straight away.
  - A passphrase (10+ characters) is the default. A PIN (6+ digits) is allowed, with a warning that it's easier to guess.
  - After 5 wrong tries, each further try waits longer, starting at 30 seconds, up to an hour.
  - A forgotten passphrase can't be recovered. "Erase all data" removes the data and the lock, so the user can start again.
  - Off by default. Setting `LOCK_REQUIRED` in `extension/src/lib/lockPolicy.ts` makes it compulsory for everyone.
  - Encryption is AES-GCM, with a key derived from the passphrase by PBKDF2-SHA256 (600,000 rounds). The unlocked key is kept only in session memory.
  - Turning the lock on deletes data that versions before 1.0 left in plain text and nothing reads any more.
- **Official-site check.** The extension checks the site is the real government one: a secure (https) address whose name exactly matches the official site, so lookalikes such as `tdac.immigration.go.th.example.com` fail.
  - On the official site, the toolbar window and the helper panel on the form show "✓ Official [country] arrival card site: [address]".
  - The toolbar window also says filling in the card there is free.
  - It recognises all six official sites named on the ArrivalFiller website:
    - Indonesia (`allindonesia.imigrasi.go.id`) and Thailand (`tdac.immigration.go.th`), which it can fill.
    - Malaysia's MDAC (`imigresen-online.imi.gov.my`), the SG Arrival Card (`eservices.ica.gov.sg`), Vietnam's pre-arrival form (`prearrival.immigration.gov.vn`) and the Philippines' eTravel (`etravel.gov.ph`). For these four, the toolbar window confirms the site and says ArrivalFiller can't fill them yet.
  - One list of official sites is used for this check and for where Chrome runs the extension, so they can't drift apart.
  - New permission, `activeTab`: when the user opens the toolbar window, it can see the open tab's address to check it. Chrome shows no install warning for it. The address is not stored or sent anywhere. The extension still runs only on the two sites it fills.
- **Warning on sites that aren't the official one.** Opening the extension anywhere other than the official arrival card site shows "This isn't the official arrival card site", naming the official site and noting the card is free there. A "How to spot a fake site" link opens that country's fake-websites guide on the ArrivalFiller website. It also shows while answers are being recorded. It shows only on websites: Chrome's own pages (such as `chrome://extensions` and the new tab page) show no notice, so users aren't confused.

### Changed
- On-page scripts now get saved details from the extension's background instead of reading browser storage directly. This makes encryption possible.
- Lock settings and "Erase all data" only work from the extension's toolbar window.

### Fixed
- **Developer tools updated** (they build and test the extension, and aren't shipped to users): Vite 5.4 → 8.3.8, Vitest 2.1 → 5.1.0, Vite React plugin 4.7 → 6.3.0, CRXJS 2.7.0 → 2.7.1. Bundled parts fixed by the update: Tinypool (removed), esbuild, PostCSS, nanoid, source-map-js, browserslist. Known security flaws: 11 (2 critical) → 0.
- Every package in `package-lock.json` now has a security fingerprint, so a tampered download is rejected. 99 were missing one.
- A code note no longer claims saved data has the "same trust level" as Chrome's autofill. Chrome encrypts its own autofill; extension storage isn't encrypted unless the new lock is on.

### Docs
- Design note: `docs/design/encryption-at-rest.md`.
