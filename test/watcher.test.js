// Copyright (C) 2026 Alex Kunich
// SPDX-License-Identifier: AGPL-3.0-or-later

// Drives the server-binary watcher against a real file on disk.
//
// The watcher's failure mode is SILENCE — it either fires or it does not, and
// one that never fires looks exactly like a server that is simply up to date.
// That is the bug it exists to fix, so it does not get to go untested. The
// first version of it never fired at all; this file is what caught that.
//
// Nothing is stubbed. The watcher takes its restart as an argument rather than
// reaching for a client, so it only ever stats a path and calls a function —
// which is the whole reason it can be checked with no editor in the room.
//
// Run: node test/watcher.test.js

const fs = require("fs");
const os = require("os");
const path = require("path");
const { suite } = require("./harness");
const { watchServerBinary } = require("../src/watcher");

const POLL = 40; // fast enough to gate; the shipped default is 2000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { check, done } = suite("watcher tests");

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "writ-watch-"));
  const bin = path.join(dir, "writ_lsp.exe");
  fs.writeFileSync(bin, "v1");

  let restarts = 0;
  let rebuilt = 0;
  const logs = [];
  const failures = [];
  const w = watchServerBinary(bin, (m) => logs.push(m), POLL, {
    restart: async () => {
      restarts++;
    },
    onRestart: () => rebuilt++,
    onFailure: (e) => failures.push(e),
  });

  await sleep(POLL * 6);
  check("an unchanged binary does not restart the server", restarts === 0);

  // Replaced, not edited in place — which is what dune does, and why the stamp
  // carries the inode and not just the mtime.
  fs.rmSync(bin);
  fs.writeFileSync(bin, "v2-different-length");
  await sleep(POLL * 8);
  check("a replaced binary restarts the server", restarts === 1);
  check("and says so in the output channel", logs.length === 2);
  // The panel has to be told, or it goes on showing the staleness warning that
  // the very build just cleared — the one place in the editor still claiming
  // you are out of date.
  check("and the rest of the extension is told the build landed", rebuilt === 1);

  await sleep(POLL * 6);
  check("a settled binary restarts it once, not repeatedly", restarts === 1);

  // A vanished file is a build in progress, not a reason to do anything.
  fs.rmSync(bin);
  await sleep(POLL * 6);
  check("a missing binary is not a restart", restarts === 1);
  check("nothing was reported to the user", failures.length === 0);

  w.dispose();

  // A restart that throws must reach the user, not the void: the server on disk
  // has already changed, so staying quiet leaves the editor answering from a
  // binary that is gone.
  const bin2 = path.join(dir, "two.exe");
  fs.writeFileSync(bin2, "a");
  const seen = [];
  const w2 = watchServerBinary(bin2, () => {}, POLL, {
    restart: async () => {
      throw new Error("no");
    },
    onFailure: (e) => seen.push(e),
  });
  fs.rmSync(bin2);
  fs.writeFileSync(bin2, "bbbbbb");
  await sleep(POLL * 8);
  check("a restart that fails is reported", seen.length === 1);
  w2.dispose();

  fs.rmSync(dir, { recursive: true, force: true });
  done();
})();
