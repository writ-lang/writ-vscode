// Copyright (C) 2026 Alex Kunich
// SPDX-License-Identifier: AGPL-3.0-or-later

// Where the client looks for the engine, and in what order.
//
// This is the whole of "the extension works with writ installed separately".
// Until it was written, the only candidate was a path under `_build`, which
// exists ONLY inside a checkout — so on a machine that had installed writ
// separately the extension found nothing, even though tooling/lsp/bin/dune
// installs `writ-lsp` precisely so that case works.
//
// The order matters as much as the set: a checkout's own build must win,
// because an OCaml server exists so the editor and the checker are the same
// code, and someone changing the language wants the build in front of them.
//
// Nothing is stubbed here any more. [candidates] takes its workspace folders as
// an argument rather than reaching into `vscode`, which is what makes the
// module plain node — and the reason the resolution order is the one part of
// this extension that has never needed an editor to check.
//
// Run: node test/resolve.test.js

const fs = require("fs");
const os = require("os");
const path = require("path");
const { suite } = require("./harness");
const locate = require("../src/locate");

const { check, done } = suite("resolve tests");
const { candidates, onPath, checkoutOf, cliFor, INSTALLED, DEFAULT_SERVER: DEFAULT } = locate;

// 1. In a checkout: the build comes first, the installed server after it.
let c = candidates(DEFAULT, ["/w/writ"]);
check("a checkout's own build is tried first", c[0] === path.join("/w/writ", DEFAULT));
check(
  "and the installed writ-lsp is still a fallback",
  c.some((p) => p.endsWith(path.sep + INSTALLED))
);
check(
  "the build is tried BEFORE anything on PATH",
  c.indexOf(path.join("/w/writ", DEFAULT)) <
    c.findIndex((p) => p.endsWith(path.sep + INSTALLED))
);

// 2. No workspace at all — a lone .writ file, or writ installed without a
//    checkout. This is the case that used to yield an empty list.
c = candidates(DEFAULT, []);
check("with no workspace there is still somewhere to look", c.length > 0);
check("and it is writ-lsp on PATH", c.every((p) => p.endsWith(path.sep + INSTALLED)));

// 3. An absolute setting is taken literally: an operator naming a server means
//    that server, and nothing is guessed after it.
c = candidates("/opt/writ/bin/writ-lsp", ["/w/writ"]);
check("an absolute setting is the only candidate", c.length === 1);
check("and it is exactly what was set", c[0] === "/opt/writ/bin/writ-lsp");

// 4. The PATH search uses the INSTALLED name, not the in-checkout file name:
//    an installed writ produces `writ-lsp`; `_build` produces `writ_lsp.exe`.
check("the installed name is writ-lsp", INSTALLED === "writ-lsp");
check(
  "every PATH candidate ends in it",
  onPath(INSTALLED).every((p) => path.basename(p).startsWith(INSTALLED))
);
check("PATH is actually searched", onPath(INSTALLED).length > 0);

// 5. The workspace root is the PARENT of the checkout, not the checkout.
//
//    This is what the split into separate writ/ and writ-vscode/ repositories
//    produces: you open the directory that holds both, so the relative default
//    resolves against a folder with no _build in it, and the extension reported
//    "no language server" while a perfectly good one sat one level down.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "writ-resolve-"));
fs.mkdirSync(path.join(root, "writ"));
fs.writeFileSync(path.join(root, "writ", "dune-project"), "(lang dune 3.0)\n");
fs.mkdirSync(path.join(root, "writ-vscode")); // a sibling that is NOT a checkout
fs.mkdirSync(path.join(root, "notes"));

c = candidates(DEFAULT, [root]);
check(
  "a checkout one level below the workspace root is found",
  c.includes(path.join(root, "writ", DEFAULT))
);
check("the workspace root itself is still tried first", c[0] === path.join(root, DEFAULT));
check(
  "a subdirectory that is not a checkout is not guessed at",
  !c.some((p) => p.startsWith(path.join(root, "notes") + path.sep))
);
check(
  "the nested checkout still beats anything on PATH",
  c.indexOf(path.join(root, "writ", DEFAULT)) <
    c.findIndex((p) => p.endsWith(path.sep + INSTALLED))
);

// An unreadable or absent folder must not throw — a workspace folder can name a
// disconnected drive, and resolution failing there would take the whole
// extension down at activation.
let threw = false;
try {
  candidates(DEFAULT, [path.join(root, "gone")]);
} catch {
  threw = true;
}
check("a workspace folder that does not exist is survivable", !threw);

// 6. Which checkout a resolved server belongs to.
//
//    The panel's build button and the "older than your sources" warning both
//    depend on this being the checkout that produced THIS server, and not any
//    checkout that happens to be above it on disk. An installed server inside
//    somebody's source tree is the case that makes the difference: it must
//    report no checkout, or the panel would offer to rebuild a repository that
//    has nothing to do with the server in use.
const built = path.join(root, "writ", DEFAULT);
check("a server under a checkout names that checkout", checkoutOf(built) === path.join(root, "writ"));
check(
  "a server merely sitting inside a checkout names none",
  checkoutOf(path.join(root, "writ", "some", "bin", "writ-lsp")) === null
);
check(
  "and neither does one at the right path under a directory that is no checkout",
  checkoutOf(path.join(root, "notes", DEFAULT)) === null
);

// 7. The command line that belongs to the SAME install as the server.
//
//    Looking `writ` up on PATH independently is exactly the mismatch the panel
//    exists to catch: a checkout's server answering the squiggles while the
//    installed `writ` answers "Check this file" would make the two disagree by
//    construction.
const cliPath = path.join(root, "writ", ...locate.IN_CHECKOUT.cli.split("/"));
fs.mkdirSync(path.dirname(cliPath), { recursive: true });
fs.writeFileSync(cliPath, "");
check("a checkout's server is paired with that checkout's CLI", cliFor(built) === cliPath);

fs.rmSync(cliPath);
check("a checkout that built no CLI reports none, rather than falling back to PATH", cliFor(built) === null);

// An installed server's CLI is its neighbour: opam and the release tarball both
// put `writ` and `writ-lsp` in the same bin directory.
const bin = path.join(root, "bin");
fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, "writ-lsp"), "");
fs.writeFileSync(path.join(bin, process.platform === "win32" ? "writ.exe" : "writ"), "");
check(
  "an installed server is paired with the writ beside it",
  cliFor(path.join(bin, "writ-lsp")) ===
    path.join(bin, process.platform === "win32" ? "writ.exe" : "writ")
);

fs.rmSync(root, { recursive: true, force: true });
done();
