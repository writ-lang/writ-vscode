// Copyright (C) 2026 Alex Kunich
// SPDX-License-Identifier: AGPL-3.0-or-later

// Is the built server older than the language it was built from?
//
// The version comparison in the panel cannot answer this. dune-project's
// version moves only when someone bumps it deliberately, so a checkout built
// before this morning's edit reports exactly the same version as one built
// after it — the two agree, the panel says so, and the editor goes on answering
// with a server that predates the change being made.
//
// The watcher next door handles the other half: a server that is rebuilt WHILE
// the editor runs. This is the half it cannot see, because nothing happened —
// the build was never run at all.
//
// Times catch what versions cannot.

const fs = require("fs");
const path = require("path");

// Only the engine and the tools built from it. Not tests/ (a changed test does
// not make the server wrong) and not core/stdlib (.writ files, read at runtime
// from disk, never compiled in).
const SOURCE_DIRS = ["core", "tooling"];
const SOURCE_EXT = [".ml", ".mli"];

// Pure, so it can be checked without a filesystem.
//
// [builtAt] is when a build last finished, and it matters because dune is
// content-addressed: touch a file without changing it and dune rebuilds
// nothing, so the binary keeps an mtime older than the source for ever. A
// completed build means the binary reflects the sources whether or not any
// bytes moved, and without this the warning could never be cleared by doing the
// thing the warning asks for.
function staleness(binaryMtime, sources, builtAt) {
  if (binaryMtime === null || binaryMtime === undefined) return null;
  const floor = Math.max(binaryMtime, builtAt || 0);
  let newest = null;
  for (const source of sources) {
    if (source.mtime > floor && (!newest || source.mtime > newest.mtime))
      newest = source;
  }
  return newest
    ? { path: newest.path, mtime: newest.mtime, binary: binaryMtime }
    : null;
}

// The engine's sources under a checkout. Recursive, because writ's are nested
// (tooling/lsp/lib/feature/…) where a flat listing would see none of them —
// and bounded to SOURCE_DIRS, which are 61 files, so this is a walk of the
// engine and never of the workspace.
function sourcesIn(root) {
  const out = [];
  const walk = (dir, shown) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const label = shown + "/" + e.name;
      if (e.isDirectory()) {
        if (e.name === "_build" || e.name === ".git") continue;
        walk(full, label);
      } else if (SOURCE_EXT.includes(path.extname(e.name))) {
        try {
          out.push({ path: label, mtime: fs.statSync(full).mtimeMs });
        } catch {
          // it went away between the listing and the stat
        }
      }
    }
  };
  for (const dir of SOURCE_DIRS) walk(path.join(root, dir), dir);
  return out;
}

// Said by whoever ran the build, when it succeeded.
let builtAt = 0;
let lastLook = 0;
let lastAnswer = null;

function markBuilt(when) {
  builtAt = when === undefined ? Date.now() : when;
  lastLook = 0;
  lastAnswer = null;
}

function forget() {
  lastLook = 0;
  lastAnswer = null;
}

// Cached for a second: the panel repaints on every visibility change, and a
// 61-file walk on each one would be paid for nothing.
//
// Returns null for an INSTALLED server as well as for an up-to-date one. That
// is not a gap: there are no sources to be older than, and "your opam pin is
// behind the repository" is a different question with a different answer, which
// is the update command and not a rebuild.
function stale(checkout, serverPath, now) {
  const t = now === undefined ? Date.now() : now;
  if (now === undefined && t - lastLook < 1000) return lastAnswer;
  const answer = (() => {
    if (!checkout) return null;
    let binaryMtime;
    try {
      binaryMtime = fs.statSync(serverPath).mtimeMs;
    } catch {
      return null; // no server at all is a different complaint
    }
    return staleness(binaryMtime, sourcesIn(checkout), builtAt);
  })();
  if (now === undefined) {
    lastLook = t;
    lastAnswer = answer;
  }
  return answer;
}

module.exports = { staleness, sourcesIn, stale, markBuilt, forget, SOURCE_DIRS };
