## What and why

<!-- What does this change, and why? Link the issue if there is one ("Fixes #12"). -->

## How it was tested

<!-- New tests, and anything you checked by hand (which Windows version, which display scaling). -->

## Checklist

- [ ] Tests come with the change (a bug fix starts with a test that fails without it)
- [ ] `npm run verify` passes (types, guards, clippy, `cargo test`)
- [ ] `npm run e2e` passes, if the UI changed
- [ ] A line under `## Unreleased` in CHANGELOG.md, if a user would notice the change
- [ ] New dependencies are permissively licensed (named in the commit body), and `npm run notices` was run
- [ ] Nothing logs keystrokes, nothing hides synthetic input (see CONTRIBUTING.md)
