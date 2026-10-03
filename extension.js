// Copyright (C) 2026 Alex Kunich
// SPDX-License-Identifier: AGPL-3.0-or-later

// The VS Code client.
//
// It does one thing that matters: find the writ this workspace means and hand
// its language server to vscode-languageclient over stdio. Everything the
// editor answers — diagnostics, outline, hover, completion — is answered by the
// OCaml server, so that a squiggle here is one `writ check` would give.
//
// There is no compile step and no TypeScript, on purpose: a build pipeline
// would exist to typecheck glue. What the glue does have is structure, one
// module per concern under src/, and only this file and each module's
// [register] touch the vscode API — the rest is plain JavaScript that runs
// under node, which is what test/ exercises.

const vscode = require("vscode");
const { LanguageClient, TransportKind } = require("vscode-languageclient/node");

const engine = require("./src/engine");
const locate = require("./src/locate");
const staleness = require("./src/staleness");
const watcher = require("./src/watcher");
const commands = require("./src/commands");
const panel = require("./src/panel");
const download = require("./src/download");

let watching;

// Say what is missing, once, and offer what fixes it — first of all a download,
// where there is a released writ for this platform.
//
// Silence here would look like a server that starts and answers nothing, which
// is the same symptom as a broken server and much harder to chase. The PATH
// candidates are summarised rather than listed: naming forty directories buries
// the one thing worth reading, which is that `writ-lsp` was not in any of them.
function reportMissing(tried) {
  const onPath = locate.onPath(locate.INSTALLED);
  const inWorkspace = tried.filter((p) => !onPath.includes(p));
  const where = inWorkspace.length
    ? `not at ${inWorkspace.join(", ")}, and \`${locate.INSTALLED}\` is not on PATH`
    : `\`${locate.INSTALLED}\` is not on PATH`;
  vscode.window
    .showErrorMessage(
      `Writ: no language server — ${where}. ` +
        "In a checkout of the writ repository, run `make build`. Otherwise " +
        "install writ (`opam pin add writ git+https://github.com/writ-lang/writ.git`, " +
        "or a release tarball) so " +
        `\`${locate.INSTALLED}\` is on PATH — or set \`${engine.SETTING}\` to an ` +
        "absolute path to the server you want." +
        (download.platformOf() ? " Or download a released writ in one click." : ""),
      ...(download.platformOf() ? ["Download writ"] : []),
      "Open the Writ panel",
      "Open settings"
    )
    .then((choice) => {
      if (choice === "Download writ")
        vscode.commands.executeCommand("writ.downloadEngine");
      else if (choice === "Open the Writ panel")
        vscode.commands.executeCommand("writ.openOverview");
      else if (choice === "Open settings")
        vscode.commands.executeCommand("writ.openSettings");
    });
}

// Start the server, or record that there is none. Separated from [activate] so
// that a changed setting can redo exactly this and nothing else.
async function start(context) {
  const state = engine.resolve();

  // The panel and the commands are registered whether or not a server was
  // found — the panel is where the absence is explained, so it must exist
  // precisely when there is nothing to talk to.
  if (!state.serverPath) {
    reportMissing(state.tried);
    panel.refresh();
    return;
  }

  const client = new LanguageClient(
    "writ",
    "Writ Language Server",
    { command: state.serverPath, args: [], transport: TransportKind.stdio },
    {
      documentSelector: [{ scheme: "file", language: "writ" }],
      outputChannelName: "Writ Language Server",
    }
  );
  engine.attach(client);
  context.subscriptions.push(client);
  await client.start();

  // Which writ answered. This is the whole reason the server reports serverInfo:
  // the extension and the engine are separate installs and nothing else can tell
  // them apart. See the panel, which is where the comparison is shown.
  const version = engine.readVersion(client);

  const log = (m) => client.outputChannel.appendLine(`[client] ${m}`);
  log(`server: ${state.serverPath}`);
  log(`engine: ${version || "did not report a version"}`);
  if (state.checkout) log(`checkout: ${state.checkout}`);
  if (state.cli) log(`command line: ${state.cli}`);

  watching = watcher.watchServerBinary(state.serverPath, log, undefined, {
    restart: () => engine.restart(),
    onRestart: () => {
      staleness.markBuilt();
      panel.refresh();
    },
    onFailure: (e) =>
      vscode.window.showErrorMessage(
        `Writ: the language server changed on disk but would not restart: ${e}. ` +
          "Reload the window to pick it up."
      ),
  });
  context.subscriptions.push(watching);
  panel.refresh();
}

// Stop whatever is running and resolve the server again from scratch.
//
// The server may have moved, so everything derived from it is suspect: which
// binary, which version, whether it is stale, and whether it is running at
// all. A changed setting needs this, and so does a fresh download.
async function reload(context) {
  if (watching) watching.dispose();
  watching = undefined;
  const client = engine.current().client;
  if (client) await client.stop().catch(() => {});
  engine.attach(null);
  await start(context);
}

function activate(context) {
  // Downloaded engines live in the extension's own storage, which VS Code
  // keeps across updates of the extension and removes when it is uninstalled.
  engine.setStorage(context.globalStorageUri.fsPath);
  panel.register(context);
  commands.register(context, { reload: () => reload(context) });

  context.subscriptions.push(
    // Reloading the window used to be the only way to pick up a corrected
    // setting.
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (!event.affectsConfiguration("writ")) return;
      await reload(context);
    })
  );

  return start(context);
}

function deactivate() {
  if (watching) watching.dispose();
  const client = engine.current().client;
  return client ? client.stop() : undefined;
}

module.exports = { activate, deactivate };
