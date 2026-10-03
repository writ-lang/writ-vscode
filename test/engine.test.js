// Copyright (C) 2026 Alex Kunich
// SPDX-License-Identifier: AGPL-3.0-or-later

// The extension against a REAL engine: what it asks of `writ-lsp`, and the
// command lines it hands to `writ`.
//
// The other test files check this repository's JavaScript, and nothing in them
// would notice the engine changing underneath it. That coupling is the one most
// likely to break silently: a capability the server stops advertising, or a
// flag the CLI renames, leaves the extension running and doing nothing. The
// verbs are the worst case, because they are typed into a terminal and nobody
// reads the usage error that comes back.
//
// So this spawns the server the extension would find, speaks LSP to it over
// vscode-jsonrpc (already installed, as vscode-languageclient's transport),
// and runs each command-line SHAPE src/commands.js builds. A new verb or flag
// there belongs here too.
//
// No engine, no test: with no `writ-lsp`, or no node_modules to speak LSP
// with, it prints a skip and passes, so this stays as installable as the rest. Set WRIT_E2E_REQUIRED=1 to make a missing
// engine a failure, which is what writ's downstream image does. WRIT_LSP names
// a server explicitly.
//
// Run: node test/engine.test.js

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { suite } = require("./harness");
const locate = require("../src/locate");

const { check, done } = suite("engine tests");

// Found the way the extension finds an installed one, and its CLI derived from
// it the way the extension derives it — beside the server, not off PATH.
function skip(why) {
  if (process.env.WRIT_E2E_REQUIRED === "1") {
    console.log(`FAIL: ${why}, and WRIT_E2E_REQUIRED=1`);
    process.exit(1);
  }
  console.log(`engine tests: SKIP — ${why}`);
  process.exit(0);
}

const server =
  process.env.WRIT_LSP ||
  locate.onPath(locate.INSTALLED).find((p) => fs.existsSync(p));
if (!server) skip("no writ-lsp on PATH (set WRIT_LSP=)");

// Required here rather than at the top: the other test files need nothing
// installed, and a checkout without `npm ci` should skip this, not crash.
let rpc;
try {
  rpc = require("vscode-jsonrpc/node");
} catch {
  skip("vscode-jsonrpc is not installed (run npm ci)");
}
const cli = locate.cliFor(server);

// A model small enough to read, using the stdlib so the load path is exercised
// from a directory that is not the install prefix.
const MODEL = [
  '(load "stdlib.writ")',
  "(schema s (type v (lo hi)) (type box (arrow f (to v))))",
  "(instance i s (box b (f lo)))",
  "(use s)",
  "(initial i)",
  "(transition raise (when (is b.f lo)) (do (set b.f hi)))",
  "",
].join("\n");
const CLAIMS = '(property raised "b can go high" (possible (is b.f hi)))\n';
const RULES = '(load "ct.rules")\n';
// An unbalanced form: whatever else changes, the reader must reject it.
const BROKEN = "(schema s (type v (lo hi))\n";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "writ-e2e-"));
const file = (name, text) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, text);
  return p;
};
const model = file("m.writ", MODEL);
const claims = file("m.claims", CLAIMS);
const rules = file("m.rules", RULES);
const other = file("other.writ", MODEL);
const broken = file("broken.writ", BROKEN);
const uri = (p) => "file://" + p;

// ── the command lines ────────────────────────────────────────────────────────
// Exit 0 and 1 are verdicts (1 means "has findings"); 2 is how the CLI says it
// could not run the command at all, which for these inputs means the shape the
// extension builds is no longer one the CLI accepts.
function cliChecks() {
  check("a `writ` CLI is found beside the server", !!cli);
  if (!cli) return;
  const shapes = [
    ["check", model],
    ["check", model, "--claims", claims],
    ["show", model, "--at", "0"],
    ["show", model, "--at", "0", "--at", "1"],
    ["derive", model, rules, "reach"],
    ["derive", model, rules, "(reach X Y)"],
    ["derive", model, rules, "--why", "(reach 0 1)"],
    ["compare", model, other],
  ];
  for (const args of shapes) {
    const r = spawnSync(cli, args, { cwd: dir, encoding: "utf8" });
    const ok = r.status === 0 || r.status === 1;
    if (!ok) console.log(`  writ ${args.join(" ")}\n  ${r.stderr.trim()}`);
    const shown = args.map((a) => (a.startsWith(dir) ? path.basename(a) : a));
    check(`writ ${shown.join(" ")} is accepted`, ok);
  }
}

// ── the language server ─────────────────────────────────────────────────────
async function lspChecks() {
  const proc = spawn(server, [], { stdio: ["pipe", "pipe", "inherit"] });
  const conn = rpc.createMessageConnection(
    new rpc.StreamMessageReader(proc.stdout),
    new rpc.StreamMessageWriter(proc.stdin)
  );
  const diagnostics = new Map();
  const waiting = new Map();
  conn.onNotification("textDocument/publishDiagnostics", (p) => {
    diagnostics.set(p.uri, p.diagnostics);
    const w = waiting.get(p.uri);
    if (w) w(p.diagnostics);
  });
  conn.listen();
  const diagnosticsFor = (u) =>
    diagnostics.has(u)
      ? Promise.resolve(diagnostics.get(u))
      : new Promise((resolve) => {
          waiting.set(u, resolve);
          setTimeout(() => resolve(null), 10000);
        });
  const open = (p) =>
    conn.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: uri(p),
        languageId: "writ",
        version: 1,
        text: fs.readFileSync(p, "utf8"),
      },
    });

  const init = await conn.sendRequest("initialize", {
    processId: process.pid,
    rootUri: uri(dir),
    capabilities: {},
  });
  conn.sendNotification("initialized", {});
  const caps = init.capabilities || {};
  const info = init.serverInfo || {};
  check("initialize names the server", !!info.name);
  // engine.js shows this version in the panel and compares it with the
  // extension's; a server that stops sending it reads as "unknown engine".
  check("initialize reports a version", !!info.version);
  check("full-document sync, which is what the client sends", caps.textDocumentSync === 1);
  check("hover is advertised", caps.hoverProvider === true);
  check("the outline is advertised", caps.documentSymbolProvider === true);
  check("completion is advertised", !!caps.completionProvider);

  open(model);
  const clean = await diagnosticsFor(uri(model));
  check("a good model gets diagnostics published", Array.isArray(clean));
  check(
    "and none of them is an error",
    Array.isArray(clean) && !clean.some((d) => d.severity === 1)
  );

  open(broken);
  const bad = await diagnosticsFor(uri(broken));
  check(
    "a broken model gets an error, with a range to underline",
    Array.isArray(bad) &&
      bad.some((d) => d.severity === 1 && d.range && d.range.start)
  );

  const symbols = await conn.sendRequest("textDocument/documentSymbol", {
    textDocument: { uri: uri(model) },
  });
  check("the outline is not empty", Array.isArray(symbols) && symbols.length > 0);
  check(
    "and it names the transition",
    JSON.stringify(symbols || []).includes("raise")
  );

  // On the `initial` keyword: the server documents the language's forms, and
  // completion offers names at the same place.
  const at = { line: 4, character: 2 };
  const hover = await conn.sendRequest("textDocument/hover", {
    textDocument: { uri: uri(model) },
    position: at,
  });
  check(
    "hover documents a form",
    JSON.stringify((hover && hover.contents) || "").includes("initial")
  );
  const completion = await conn.sendRequest("textDocument/completion", {
    textDocument: { uri: uri(model) },
    position: at,
  });
  const items = Array.isArray(completion) ? completion : (completion || {}).items;
  check("completion offers something", Array.isArray(items) && items.length > 0);

  await conn.sendRequest("shutdown");
  conn.sendNotification("exit");
  const exited = await new Promise((resolve) => {
    proc.on("exit", () => resolve(true));
    setTimeout(() => resolve(false), 5000);
  });
  check("shutdown then exit stops the server", exited);
  if (!exited) proc.kill();
  conn.dispose();
}

(async () => {
  console.log(`engine tests: ${server}`);
  cliChecks();
  try {
    await lspChecks();
  } catch (e) {
    check(`the LSP session completes (${e.message})`, false);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  done();
})();
