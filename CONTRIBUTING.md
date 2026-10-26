# Contributing to Pochini

Thanks for helping. Bug reports, ideas and pull requests are all welcome. This page is the
short version; the full working rules (the Windows input rules that silently break this kind
of app, UI conventions, test conventions) are in [CLAUDE.md](CLAUDE.md), which is written for
human and AI contributors alike.

## Before you start

- **Bugs:** open an issue with the bug form. The Pochini version, your Windows version, your
  monitor setup with each monitor's scaling, and whether the target app runs as administrator
  answer most questions before they are asked.
- **Features:** open an issue first for anything bigger than a small fix, so we can agree on
  the shape before you spend time on it.
- **Security problems:** never in a public issue. See [SECURITY.md](SECURITY.md).

## What Pochini will not do

Pochini is an honest automation tool. It uses documented Windows APIs and makes no attempt to
hide that its input is synthetic. Pull requests that add anti-cheat evasion, input "laundering"
(clearing `LLMHF_INJECTED` and the like), kernel or HID input drivers, or process hiding will be
closed. If an app rejects synthetic input, that app is unsupported. Many online games forbid
macros; that is between a player and their game.

## Setting up

You need Windows 10 or 11, [Node](https://nodejs.org) 22 or newer, the Rust toolchain
([rustup](https://rustup.rs)) and the Visual Studio C++ build tools.

```powershell
npm install
npm run tauri dev          # run the app
npm run verify             # types, guards, clippy and the Rust tests
npm run e2e                # the Playwright suite against the real app (hidden windows)
```

The e2e suite starts the real app in a test mode with a fake mouse and keyboard, no keyboard
hook and hidden windows, so it is safe to run while you work. Never write tests that send real
keystrokes; they land in whatever window has focus.

The first run (and the first after you change your Windows password) shows one failed sign-in
in your Security log: WebView2 checks once whether your password is blank, and the suite keeps
its answer in `e2e/.cache` so no test repeats the check. Without that, a run made a failed
sign-in per test and Windows locked the account. If the counter of failed sign-ins ever rises
during a run, the run stops; see `e2e/_webview.ts`.

## Pull requests

- **Tests are part of the change.** New behaviour comes with tests; a bug fix starts with a
  test that fails without it. Rust logic is tested against `FakeInput` (`cargo test`), the UI
  with Playwright (`e2e/`).
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org) (`feat:`,
  `fix:`, `docs:`, `refactor:`, `test:`, `chore:`) with a body that says why. The history is
  read as the project's design notes.
- **Dependencies** must be permissively licensed (MIT, Apache-2.0, BSD, ISC, Zlib and similar).
  Name the license in the commit body. Run `npm run notices` if you change dependencies.
- **Writing style:** no em dash characters anywhere (code, comments, docs, UI text); use a
  hyphen, a comma or parentheses. `npm run guards` checks it.
- **Never log keystrokes**, not even temporarily while debugging. To debug hotkeys use
  Settings > Hotkey check or the unit tests in `src-tauri/src/hotkey/logic.rs`.
- Add a line under `## Unreleased` in [CHANGELOG.md](CHANGELOG.md) for anything a user would
  notice.

CI runs the checks and the e2e suite on every pull request. Releases are cut by the
maintainer.

## License

By contributing you agree that your work is released under the project's
[MIT license](LICENSE).
