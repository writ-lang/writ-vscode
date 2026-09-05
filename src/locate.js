// Copyright (C) 2026 Alex Kunich
// SPDX-License-Identifier: AGPL-3.0-or-later

// Where the engine is.
//
// Everything else in this extension needs an answer to that and must not have
// its own: the server the client talks to, the `writ` the commands run, and the
// checkout the build command builds all have to be the SAME install, or the
// panel reports a version from one and the diagnostics come from another.

const fs = require("fs");
const path = require("path");

// The name an installed writ puts on PATH (tooling/lsp/bin/dune's
// public_name). NOT the same as the in-checkout file name, which is
// `writ_lsp.exe` under _build.
const INSTALLED = "writ-lsp";

// The command line, likewise: `writ` installed, `writ.exe` under _build.
const CLI = "writ";

const DEFAULT_SERVER = "_build/default/tooling/lsp/bin/writ_lsp.exe";

// The CLI's path inside a checkout, relative to the root, and the server's.
// Kept together because the pair is what lets a resolved server name a
// checkout and a checkout name its CLI.
const IN_CHECKOUT = {
  server: DEFAULT_SERVER,
  cli: "_build/default/tooling/cli/writ.exe",
};

function onPath(exe) {
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const names = process.platform === "win32" ? [exe + ".exe", exe] : [exe];
  return dirs.flatMap((d) => names.map((n) => path.join(d, n)));
}

// A writ checkout, identified by the engine's own file rather than by being
// named `writ` — a checkout in a directory called something else is still one.
function isCheckout(dir) {
  return fs.existsSync(path.join(dir, "dune-project"));
}

// The checkouts one level below a workspace folder.
//
// WHY ONE LEVEL. Splitting writ and this extension into separate repositories
// means the natural thing to open is the directory that CONTAINS both, and then
// the relative default resolves against a folder that has no _build in it. The
// server is right there, one directory down, and the extension said "no language
// server" — the same symptom as not having built it, which is the wrong thing to
// go and check. One level covers that layout and stops; this must not become a
// walk of the workspace, which on a large tree would cost more than it saves.
function checkoutsBelow(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return []; // a folder that is gone or unreadable is not worth failing over
  }
  return entries
    .filter((e) => e.isDirectory() || e.isSymbolicLink())
    .map((e) => path.join(dir, e.name))
    .filter(isCheckout);
}

// Where to look for the server, in order. Returns every path tried, so a
// failure can name them rather than say "not found".
//
// TWO AUDIENCES, and the order is which one gets served first. A CHECKOUT of
// this repository builds its own server, and that one must win — the whole
// point of an OCaml server is that the editor and the checker are the same
// code, so a developer changing the language wants the build in front of them
// and not whatever is installed. Everyone ELSE has installed writ (by pin, or
// unpacked a release) and has no checkout at all; for them the relative default
// resolves to nothing, and `writ-lsp` on PATH is the only server there is.
//
// An ABSOLUTE setting is taken literally and nothing is guessed after it: an
// operator who names a server means that server.
//
// `folders` is passed in rather than read from `vscode` so the order can be
// checked under plain node, which is what test/resolve.test.js does.
function candidates(configured, folders) {
  if (path.isAbsolute(configured)) return [configured];
  // The folder itself before anything under it: opening the checkout directly
  // is the common case and must not be slowed down or second-guessed.
  const inWorkspace = (folders || []).flatMap((f) => [
    path.join(f, configured),
    ...checkoutsBelow(f).map((d) => path.join(d, configured)),
  ]);
  return [...inWorkspace, ...onPath(INSTALLED)];
}

// The checkout a resolved server came out of, or null for an installed one.
//
// Pure string work, deliberately: asking the filesystem "is there a
// dune-project above this?" would also say yes for `~/.opam/…/bin/writ-lsp`
// sitting inside some unrelated tree, and then the build command would offer to
// rebuild a checkout that has nothing to do with the server in use. A server is
// a checkout's only when it is at the exact path a checkout builds it to.
function checkoutOf(serverPath) {
  const suffix = path.join(...IN_CHECKOUT.server.split("/"));
  if (!serverPath.endsWith(suffix)) return null;
  const root = serverPath.slice(0, serverPath.length - suffix.length);
  const trimmed = root.replace(/[\\/]+$/, "");
  return trimmed && isCheckout(trimmed) ? trimmed : null;
}

// The `writ` command line that belongs to a given server.
//
// It must be the SAME install, which is why this is derived from the server
// rather than looked up independently: a checkout's server with the installed
// `writ` on PATH is exactly the mismatch the panel exists to catch, and running
// commands through the wrong one would hide it.
function cliFor(serverPath) {
  const root = checkoutOf(serverPath);
  if (root) {
    const built = path.join(root, ...IN_CHECKOUT.cli.split("/"));
    if (fs.existsSync(built)) return built;
    return null; // a checkout that built the server but not the CLI
  }
  // An installed server has the CLI beside it: opam and the release tarball
  // both put `writ` and `writ-lsp` in the same bin directory.
  const beside = path.join(
    path.dirname(serverPath),
    process.platform === "win32" ? CLI + ".exe" : CLI
  );
  if (fs.existsSync(beside)) return beside;
  return onPath(CLI).find((p) => fs.existsSync(p)) || null;
}

module.exports = {
  INSTALLED,
  CLI,
  DEFAULT_SERVER,
  IN_CHECKOUT,
  onPath,
  isCheckout,
  checkoutsBelow,
  candidates,
  checkoutOf,
  cliFor,
};
