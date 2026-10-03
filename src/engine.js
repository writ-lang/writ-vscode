// Copyright (C) 2026 Alex Kunich
// SPDX-License-Identifier: AGPL-3.0-or-later

// What engine this editor is talking to, and whether it is the right one.
//
// The extension and the engine are SEPARATE INSTALLS — a .vsix from one place,
// a `writ-lsp` from an opam pin or a checkout's `_build` from another — and
// nothing has ever made them agree. When they disagree the editor does not
// break; it answers, confidently, with a different writ than the one you think
// you have, and the symptom is a diagnostic `writ check` will not reproduce.
//
// This module is the one place that knows the answer, so the panel, the
// commands and the activation warning all report the same thing.

const locate = require("./locate");
const staleness = require("./staleness");

const SETTING = "writ.serverPath";

const state = {
  serverPath: null, // the server that was resolved, or null
  tried: [], // every candidate, so a failure can name them
  checkout: null, // the checkout it was built in, or null if installed
  cli: null, // the `writ` command line belonging to that same install
  version: null, // what its `initialize` reported, or null
  client: null,
};

function configured() {
  const vscode = require("vscode");
  return vscode.workspace.getConfiguration().get(SETTING, locate.DEFAULT_SERVER);
}

function folders() {
  const vscode = require("vscode");
  return (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
}

// Look for the server and remember what was found. Returns the state so a
// caller does not have to fetch it separately.
function resolve() {
  const fs = require("fs");
  state.tried = locate.candidates(configured(), folders());
  state.serverPath = state.tried.find((p) => fs.existsSync(p)) || null;
  state.checkout = state.serverPath ? locate.checkoutOf(state.serverPath) : null;
  state.cli = state.serverPath ? locate.cliFor(state.serverPath) : null;
  state.version = null;
  staleness.forget();
  return state;
}

function current() {
  return state;
}

// The version the server named itself with, from `initialize`.
//
// A server that reports none is not an error: it is a writ from before the LSP
// grew serverInfo. Saying so is worth a line in the panel, because "unknown" and
// "mismatched" want different things done about them and look identical if both
// are drawn as a warning.
function readVersion(client) {
  const info =
    client && client.initializeResult && client.initializeResult.serverInfo;
  state.version = (info && info.version) || null;
  return state.version;
}

function attach(client) {
  state.client = client;
}

function stale() {
  if (!state.serverPath) return null;
  return staleness.stale(state.checkout, state.serverPath);
}

// The verdict, as one fact about the install.
//
// Pure — extension version, engine version, staleness and whether there is a
// checkout, in; a level and a sentence, out — so every case can be checked
// under plain node. Null means "nothing to say", which the panel draws as the
// reassuring line rather than as no line at all: an empty status box is
// indistinguishable from a panel that failed to render.
//
// ORDER MATTERS. Staleness is asked BEFORE the versions are compared, because a
// server that is merely out of date reports the same version as a current one —
// the two agree, and the agreement is exactly the misleading part.
function verdict({ extension, engine, stale, checkout, serverPath }) {
  if (!serverPath) {
    return {
      level: "bad",
      message:
        "No language server. Syntax highlighting still works — it is a grammar " +
        "file — but there are no diagnostics, no outline, no hover and no " +
        "completion, because all four are answered by the engine.",
      action: checkout ? "build" : "install",
    };
  }
  if (stale) {
    return {
      level: "warn",
      message:
        "The server is older than " +
        stale.path +
        ". Until it is rebuilt, every answer here comes from a build that " +
        "predates your change — and it reports the same version as a current " +
        "one, so nothing else would tell you.",
      action: "build",
    };
  }
  if (engine === null || engine === undefined) {
    return {
      level: "warn",
      message:
        "The server did not say which writ it is. That means a writ from " +
        "before the language server reported one, so this extension cannot " +
        "tell whether the two are in step. Updating writ restores the check.",
      action: checkout ? "build" : "install",
    };
  }
  if (String(engine).trim() !== String(extension).trim()) {
    return {
      level: "warn",
      message:
        "The extension is " +
        extension +
        " and the engine is " +
        String(engine).trim() +
        ". They are released together; a mismatch means one of them was " +
        "installed on its own, and a diagnostic here may not be one " +
        "`writ check` would give.",
      action: checkout ? "build" : "install",
    };
  }
  return null;
}

// Restart the running server. Used by the command and by the watcher.
function restart() {
  if (!state.client) return Promise.resolve();
  return state.client.restart().then(() => readVersion(state.client));
}

module.exports = {
  SETTING,
  resolve,
  current,
  readVersion,
  attach,
  stale,
  verdict,
  restart,
  configured,
};
