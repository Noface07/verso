# Folio Privacy Policy

Last updated: October 2026

Folio is designed with a strict privacy-first philosophy. Your reading habits, notes, library contents, and books are your personal data.

---

## 1. Zero Telemetry & Tracking by Default
- Folio contains **no analytics SDKs, advertising trackers, or telemetry by default**.
- We do not track what you read, how fast you read, when you open the app, or what books are in your collection.

## 2. Information Stored on Your Devices
- Your books, reading progress, annotations, highlights, bookmarks, and appearance settings are stored locally on your device in local databases (IndexedDB on web, local storage on Windows and Android).
- You can export a full, unencrypted backup archive of your entire data at any time via **Settings → Backup & Restore**.

## 3. Synced Accounts & Server Storage
If you choose to register an account with a Folio sync server:
- **Account Details**: Your email address and a securely salted and hashed password (hashed with Argon2/bcrypt).
- **Synced State**: Reading progress, annotations, bookmarks, reading sessions, collection tags, and file hashes needed for multi-device sync.
- **Book Files**: Encrypted or raw book files uploaded to your personal storage quota so other authorized devices can download them.
- **Tenant Isolation**: Your data is isolated strictly to your account ID. No other user on the server has access to your library or files.
- **Account Deletion**: You can permanently delete your account and wipe all associated database rows and uploaded files at any time via **Settings → Account → Delete Account**.

## 4. External Lookups & Third-Party Services
When using interactive reading lookup features:
- **Dictionary Lookups**: When you highlight a word and choose "Define", Folio contacts Wiktionary or Free Dictionary API with only the highlighted word. No personal information or context is sent.
- **Translations**: When using "Translate", Folio sends the selected text snippet to the translation service (e.g. MyMemory or user-configured provider).
- **Manga Discovery**: Browsing MangaDex interacts with the public MangaDex API in accordance with their Acceptable Use Policy.
- **Public Catalogs**: Store browsing communicates with Project Gutenberg / Standard Ebooks feeds.

## 5. Anonymous Diagnostic & Crash Reporting (Opt-In Only)
- Crash reporting is **turned off by default**.
- If you voluntarily opt in under **Settings → About → Anonymous Error Reporting**, Folio transmits anonymous technical crash stacks to help identify bugs.
- All authorization tokens, passwords, cookies, and sensitive parameters are automatically redacted before transmission. Book content and personal reading data are never included in crash reports.

## 6. Contact & Source Code
Folio is open-source software. You can inspect all networking and storage code at our repository.
For questions regarding this policy, visit the GitHub project repository.
