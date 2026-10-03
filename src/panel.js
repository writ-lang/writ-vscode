// Copyright (C) 2026 Alex Kunich
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Activity Bar panel.
//
// DELIBERATELY NOT THE README. VS Code already shows the readme and the version
// if you click the extension in the Extensions sidebar, so nothing here is
// information the editor lacks — this is about WHERE SOMEONE LOOKS when the
// thing they are looking at is wrong.
//
// Two things earn their place in a 250px strip.
//
// The INSTALL STATUS, because this extension bundles no engine and downloads
// none: it talks to a `writ-lsp` you already have, resolved at activation from a
// checkout's `_build` or from PATH. Every way that can go wrong produces the
// same symptom — an editor that highlights and says nothing else — and the three
// causes want three different things done about them. No server, a server older
// than the sources it was built from, and a server that is a different writ than
// this extension: the first needs an install, the second a build, the third
// either. Until now the extension said one of these once, in a toast, at
// activation, and then never again.
//
// And the VERBS, because writ is a command-line tool that answers questions and
// the extension exposed none of them. `check` on the file in front of you is
// two clicks from here rather than a remembered invocation with two paths in it.
//
// The file-type table is three lines and stays because the split — models here,
// questions there, derivations somewhere else — is the first thing about this
// language a person has to hold in their head, and the panel is already open.

const engine = require("./engine");

const GUIDE = "https://github.com/writ-lang/writ-vscode#readme";
const LANGUAGE = "https://github.com/writ-lang/writ#readme";

const FILE_TYPES = [
  [".writ", "models and libraries — schema, instance, transitions"],
  [".claims", "the questions asked of a model, kept as their own document"],
  [".rules", "Datalog-style derivations over a model's situation space"],
];

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]
  );
}

// The action button under the status line, if the verdict asks for one.
// Named here rather than in [engine.verdict] so that the verdict stays a
// statement about the install and not a piece of user interface.
function actionButton(action, checkout) {
  if (action === "build")
    return '<button id="act">Build the engine</button>';
  if (action === "install")
    return (
      '<button id="act">' +
      (checkout ? "Build the engine" : "Update writ…") +
      "</button>"
    );
  return "";
}

// Pure, so the whole panel can be rendered and inspected under plain node —
// which test/panel.test.js does, because a webview is otherwise only checkable
// by looking at it.
function renderHtml({ extension, engineVersion, serverPath, checkout, stale }) {
  const v = engine.verdict({
    extension,
    engine: engineVersion,
    stale,
    checkout,
    serverPath,
  });
  const status = v
    ? escapeHtml(v.message)
    : "The extension and the engine are in step.";
  const cls = v ? v.level : "ok";
  const shownEngine =
    engineVersion === null || engineVersion === undefined
      ? serverPath
        ? "not reported"
        : "not found"
      : escapeHtml(String(engineVersion).trim());

  const types = FILE_TYPES.map(
    ([ext, what]) =>
      '<tr><td class="ext">' +
      escapeHtml(ext) +
      "</td><td>" +
      escapeHtml(what) +
      "</td></tr>"
  ).join("\n");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
 body { font: 13px var(--vscode-font-family); color: var(--vscode-foreground);
        padding: 12px 14px; }
 h2 { font-size: 11px; margin: 18px 0 6px; text-transform: uppercase;
      letter-spacing: .07em; opacity: .7; font-weight: 600; }
 h2:first-child { margin-top: 0; }
 dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; }
 dt { opacity: .75; }
 dd { margin: 0; font-variant-numeric: tabular-nums; }
 .path { opacity: .6; font-size: 11px; word-break: break-all; margin-top: 4px;
         font-family: var(--vscode-editor-font-family); }
 .status { margin: 10px 0 0; padding: 8px 10px; border-radius: 4px;
           line-height: 1.45; border-left: 3px solid; }
 .ok   { border-color: var(--vscode-charts-green);
         background: var(--vscode-textBlockQuote-background); }
 .warn { border-color: var(--vscode-charts-yellow);
         background: var(--vscode-inputValidation-warningBackground); }
 .bad  { border-color: var(--vscode-charts-red);
         background: var(--vscode-inputValidation-errorBackground); }
 table { border-collapse: collapse; width: 100%; line-height: 1.5; }
 td { padding: 1px 0; vertical-align: top; }
 td + td { padding-left: 9px; }
 .ext { font-family: var(--vscode-editor-font-family); font-weight: 600;
        white-space: nowrap; }
 button { display: block; width: 100%; text-align: left; margin: 4px 0;
          padding: 6px 10px; border: none; border-radius: 3px; cursor: pointer;
          font: inherit; color: var(--vscode-button-foreground);
          background: var(--vscode-button-background); }
 button:hover { background: var(--vscode-button-hoverBackground); }
 button.secondary { color: var(--vscode-button-secondaryForeground);
                    background: var(--vscode-button-secondaryBackground); }
</style></head><body>

 <h2>Ask something</h2>
 <button data-cmd="writ.check">Check this file</button>
 <button data-cmd="writ.show">Show a situation…</button>
 <button data-cmd="writ.derive">Answer a relation…</button>
 <button data-cmd="writ.compare" class="secondary">Compare with another model…</button>

 <h2>Three kinds of file</h2>
 <table>${types}</table>

 <h2>The engine</h2>
 <dl>
  <dt>Extension</dt><dd>${escapeHtml(extension)}</dd>
  <dt>Engine</dt><dd>${shownEngine}</dd>
 </dl>
 <div class="path">${escapeHtml(serverPath || "no language server")}</div>
 <p class="status ${cls}">${status}</p>
 ${v ? actionButton(v.action, checkout) : ""}
 <button data-cmd="writ.restartServer" class="secondary">Restart the language server</button>
 <button data-cmd="writ.showOutput" class="secondary">Show the server log</button>
 <button data-cmd="writ.openSettings" class="secondary">Settings…</button>

 <h2>Help</h2>
 <button id="guide" class="secondary">The extension, in full</button>
 <button id="language" class="secondary">The language, in full</button>

<script>
 const api = acquireVsCodeApi();
 for (const b of document.querySelectorAll('button[data-cmd]'))
   b.addEventListener('click', () => api.postMessage({ command: b.dataset.cmd }));
 const act = document.getElementById('act');
 if (act) act.addEventListener('click',
   () => api.postMessage({ command: '${v && v.action === "build" ? "writ.build" : "writ.update"}' }));
 document.getElementById('guide')
   .addEventListener('click', () => api.postMessage({ open: '${GUIDE}' }));
 document.getElementById('language')
   .addEventListener('click', () => api.postMessage({ open: '${LANGUAGE}' }));
</script>
</body></html>`;
}

// The view, once it exists, so that anything which changes what the panel says
// can ask it to say it again. Rendering once and never again would be a bug of
// its own: you build the engine, the warning stays, and the panel is the only
// thing left in the editor still claiming you are out of date.
let live = null;

function refresh() {
  if (live) live();
}

function register(context) {
  const vscode = require("vscode");

  const provider = {
    resolveWebviewView(view) {
      view.webview.options = { enableScripts: true };
      const mine =
        (context.extension &&
          context.extension.packageJSON &&
          context.extension.packageJSON.version) ||
        "0.0.0";

      const paint = () => {
        const s = engine.current();
        view.webview.html = renderHtml({
          extension: mine,
          engineVersion: s.version,
          serverPath: s.serverPath,
          checkout: s.checkout,
          stale: engine.stale(),
        });
      };
      live = paint;
      paint();

      view.onDidChangeVisibility(() => {
        if (view.visible) paint();
      });
      view.onDidDispose(() => {
        if (live === paint) live = null;
      });

      view.webview.onDidReceiveMessage((m) => {
        if (m.command) vscode.commands.executeCommand(m.command);
        else if (m.open) vscode.env.openExternal(vscode.Uri.parse(m.open));
      });
    },
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("writ.home", provider),

    // A Command Palette route to the panel, because the Activity Bar entry can
    // be invisible through no fault of the manifest: VS Code stores per-user
    // workbench state in workbench.activity.pinnedViewlets2, and on a crowded
    // bar a newly contributed container can land there pinned but not visible —
    // registered, ordered, and never drawn. "Click the icon" is then a dead end
    // with nothing to search for. VS Code generates <viewId>.focus for a
    // contributed view; this wraps it under a name a person can find by typing
    // "writ".
    vscode.commands.registerCommand("writ.openOverview", () =>
      vscode.commands.executeCommand("writ.home.focus")
    )
  );
}

module.exports = { register, refresh, renderHtml, escapeHtml, FILE_TYPES };
