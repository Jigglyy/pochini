#!/usr/bin/env node
// Mechanical checks for rules in CLAUDE.md that a reviewer could miss.
// Run by `npm run verify` and by CI on pull requests.
//
//   - No em dash (U+2014) in anything we write. Third-party license texts are
//     reproduced verbatim, so THIRD_PARTY_NOTICES.md and vendored files are
//     exempt.
//   - The keyboard hook never prints: no println!, eprintln!, print!, dbg! or
//     log macros in hotkey/hook.rs or hotkey/logic.rs (rule 11: never log
//     keystroke content, not even while debugging).
//   - The e2e test mode stays out of release builds: every `mod e2e` and
//     `crate::e2e` use sits right under a #[cfg(debug_assertions)].

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const files = execSync("git ls-files", { cwd: root, encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
const read = (f) => readFileSync(path.join(root, f), "utf8");
const problems = [];

const TEXT = /\.(rs|ts|tsx|mjs|js|json|md|yml|yaml|toml|css|html|ps1|txt)$/i;
const EXEMPT = new Set(["THIRD_PARTY_NOTICES.md", "package-lock.json", "src-tauri/Cargo.lock"]);
const EM_DASH = String.fromCharCode(0x2014);
for (const f of files) {
  if (!TEXT.test(f) || EXEMPT.has(f) || f.startsWith("scripts/notices/")) continue;
  read(f)
    .split("\n")
    .forEach((line, i) => {
      if (line.includes(EM_DASH)) problems.push(`${f}:${i + 1}: em dash (use a hyphen, comma or parentheses)`);
    });
}

for (const f of ["src-tauri/src/hotkey/hook.rs", "src-tauri/src/hotkey/logic.rs"]) {
  read(f)
    .split("\n")
    .forEach((line, i) => {
      if (/\b(e?println|e?print|dbg|log::\w+|tracing::\w+|info|debug|trace|warn)!\s*\(/.test(line)) {
        problems.push(`${f}:${i + 1}: the keyboard hook must not print or log (CLAUDE.md rule 11)`);
      }
    });
}

for (const f of files.filter((f) => f.startsWith("src-tauri/src/") && f.endsWith(".rs") && f !== "src-tauri/src/e2e.rs")) {
  const lines = read(f).split("\n");
  lines.forEach((line, i) => {
    if (!/^\s*(pub(\(crate\))?\s+)?mod e2e\b|crate::e2e::/.test(line)) return;
    // Walk up to the nearest attribute or the start of the enclosing block.
    for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
      if (/#\[cfg\((all\()?.*debug_assertions/.test(lines[j])) return;
    }
    problems.push(`${f}:${i + 1}: e2e test mode used without #[cfg(debug_assertions)] right above`);
  });
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`guards: ok (${files.length} files)`);
