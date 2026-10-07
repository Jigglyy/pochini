#!/usr/bin/env node
// Build a versioned Pochini executable.
//
//   npm run release -- patch      0.1.0 -> 0.1.1
//   npm run release -- minor      0.1.0 -> 0.2.0
//   npm run release -- major      0.1.0 -> 1.0.0
//   npm run release -- 0.3.0      set an exact version
//   npm run release -- current    rebuild the current version without bumping
//
// The version lives in package.json (and package-lock.json); tauri.conf.json
// reads it from there, and Cargo.toml is kept in step here. The result is
// release/Pochini-<version>.exe, and any older Pochini-*.exe in release/ is
// deleted: there is only ever one current build. Pushing the v<version> tag
// then publishes it as a GitHub Release (.github/workflows/release.yml).

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const arg = process.argv[2] ?? "patch";

const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const current = pkg.version;

function bump(v, kind) {
  const [maj, min, pat] = v.split(".").map(Number);
  if (kind === "major") return `${maj + 1}.0.0`;
  if (kind === "minor") return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

let next;
if (arg === "current") next = current;
else if (/^\d+\.\d+\.\d+$/.test(arg)) next = arg;
else if (["patch", "minor", "major"].includes(arg)) next = bump(current, arg);
else {
  console.error(`Unknown version argument "${arg}". Use patch, minor, major, current, or X.Y.Z.`);
  process.exit(1);
}

const run = (cmd) => execSync(cmd, { cwd: root, stdio: "inherit" });

console.log(`\nPochini ${current} -> ${next}\n`);

// 1. Versions: package.json + package-lock.json, then Cargo.toml.
if (next !== current) run(`npm version ${next} --no-git-tag-version`);
const cargoPath = path.join(root, "src-tauri", "Cargo.toml");
const cargo = readFileSync(cargoPath, "utf8");
const bumped = cargo.replace(/(\[package\][^[]*?\nversion\s*=\s*")[^"]+(")/, `$1${next}$2`);
if (!bumped.includes(`version = "${next}"`)) {
  console.error("Could not set the version in src-tauri/Cargo.toml");
  process.exit(1);
}
writeFileSync(cargoPath, bumped);

// 2. Build the release executable (no installer bundle).
run("npm run tauri build -- --no-bundle");

// 3. Keep exactly one build in release/.
const targetDir = path.join(root, "src-tauri", "target", "release");
const built = ["Pochini.exe", "pochini.exe"].map((f) => path.join(targetDir, f)).find(existsSync);
if (!built) {
  console.error(`Build finished but no Pochini executable was found in ${targetDir}`);
  process.exit(1);
}
const outDir = path.join(root, "release");
mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `Pochini-${next}.exe`);
// New build first, so a failure below never leaves release/ empty.
copyFileSync(built, out);

// Then remove older builds. One that is running cannot be deleted on Windows;
// say so and carry on (the next release run removes it).
const stuck = [];
for (const f of readdirSync(outDir)) {
  if (/^Pochini-.*\.exe$/i.test(f) && path.join(outDir, f) !== out) {
    try {
      rmSync(path.join(outDir, f));
      console.log(`deleted old build ${f}`);
    } catch {
      stuck.push(f);
    }
  }
}

console.log(`\nPochini ${next} built: ${out}`);
if (stuck.length) {
  console.log(`Could not delete ${stuck.join(", ")}: it is probably running.`);
  console.log("Close it and it will be removed by the next release, or delete it yourself.");
}
console.log(`
Then publish it on GitHub (the Release workflow builds the same exe there):
  1. add a "## ${next} - <date>" section to CHANGELOG.md (it becomes the release notes)
  2. git commit -am "chore(release): ${next}"
  3. git tag v${next}
  4. git push origin main v${next}
`);
