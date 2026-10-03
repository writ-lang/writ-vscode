// Copyright (C) 2026 Alex Kunich
// SPDX-License-Identifier: AGPL-3.0-or-later

// Restart the server when its binary is replaced.
//
// WHY THIS EXISTS. `make build` writes a NEW inode over the server, and the
// process already running keeps the old one — `/proc/PID/exe` reads
// "(deleted)". Nothing surfaces that. The editor keeps answering, confidently,
// with a language that is one build out of date, and the symptom is a squiggle
// on code the CLI accepts. That has cost real debugging time more than once,
// and it is worst exactly when the language itself is being changed, because
// then the stale answer is *plausible*.
//
// Polling rather than [createFileSystemWatcher]: the default server path is
// under `_build`, which is routinely listed in `files.watcherExclude`, and a
// watcher that silently never fires would be a worse version of this same bug.
// One stat every two seconds is not a cost worth optimising.

const fs = require("fs");

const POLL_MS = 2000;

// Identity of the file as built, not merely its name: dune replaces the
// executable, so the inode changes even when a rebuild lands within the same
// mtime granularity.
function stampOf(p) {
  try {
    const s = fs.statSync(p);
    return `${s.ino}:${s.mtimeMs}:${s.size}`;
  } catch {
    return null;
  }
}

// `restart` and `onRestart` are injected rather than reached for, so this can
// be driven against a real file with no editor — which test/watcher.test.js
// does, because a watcher that silently never fires is the bug it exists to
// fix and nothing else would catch it.
function watchServerBinary(serverPath, log, pollMs = POLL_MS, hooks = {}) {
  const restart = hooks.restart || (() => Promise.resolve());
  const onRestart = hooks.onRestart || (() => {});
  const onFailure = hooks.onFailure || (() => {});
  let known = stampOf(serverPath);
  let pending = null;

  const id = setInterval(async () => {
    const now = stampOf(serverPath);
    if (now === null) return; // mid-build: the file is briefly gone
    if (now === known) {
      pending = null; // nothing new, or a change that reverted
      return;
    }
    if (pending !== now) {
      // Seen a change, but act only once it has stopped moving, so a
      // multi-second link step restarts the server once and not four times.
      pending = now;
      return;
    }
    known = now;
    pending = null;
    log(`server binary changed on disk — restarting (${serverPath})`);
    try {
      await restart();
      log("server restarted; diagnostics are from the current build");
      onRestart();
    } catch (e) {
      onFailure(e);
    }
  }, pollMs);

  return { dispose: () => clearInterval(id) };
}

module.exports = { watchServerBinary, stampOf, POLL_MS };
