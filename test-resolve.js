// Copyright (C) 2026 Alex Kunich
// SPDX-License-Identifier: AGPL-3.0-or-later

// Where the client looks for the language server, and in what order.
//
// This is the whole of "the extension works with writ installed separately".
// Until it was written, the only candidate was a path under `_build`, which
// exists ONLY inside a checkout — so on a machine that had installed writ
// separately the extension found nothing, even though tooling/lsp/bin/dune installs
// `writ-lsp` precisely so that case works.
//
// The order matters as much as the set: a checkout's own build must win, because
// an OCaml server exists so the editor and the checker are the same code, and
// someone changing the language wants the build in front of them.
//
// Run: node test-resolve.js

const Module = require("module");
const path = require("path");

let workspace = [];
const origLoad = Module._load;
Module._load = function (req) {
  if (req === "vscode")
    return {
      workspace: {
        get workspaceFolders() {
          return workspace;
        },
        getConfiguration: () => ({ get: (_k, d) => d }),
      },
      window: { showErrorMessage: () => {} },
    };
  if (req === "vscode-languageclient/node")
    return { LanguageClient: class {}, TransportKind: { stdio: 0 } };
  return origLoad.apply(this, arguments);
};

const { candidates, onPath, INSTALLED } = require(
  path.join(__dirname, "extension.js")
).__test;

let failed = 0;
function check(name, cond) {
  if (!cond) {
    console.log(`FAIL: ${name}`);
    failed++;
  }
}

const DEFAULT = "_build/default/tooling/lsp/bin/writ_lsp.exe";
const folder = (p) => ({ uri: { fsPath: p } });

// 1. In a checkout: the build comes first, the installed server after it.
workspace = [folder("/w/writ")];
let c = candidates(DEFAULT);
check("a checkout's own build is tried first", c[0] === path.join("/w/writ", DEFAULT));
check("and the installed writ-lsp is still a fallback", c.some((p) => p.endsWith(path.sep + INSTALLED)));
check(
  "the build is tried BEFORE anything on PATH",
  c.indexOf(path.join("/w/writ", DEFAULT)) <
    c.findIndex((p) => p.endsWith(path.sep + INSTALLED))
);

// 2. No workspace at all — a lone .writ file, or writ installed without a
//    checkout. This is the case that used to yield an empty list.
workspace = [];
c = candidates(DEFAULT);
check("with no workspace there is still somewhere to look", c.length > 0);
check(
  "and it is writ-lsp on PATH",
  c.every((p) => p.endsWith(path.sep + INSTALLED))
);

// 3. An absolute setting is taken literally: an operator naming a server means
//    that server, and nothing is guessed after it.
workspace = [folder("/w/writ")];
c = candidates("/opt/writ/bin/writ-lsp");
check("an absolute setting is the only candidate", c.length === 1);
check("and it is exactly what was set", c[0] === "/opt/writ/bin/writ-lsp");

// 4. The PATH search uses the INSTALLED name, not the in-checkout file name.
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
//    "no language server" while a perfectly good one sat one level down. A
//    checkout is identified by dune-project, so only a real one is added, and
//    only immediate subdirectories are looked at — this must not become a walk
//    of the whole workspace.
const os = require("os");
const fs = require("fs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "writ-resolve-"));
fs.mkdirSync(path.join(root, "writ"));
fs.writeFileSync(path.join(root, "writ", "dune-project"), "(lang dune 3.0)\n");
fs.mkdirSync(path.join(root, "writ-vscode")); // a sibling that is NOT a checkout
fs.mkdirSync(path.join(root, "notes"));

workspace = [folder(root)];
c = candidates(DEFAULT);
check(
  "a checkout one level below the workspace root is found",
  c.includes(path.join(root, "writ", DEFAULT))
);
check(
  "the workspace root itself is still tried first",
  c[0] === path.join(root, DEFAULT)
);
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
workspace = [folder(path.join(root, "gone"))];
let threw = false;
try {
  candidates(DEFAULT);
} catch {
  threw = true;
}
check("a workspace folder that does not exist is survivable", !threw);

fs.rmSync(root, { recursive: true, force: true });

const n = 15 - failed;
console.log(
  failed === 0
    ? `extension resolve tests: ${n} checks passed`
    : `extension resolve tests: ${failed} FAILED`
);
process.exit(failed === 0 ? 0 : 1);
