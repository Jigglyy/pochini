# 10. MIT license, with generated third-party notices

- **Status:** accepted
- **Date:** 2026-10-25

## Context

The repository is becoming public; without a license it would be "all rights reserved". The
exe statically contains about 256 Rust crates and 89 npm packages whose MIT, BSD, Apache and
similar licenses ask for their notices to travel with copies. Five crates that Tauri pulls in
are MPL-2.0, a file-level copyleft.

## Decision

Pochini is MIT licensed, like Kanbini. `scripts/notices.mjs` generates
`THIRD_PARTY_NOTICES.md` from the normal dependency graph (`cargo metadata`, `npm ls
--omit=dev`) and each package's own license files, with Microsoft's WebView2 SDK license
vendored because its crate ships none. The exe embeds the file (Settings > About), every
release attaches it, and the release build refuses a stale one. New dependencies must be
permissive; the MPL-2.0 crates are an accepted exception, used unmodified.

## Consequences

- `npm run notices` after any dependency change (`scripts/release.mjs` runs it).
- Contributors license their work under MIT.
