# Security policy

Pochini installs a system-wide keyboard hook and sends synthetic mouse and keyboard input,
so security and privacy bugs matter more here than in most desktop apps. Thank you for
taking the time to report one.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private
reporting instead: the repository's **Security** tab, then **Report a vulnerability**. Only
the maintainer sees the report.

Include what you found, how to reproduce it (a macro file, steps, the Pochini version from
Settings > About and your Windows version), and what an attacker could do with it. You will
get a reply within a week. Once a fix is released, the report is published as a security
advisory with credit to you, unless you would rather stay anonymous.

## Supported versions

Only the latest release gets security fixes. Pochini updates by downloading the new exe from
[Releases](https://github.com/Jigglyy/pochini/releases/latest).

## What counts

Examples of what we want to hear about:

- Anything that makes the keyboard hook keep, log, send or expose what you type, beyond
  matching it against your own hotkeys.
- An imported `.pochini.json` that runs, or turns its hotkey on, without passing the review
  dialog, or that does something the review did not show.
- A way to run script in Pochini's window that it did not ship (it runs under a strict
  content security policy, and that script could move your mouse).
- A release build that can be put into the e2e test mode (it reads `POCHINI_E2E` and opens a
  DevTools port in debug builds only).
- A macro that keeps keys or mouse buttons held down after it is stopped, or that the panic
  key cannot stop.
- Problems in how releases are built and published (`.github/workflows/release.yml`).

Not security bugs:

- SmartScreen or antivirus warnings. The exe is unsigned and uses a keyboard hook and
  `SendInput`, which is what those tools look for. See the README.
- A game or app detecting or rejecting Pochini's input. Pochini does not hide that its input
  is synthetic and never will (see "Scope" in the README).
- A macro you wrote, or chose to turn on after reviewing it, doing what its steps say.

## Privacy, in short

- **The keyboard hook keeps nothing.** It reads each key, compares it with the hotkeys you set
  up (yours, the panic key and the on/off hotkey), and lets it go. No keystroke is stored,
  logged or sent. Settings > Hotkey check only ever lists keys you have bound, the last eight,
  in memory.
- **No network, no telemetry.** Pochini makes no network connections at all: no update check,
  no analytics, no crash reports.
- **Your data stays in one folder**, `%APPDATA%\com.pochini.app`: `macros.json` (with a
  `macros.bak` of the previous save) and `settings.json`. The window's own preferences (theme,
  step colors, sort order) live in the WebView2 profile under `%LOCALAPPDATA%\com.pochini.app`.
- **Exports leave out what is about you**: the window titles you picked apps from and your
  monitor layout.
