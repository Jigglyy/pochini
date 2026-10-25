# 5. Plain JSON files, never written over when unreadable

- **Status:** accepted
- **Date:** 2026-10-25

## Context

The library is small (a few hundred kilobytes at most) and people share macros as files, so a
database brings nothing but a dependency and an opaque file. Two failures shaped how the JSON
is handled:

- An early save renamed `macros.json` aside before putting the new file in place; a crash in
  that moment meant an empty library on the next start, and the next save wrote over the
  backup too.
- A file that was valid JSON but not readable by this build (written by a newer Pochini, or
  with an unknown step type) started an empty library with no copy kept, and two saves later
  the file and its backup were both empty.

## Decision

`macros.json` and `settings.json` under the app config folder, with a versioned schema
(docs/03-macro-format.md). Writes go to a temp file, the old file is copied to `.bak`, and one
rename replaces it, so `macros.json` is never missing. At startup (`Store::open_macros`)
anything unreadable is copied aside untouched, the backup is loaded if it reads (never past a
newer schema), and otherwise the library starts empty and **locked**: nothing is saved until
the user chooses Start fresh in the banner that explains what happened.

## Consequences

- A downgrade or a damaged file never costs the user their macros silently.
- Removing or changing a field means bumping `schema_version` and a migration step.
