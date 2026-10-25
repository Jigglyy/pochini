# 6. Releases build from main, and only the owner's push publishes

- **Status:** accepted
- **Date:** 2026-10-25

## Context

Every version is a portable exe published as a GitHub Release. Tag-triggered builds could
never reuse the build cache (GitHub scopes caches per ref, and a tag only reads its own or
main's), so each release compiled everything, about 20 minutes. The repository is also about
to be public with more than one collaborator, and the release job holds a token that can
write.

## Decision

Pushing a `chore(release): X.Y.Z` commit to main triggers `.github/workflows/release.yml`.
A read-only `build` job checks that the commit, `package.json` and `Cargo.toml` agree and that
the third-party notices are current, builds, smoke-checks the exe (`--smoke`) and hashes it.
A separate `publish` job, the only one with write access, runs no build code, uses the
`release` environment, and runs only for pushes by the repository owner. It creates the tag
and the release with the exe, `SHA256SUMS.txt`, `THIRD_PARTY_NOTICES.md` and, on a public
repository, a build provenance attestation. Every action is pinned to a commit SHA.

Tests run locally before each release (`cargo test`, `npm run e2e`); pull requests run them
in `ci.yml`.

## Consequences

- A release rebuilds only what changed (about 6 minutes warm).
- A collaborator's release commit builds but does not publish.
- Required reviewers on the `release` environment need a public repository on the current
  plan; add them after the switch.
