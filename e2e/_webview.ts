import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Why the suite must never start WebView2 on an empty profile.
//
// WebView2 (it is Edge) checks, once per profile, whether your Windows
// password is blank, by signing in to your account with an empty password.
// That is a failed sign-in (Security event 4625, from msedgewebview2.exe)
// every time a fresh profile starts. Every test starts the app with a fresh
// profile, so one run of the suite made about a hundred in a minute, Windows
// locked the account (10 failed sign-ins in 10 minutes is its default), and
// the maintainer was locked out of their own PC.
//
// A profile remembers the answer in its Local State
// (password_manager.os_password_blank / os_password_last_changed) and skips
// the sign-in while the remembered time matches when the password was last
// set. It matches only to about a second, so it cannot be worked out from
// Windows, only copied from WebView2. So:
// - once per password change, global setup lets one profile do the check (one
//   failed sign-in) and keeps its answer in e2e/.cache (`prime`);
// - every test's profile starts with that answer (`seedProfile`);
// - before any test runs, one seeded launch must leave the account's
//   bad-password counter where it was, or the run stops (`prepare`);
// - each launch reads the counter again, and a rise stops the rest of the
//   run (`refuseIfStopped`, `checkAfterLaunch`).

const here = dirname(fileURLToPath(import.meta.url));
export const EXE = resolve(here, "../src-tauri/target/debug/pochini.exe");
const CACHE = join(here, ".cache");
const ANSWER = join(CACHE, "webview-password-check.json");
const GUARD = join(CACHE, "logon-guard.json");

/** WebView2's remembered answer, and when the password was last set (Unix
 *  seconds, 0 if unknown) when it was taken. */
type Answer = { blank: boolean; lastChanged: string; passwordLastSet: number };
/** The bad-password count the run started from, and why it stopped, if it did. */
type Guard = { baseline: number | null; stopped?: string };

export function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.on("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => ok(port));
    });
  });
}

const readJson = <T>(file: string): T | null => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
};

const writeGuard = (g: Guard) => {
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(GUARD, JSON.stringify(g));
};

/** The account's bad-password counter, and when its password was last set
 *  (Unix seconds, or null if Windows will not say: a domain account). Null
 *  off Windows or if the counter cannot be read. */
export function account(): Promise<{ bad: number; passwordLastSet: number | null } | null> {
  if (process.platform !== "win32") return Promise.resolve(null);
  const script = [
    '$n = "$env:USERDOMAIN\\$env:USERNAME"',
    "$b = (Get-CimInstance Win32_NetworkLoginProfile | Where-Object Name -eq $n).BadPasswordCount",
    "$s = try { ([DateTimeOffset](Get-LocalUser -Name $env:USERNAME -ErrorAction Stop).PasswordLastSet).ToUnixTimeSeconds() } catch { '' }",
    '"$b;$s"',
  ].join("; ");
  return new Promise((done) => {
    execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 30_000 }, (err, out) => {
      const [b, s] = String(out).trim().split(";");
      const bad = Number.parseInt(b ?? "", 10);
      if (err || Number.isNaN(bad)) return done(null);
      const set = Number.parseInt(s ?? "", 10);
      done({ bad, passwordLastSet: Number.isNaN(set) ? null : set });
    });
  });
}

/** Give a test's profile WebView2's remembered answer, so it never signs in. */
export async function seedProfile(dataDir: string): Promise<void> {
  const a = readJson<Answer>(ANSWER);
  if (!a) return;
  const dir = join(dataDir, "webview", "EBWebView");
  mkdirSync(dir, { recursive: true });
  const state = { password_manager: { os_password_blank: a.blank, os_password_last_changed: a.lastChanged } };
  await writeFile(join(dir, "Local State"), JSON.stringify(state));
}

/** Start the app in test mode on its own data folder, without Playwright. */
async function startBare(dataDir: string): Promise<ChildProcess> {
  await writeFile(join(dataDir, "settings.json"), JSON.stringify({ welcomed: true }));
  return spawn(EXE, [], {
    env: { ...process.env, POCHINI_E2E: "1", POCHINI_DATA_DIR: dataDir, POCHINI_E2E_CDP_PORT: String(await freePort()) },
    stdio: "ignore",
  });
}

async function stopBare(child: ChildProcess, dataDir: string) {
  if (child.exitCode === null) {
    const gone = new Promise((r) => child.once("exit", r));
    child.kill();
    await gone;
  }
  await rm(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(() => {});
}

/** Let one fresh profile do the check (the one failed sign-in) and keep its
 *  answer. WebView2 writes Local State about ten seconds after it starts. */
async function prime(passwordLastSet: number | null): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pochini-e2e-prime-"));
  const child = await startBare(dir);
  const state = join(dir, "webview", "EBWebView", "Local State");
  const deadline = Date.now() + 60_000;
  let answer: Answer | null = null;
  try {
    while (!answer && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      const pm = (JSON.parse(await readFile(state, "utf8").catch(() => "{}")) as { password_manager?: Record<string, unknown> })
        .password_manager;
      if (pm && typeof pm.os_password_last_changed === "string") {
        answer = { blank: pm.os_password_blank === true, lastChanged: pm.os_password_last_changed, passwordLastSet: passwordLastSet ?? 0 };
      }
    }
  } finally {
    await stopBare(child, dir);
  }
  if (!answer) throw new Error("WebView2 never wrote its password check answer, so the suite cannot run safely.");
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(ANSWER, JSON.stringify(answer));
}

const STOP =
  "Stopped: WebView2 made a failed sign-in to your Windows account during the e2e run (the account's " +
  "bad-password counter rose). Ten of those in ten minutes lock the account, so no more tests start. " +
  "See e2e/_webview.ts. (A wrong password you typed yourself during the run counts too.)";

/** Global setup: make sure seeded profiles do not sign in, before any test. */
export async function prepare(): Promise<void> {
  writeGuard({ baseline: null });
  if (process.platform !== "win32" || !existsSync(EXE)) return;
  const now = await account();
  const answer = readJson<Answer>(ANSWER);
  const changed = now?.passwordLastSet != null && answer !== null && Math.abs(answer.passwordLastSet - now.passwordLastSet) > 60;
  if (!answer || changed) {
    console.log(
      "e2e: letting WebView2 check once whether your Windows password is blank (one failed sign-in in the " +
        "Security log), and keeping its answer in e2e/.cache so no test repeats it.",
    );
    await prime(now?.passwordLastSet ?? null);
  }

  // Prove it: one seeded launch must not move the counter.
  const before = await account();
  const dir = await mkdtemp(join(tmpdir(), "pochini-e2e-check-"));
  await seedProfile(dir);
  const child = await startBare(dir);
  await new Promise((r) => setTimeout(r, 4_000)); // the check runs within a second of start
  await stopBare(child, dir);
  const after = await account();
  if (before && after && after.bad > before.bad) {
    // A stale answer: take a fresh one next time, and run nothing now.
    await rm(ANSWER, { force: true });
    writeGuard({ baseline: after.bad, stopped: STOP });
    throw new Error(`${STOP} It happened on the check before the tests, so none ran; the next run takes a new answer.`);
  }
  writeGuard({ baseline: after?.bad ?? null });
}

/** Before a launch: refuse once the run has been stopped. */
export function refuseIfStopped(): void {
  const g = readJson<Guard>(GUARD);
  if (g?.stopped) throw new Error(g.stopped);
}

/** After a launch (WebView2 has started): did the counter rise? Records a stop
 *  for the rest of the run and returns the reason if so. */
export async function checkAfterLaunch(): Promise<string | null> {
  const g = readJson<Guard>(GUARD);
  if (!g || g.baseline === null) return null;
  const now = await account();
  if (!now) return null;
  if (now.bad > g.baseline) {
    writeGuard({ ...g, stopped: STOP });
    return STOP;
  }
  // Windows resets the counter after a while; follow it down.
  if (now.bad < g.baseline) writeGuard({ ...g, baseline: now.bad });
  return null;
}
