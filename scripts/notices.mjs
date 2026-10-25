#!/usr/bin/env node
// Writes THIRD_PARTY_NOTICES.md: the license of every third-party package that
// ends up inside Pochini.exe, because MIT, BSD, Apache and friends ask for
// their notices to travel with copies of the program.
//
//   npm run notices            regenerate the file
//   npm run notices -- --check exit 1 if the file is out of date (CI)
//
// What counts as "inside the exe":
//   - Rust crates linked into it: the normal (not dev, not build) dependency
//     graph of src-tauri for x86_64-pc-windows-msvc, from `cargo metadata`.
//   - npm packages bundled into the UI: `npm ls --omit=dev`.
//   - Microsoft's WebView2 loader, which webview2-com-sys links statically
//     (its license is vendored in scripts/notices/, the crate ships none).
// License texts come from each package's own LICENSE / COPYING / NOTICE files.
// For "MIT OR Apache-2.0" style packages Pochini uses them under MIT, so only
// the MIT file is reproduced. Identical texts are printed once.
//
// No dependencies; run it after `npm ci` and with the crates fetched (any
// cargo build or `cargo fetch` does that). The output is deterministic, so
// --check can compare it byte for byte.

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "THIRD_PARTY_NOTICES.md");
const check = process.argv.includes("--check");

const sh = (cmd) => execSync(cmd, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] });

const LICENSE_FILE = /^(licen[cs]e|copying|notice|copyright|unlicense)([-._].*)?$/i;

/** The license files in `dir`, narrowed to MIT ones when the package offers MIT as a choice. */
function licenseTexts(dir, expr) {
  if (!dir || !existsSync(dir)) return [];
  let files = readdirSync(dir).filter((f) => LICENSE_FILE.test(f)).sort();
  const offersMit = /(^|\s|\()MIT(\s|\)|$)/.test(expr ?? "") && /\bOR\b|\//.test(expr ?? "");
  if (offersMit) {
    const mit = files.filter((f) => /mit/i.test(f));
    if (mit.length) files = [...mit, ...files.filter((f) => /notice/i.test(f))];
  }
  return files.map((f) => readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n").trim());
}

// --- Rust ---------------------------------------------------------------
const meta = JSON.parse(
  // Not --locked: right after a version bump Cargo.lock still has the old
  // version of Pochini itself, and cargo updates that one line.
  sh("cargo metadata --format-version 1 --filter-platform x86_64-pc-windows-msvc --manifest-path src-tauri/Cargo.toml"),
);
const pkgs = new Map(meta.packages.map((p) => [p.id, p]));
const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
const seen = new Set([meta.resolve.root]);
const queue = [meta.resolve.root];
while (queue.length) {
  const node = nodes.get(queue.shift());
  for (const d of node?.deps ?? []) {
    if (!d.dep_kinds.some((k) => k.kind === null) || seen.has(d.pkg)) continue;
    seen.add(d.pkg);
    queue.push(d.pkg);
  }
}
seen.delete(meta.resolve.root);
const crates = [...seen]
  .map((id) => pkgs.get(id))
  .map((p) => ({
    kind: "crate",
    name: p.name,
    version: p.version,
    license: p.license ?? "see its license file",
    url: p.repository ?? `https://crates.io/crates/${p.name}`,
    texts: licenseTexts(path.dirname(p.manifest_path), p.license),
    authors: p.authors ?? [],
  }));

// --- npm ----------------------------------------------------------------
const dirs = sh("npm ls --omit=dev --all --parseable")
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((d) => path.resolve(d) !== root);
const npm = [...new Set(dirs)].map((dir) => {
  const p = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  const license = typeof p.license === "string" ? p.license : (p.license?.type ?? "see its license file");
  const repo = typeof p.repository === "string" ? p.repository : p.repository?.url;
  return {
    kind: "npm",
    name: p.name,
    version: p.version,
    license,
    url: (repo ?? `https://www.npmjs.com/package/${p.name}`).replace(/^git\+/, "").replace(/\.git$/, ""),
    texts: licenseTexts(dir, license),
    authors: [],
  };
});

// --- vendored -----------------------------------------------------------
const vendored = [
  {
    kind: "other",
    name: "Microsoft WebView2 SDK (WebView2LoaderStatic.lib)",
    version: "",
    license: "BSD-3-Clause",
    url: "https://www.nuget.org/packages/Microsoft.Web.WebView2",
    texts: [readFileSync(path.join(root, "scripts/notices/microsoft-webview2-sdk.txt"), "utf8").replace(/\r\n/g, "\n").trim()],
    authors: [],
  },
];

// --- output -------------------------------------------------------------
const byName = (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version, undefined, { numeric: true });
const all = [...crates.sort(byName), ...npm.sort(byName), ...vendored];

const counts = new Map();
for (const p of all) counts.set(p.license, (counts.get(p.license) ?? 0) + 1);

const fence = "````";
const groups = new Map(); // text hash -> { text, users }
const missing = [];
for (const p of all) {
  if (p.texts.length === 0) missing.push(p);
  for (const text of p.texts) {
    const h = createHash("sha256").update(text).digest("hex");
    if (!groups.has(h)) groups.set(h, { text, users: [] });
    groups.get(h).users.push(p);
  }
}

const label = (p) => (p.version ? `${p.name} ${p.version}` : p.name);
const lines = [
  "# Third-party notices",
  "",
  "Pochini itself is MIT licensed (see [LICENSE](LICENSE)). The program also contains the",
  "open source software listed below, used under the licenses shown. Their licenses ask for",
  "these notices to travel with copies of the program, so this file is attached to every",
  "release and shown in Settings > About.",
  "",
  "Generated by `npm run notices` (scripts/notices.mjs) from Cargo.lock and package-lock.json.",
  "Do not edit by hand. License texts are reproduced exactly as their authors wrote them.",
  "",
  `${crates.length} Rust crates, ${npm.length} npm packages, and the Microsoft WebView2 loader.`,
  "Rust's standard library (MIT OR Apache-2.0) is compiled in as well.",
  "",
  "## Licenses",
  "",
  "| License | Packages |",
  "|---|---|",
  ...[...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l, n]) => `| ${l} | ${n} |`),
  "",
  "MPL-2.0 is a file-level copyleft license. The MPL-2.0 crates listed here are used",
  "unmodified; their source is available from crates.io at the versions shown.",
  "",
  "## Packages",
  "",
  ...all.map((p) => `- ${label(p)} (${p.license}): ${p.url}`),
  "",
  "## License texts",
  "",
];
for (const g of [...groups.values()].sort((a, b) => byName(a.users[0], b.users[0]))) {
  lines.push(`### ${g.users.map(label).join(", ")}`, "", fence, g.text, fence, "");
}
if (missing.length) {
  lines.push(
    "## Packages that ship no license file",
    "",
    "These packages publish no license text of their own; they are used under the license",
    "named, with the copyright of their authors.",
    "",
    ...missing.map((p) => `- ${label(p)} (${p.license})${p.authors.length ? `, by ${p.authors.join(", ")}` : ""}: ${p.url}`),
    "",
  );
}
const text = lines.join("\n");

if (check) {
  const current = existsSync(out) ? readFileSync(out, "utf8").replace(/\r\n/g, "\n") : "";
  if (current !== text) {
    console.error("THIRD_PARTY_NOTICES.md is out of date: run `npm run notices` and commit it.");
    process.exit(1);
  }
  console.log("THIRD_PARTY_NOTICES.md is up to date.");
} else {
  writeFileSync(out, text);
  console.log(
    `THIRD_PARTY_NOTICES.md: ${crates.length} crates, ${npm.length} npm packages, ${groups.size} license texts, ` +
      `${missing.length} without a license file, ${(Buffer.byteLength(text) / 1024).toFixed(0)} KB`,
  );
}
