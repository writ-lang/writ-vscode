// Copyright (C) 2026 Alex Kunich
// SPDX-License-Identifier: AGPL-3.0-or-later

// What the panel says about the install, and why it says it.
//
// The verdict is the extension's one piece of judgement. Everything else here
// either finds a path or forwards a message the server wrote; this decides,
// from four facts, which of four different things has gone wrong — and it is
// shown to a user as a warning, so getting it wrong means telling someone with
// a perfectly good install that it is broken.
//
// The ORDER of the cases is the part worth pinning. A stale build reports the
// same version as a current one, so if the versions were compared first, the
// most misleading state this extension can be in would report as healthy.
//
// Run: node test/status.test.js

const fs = require("fs");
const os = require("os");
const path = require("path");
const { suite } = require("./harness");
const { verdict } = require("../src/engine");
const { staleness, sourcesIn } = require("../src/staleness");
const { renderHtml, escapeHtml } = require("../src/panel");

const { check, done } = suite("status tests");

const base = {
  extension: "0.1.0",
  engine: "0.1.0",
  stale: null,
  checkout: "/w/writ",
  serverPath: "/w/writ/_build/default/tooling/lsp/bin/writ_lsp.exe",
};
const v = (over) => verdict({ ...base, ...over });

// --- the four states -------------------------------------------------------

check("matched versions, fresh build: nothing to say", v({}) === null);

check("no server at all is the bad one", v({ serverPath: null }).level === "bad");
check(
  "and it says what still works, because highlighting keeps working and that " +
    "is exactly what makes the failure hard to spot",
  /highlighting/.test(v({ serverPath: null }).message)
);

const mismatch = v({ engine: "0.2.0" });
check("a version mismatch is a warning, not an error", mismatch.level === "warn");
check("and it names both versions", /0\.1\.0/.test(mismatch.message) && /0\.2\.0/.test(mismatch.message));

const old = v({ stale: { path: "core/syntax/reader.ml" } });
check("a stale build is a warning", old.level === "warn");
check("and it names the file that outran it", /reader\.ml/.test(old.message));

const silent = v({ engine: null });
check("a server that reports no version is its own case", silent.level === "warn");
check(
  "and is not reported as a mismatch, which would be a lie about a version " +
    "nobody has",
  !/mismatch/.test(silent.message)
);

// --- the order -------------------------------------------------------------
//
// This is the whole reason staleness exists as a separate signal.
check(
  "a stale build is reported even though the versions agree",
  v({ engine: "0.1.0", stale: { path: "core/data/kind.ml" } }) !== null
);
check(
  "and staleness wins over a version mismatch, because rebuilding is the step " +
    "that has to happen first either way",
  /older than/.test(v({ engine: "0.9.9", stale: { path: "core/data/kind.ml" } }).message)
);

// --- what the verdict asks for ---------------------------------------------

check("in a checkout, the fix offered is a build", v({ serverPath: null }).action === "build");
check(
  "with no checkout, it is an install",
  v({ serverPath: null, checkout: null }).action === "install"
);

// --- the clock -------------------------------------------------------------

check("nothing is stale when there is no binary", staleness(null, [{ path: "a", mtime: 9 }], 0) === null);
check("nothing is stale when every source is older", staleness(100, [{ path: "a", mtime: 9 }], 0) === null);
check(
  "a newer source makes it stale, and names the newest one",
  staleness(100, [{ path: "a", mtime: 101 }, { path: "b", mtime: 900 }], 0).path === "b"
);
// dune is content-addressed: a build that changes nothing leaves the binary's
// mtime where it was, so without a record of the build HAVING RUN the warning
// could never be cleared by doing the thing it asks for.
check(
  "a completed build clears it even though the binary did not move",
  staleness(100, [{ path: "a", mtime: 900 }], 1000) === null
);

// A real walk, over a real tree, because the failure that matters is finding
// nothing: writ's sources are nested three deep and a flat listing sees none.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "writ-stale-"));
fs.mkdirSync(path.join(root, "tooling", "lsp", "lib", "feature"), { recursive: true });
fs.writeFileSync(path.join(root, "tooling", "lsp", "lib", "feature", "hover.ml"), "");
fs.mkdirSync(path.join(root, "core", "data"), { recursive: true });
fs.writeFileSync(path.join(root, "core", "data", "kind.ml"), "");
fs.writeFileSync(path.join(root, "core", "data", "kind.mli"), "");
fs.mkdirSync(path.join(root, "tooling", "lsp", "_build"), { recursive: true });
fs.writeFileSync(path.join(root, "tooling", "lsp", "_build", "stale.ml"), "");
fs.mkdirSync(path.join(root, "tests"), { recursive: true });
fs.writeFileSync(path.join(root, "tests", "test_lsp.ml"), "");
fs.mkdirSync(path.join(root, "core", "stdlib"), { recursive: true });
fs.writeFileSync(path.join(root, "core", "stdlib", "stdlib.writ"), "");

const found = sourcesIn(root).map((s) => s.path).sort();
check("a source nested three deep is found", found.includes("tooling/lsp/lib/feature/hover.ml"));
check("interfaces count as sources", found.includes("core/data/kind.mli"));
check("_build is not walked", !found.some((p) => p.includes("_build")));
check(
  "tests are not sources: a changed test does not make the server wrong",
  !found.some((p) => p.startsWith("tests/"))
);
check(
  "and neither is the .writ standard library, which is read at runtime and " +
    "never compiled in",
  !found.some((p) => p.endsWith(".writ"))
);
fs.rmSync(root, { recursive: true, force: true });

// --- the page --------------------------------------------------------------

check("a version is escaped before it reaches the page", escapeHtml('<b>&"') === "&lt;b&gt;&amp;&quot;");

const page = renderHtml({
  extension: "0.1.0",
  engineVersion: "0.1.0",
  serverPath: "/w/writ/_build/default/tooling/lsp/bin/writ_lsp.exe",
  checkout: "/w/writ",
  stale: null,
});
check("the panel offers the verbs", /writ\.check/.test(page) && /writ\.derive/.test(page));
check("and a way back to the server log", /writ\.showOutput/.test(page));
check("a healthy install draws the reassuring status, not an empty box", /status ok/.test(page));

const broken = renderHtml({
  extension: "0.1.0",
  engineVersion: null,
  serverPath: null,
  checkout: null,
  stale: null,
});
check("no server draws the bad status", /status bad/.test(broken));
check("and the button offered is the update, not a build of a checkout that is not there", /writ\.update/.test(broken));
check("the engine version reads as not found rather than blank", /not found/.test(broken));

const nover = renderHtml({ ...base, engineVersion: null, engine: undefined });
check(
  "a server that reported no version reads as not reported, which is a " +
    "different thing from not found",
  /not reported/.test(nover)
);

done();
