// Copyright (C) 2026 Alex Kunich
// SPDX-License-Identifier: AGPL-3.0-or-later

// The commands.
//
// Every one of them runs the SAME writ the language server is: `engine.current().cli`
// is derived from the resolved server, never looked up on its own. That is the
// whole point — an editor whose "check this file" disagrees with its own
// squiggles would be worse than having no command at all.
//
// The verbs run in a terminal, not a task and not an output channel: `writ
// check` prints a report meant to be read, `writ derive --why` prints a tree,
// and both are things you scroll back through and re-run with an edited
// argument. A task would file them under the Problems view, which is where the
// server's diagnostics already live and where a report is not a diagnostic.
//
// [build] is the exception, and for the opposite reason: nobody reads a build
// log that succeeded, and the one thing that has to be known about it is
// whether it did. Only a task reports an exit code.

const fs = require("fs");
const path = require("path");
const engine = require("./engine");
const staleness = require("./staleness");
const panel = require("./panel");

let terminal = null;

function shell() {
  const vscode = require("vscode");
  if (!terminal || terminal.exitStatus !== undefined) {
    terminal = vscode.window.createTerminal("writ");
  }
  terminal.show(true);
  return terminal;
}

// Quote for a shell, because these are typed into a terminal.
function quote(s) {
  return /[^\w@%+=:,./-]/.test(s) ? "'" + s.replace(/'/g, "'\\''") + "'" : s;
}

// The CLI, or a complaint that says what to do about not having one. Every verb
// goes through this, so the message is written once.
function cli() {
  const vscode = require("vscode");
  const found = engine.current().cli;
  if (found) return found;
  vscode.window
    .showWarningMessage(
      "Writ: no `writ` command line to run. The language server answers " +
        "diagnostics, but the verbs need the CLI, which ships beside it.",
      "Open the Writ panel"
    )
    .then((c) => {
      if (c) vscode.commands.executeCommand("writ.openOverview");
    });
  return null;
}

function run(args) {
  const found = cli();
  if (!found) return;
  shell().sendText([quote(found), ...args.map(quote)].join(" "));
}

// The file a command acts on: the one the explorer offered, else the active
// editor's. Saved first when it is dirty, because the CLI reads the disk and
// checking the previous save is a confusing kind of wrong answer.
async function target(uri) {
  const vscode = require("vscode");
  const editor = vscode.window.activeTextEditor;
  const chosen = uri && uri.fsPath ? uri : editor ? editor.document.uri : null;
  if (!chosen) {
    vscode.window.showInformationMessage("Writ: no file to act on.");
    return null;
  }
  if (
    editor &&
    editor.document.uri.toString() === chosen.toString() &&
    editor.document.isDirty
  )
    await editor.document.save();
  return chosen.fsPath;
}

// The model a .claims or .rules file belongs to.
//
// A sibling of the same name first — the convention writ's own help states
// ("A model's questions live beside it in MODEL.claims") — and a pick over the
// workspace's models when there is none, rather than an error. Splitting
// questions from models is deliberate in this language; one question suite is
// meant to be asked of several models, and a command that could only ever ask
// the sibling would be arguing with the design.
async function modelFor(file) {
  const vscode = require("vscode");
  const sibling = file.replace(/\.[^.]+$/, ".writ");
  if (sibling !== file && fs.existsSync(sibling)) return sibling;
  const found = await vscode.workspace.findFiles("**/*.writ", "**/_build/**", 200);
  if (!found.length) {
    vscode.window.showInformationMessage(
      "Writ: no model to ask. A .claims or .rules file is a question about a " +
        "model, and there is no .writ file in this workspace to ask it of."
    );
    return null;
  }
  const pick = await vscode.window.showQuickPick(
    found.map((u) => ({
      label: path.basename(u.fsPath),
      description: vscode.workspace.asRelativePath(u),
      path: u.fsPath,
    })),
    { title: "Which model?", placeHolder: path.basename(file) + " asks about…" }
  );
  return pick ? pick.path : null;
}

// --- the verbs -------------------------------------------------------------

// `writ check` on whatever is in front of you, with the questions attached.
//
// The two file types swap roles and the command must not: from a model, the
// sibling .claims is the optional extra; from a .claims, the model is the
// argument and the buffer is the extra. Asking the user which way round it goes
// would be asking them to restate something the extension can see.
async function check(uri) {
  const file = await target(uri);
  if (!file) return;
  if (file.endsWith(".claims")) {
    const model = await modelFor(file);
    if (!model) return;
    run(["check", model, "--claims", file]);
    return;
  }
  if (file.endsWith(".rules")) {
    // `check` has nothing to say about a .rules file; `derive` is the verb.
    await derive(uri);
    return;
  }
  const claims = file.replace(/\.writ$/, ".claims");
  run(claims !== file && fs.existsSync(claims)
    ? ["check", file, "--claims", claims]
    : ["check", file]);
}

async function show(uri) {
  const vscode = require("vscode");
  const file = await target(uri);
  if (!file) return;
  const model = file.endsWith(".writ") ? file : await modelFor(file);
  if (!model) return;
  const at = await vscode.window.showInputBox({
    title: "Show a situation",
    prompt:
      "The state index to print. Empty shows the initial situation. " +
      "Several, space-separated, print several.",
    placeHolder: "0",
  });
  if (at === undefined) return; // escaped, as opposed to entered empty
  const indices = at.trim().split(/\s+/).filter(Boolean);
  run(["show", model, ...indices.flatMap((i) => ["--at", i])]);
}

// `writ derive`, which needs three things: the model, the rules, and the
// question. Two of them are on screen whenever this is worth running.
async function derive(uri) {
  const vscode = require("vscode");
  const file = await target(uri);
  if (!file) return;
  let rules = file;
  if (!file.endsWith(".rules")) {
    const found = await vscode.workspace.findFiles("**/*.rules", "**/_build/**", 200);
    if (!found.length) {
      vscode.window.showInformationMessage(
        "Writ: no .rules file in this workspace to derive from."
      );
      return;
    }
    const pick = await vscode.window.showQuickPick(
      found.map((u) => ({
        label: path.basename(u.fsPath),
        description: vscode.workspace.asRelativePath(u),
        path: u.fsPath,
      })),
      { title: "Which rules?" }
    );
    if (!pick) return;
    rules = pick.path;
  }
  // The model, which is `file` only when `file` IS one. Reached here from a
  // .claims buffer as well as a .rules one — the palette entry is on the
  // language, and all three extensions are the same language — and passing a
  // .claims file where the model belongs would be a parse error blamed on the
  // wrong file.
  const model = file.endsWith(".writ") ? file : await modelFor(file);
  if (!model) return;
  const question = await vscode.window.showInputBox({
    title: "Answer a relation",
    prompt:
      "A bare RELATION prints every row; \"(RELATION ARG…)\" keeps the matching " +
      "ones, ALL-CAPS being a free variable. Prefix with `why ` for the " +
      "derivation tree of one fact.",
    placeHolder: "subordinate     or     (subordinate nabu X)     or     why (subordinate nabu cabinet)",
  });
  if (question === undefined || !question.trim()) return;
  const q = question.trim();
  const why = /^why\s+/i.test(q);
  run([
    "derive",
    model,
    rules,
    ...(why ? ["--why", q.replace(/^why\s+/i, "")] : [q]),
  ]);
}

async function compare(uri) {
  const vscode = require("vscode");
  const file = await target(uri);
  if (!file || !file.endsWith(".writ")) {
    vscode.window.showInformationMessage(
      "Writ: compare takes two models — open a .writ file first."
    );
    return;
  }
  const found = (
    await vscode.workspace.findFiles("**/*.writ", "**/_build/**", 200)
  ).filter((u) => u.fsPath !== file);
  if (!found.length) {
    vscode.window.showInformationMessage(
      "Writ: there is no second model in this workspace to compare with."
    );
    return;
  }
  const pick = await vscode.window.showQuickPick(
    found.map((u) => ({
      label: path.basename(u.fsPath),
      description: vscode.workspace.asRelativePath(u),
      path: u.fsPath,
    })),
    {
      title: "Compare with",
      placeHolder:
        "The NEW model. " + path.basename(file) + " is the old one, and its " +
        "sibling .claims supplies the properties.",
    }
  );
  if (!pick) return;
  run(["compare", file, pick.path]);
}

// --- the install itself ----------------------------------------------------

// Build the engine, in the checkout the server came from.
//
// `make build` and not `dune build`: the Makefile is what writ's own README
// tells you to run, and it is the target that knows about the opam switch.
//
// A TASK and not a plain terminal, for one reason: the staleness verdict has to
// be cleared by a build that SUCCEEDED, and a terminal cannot say whether one
// did. `sendText` types into a shell, and the shell's own exit status is what
// closing the terminal reports — zero whether or not make failed. A task
// reports the process's code.
//
// Clearing it needs saying at all because dune is content-addressed: a build
// that changes nothing leaves the binary's mtime exactly where it was, so the
// watcher next door never fires and "older than core/…/reader.ml" would stand
// for ever after a build that did the right thing and had nothing to do.
function build() {
  const vscode = require("vscode");
  const root = engine.current().checkout;
  if (!root) {
    vscode.window.showInformationMessage(
      "Writ: nothing to build here — the server in use is an installed one, " +
        "not a checkout’s. Use “Update writ” instead."
    );
    return;
  }
  // Which folder the task belongs to, matched on a path boundary: a plain
  // prefix test would put a build of `writ` under a workspace folder called
  // `writ-vscode`, which is exactly the pair of names this project has.
  const folder = (vscode.workspace.workspaceFolders || []).find(
    (f) => root === f.uri.fsPath || root.startsWith(f.uri.fsPath + path.sep)
  );
  const task = new vscode.Task(
    { type: "shell", task: "writ: build the engine" },
    folder || vscode.TaskScope.Workspace,
    "build the engine",
    "writ",
    new vscode.ShellExecution("make build", { cwd: root })
  );
  const ended = vscode.tasks.onDidEndTaskProcess((e) => {
    if (e.execution.task !== task) return;
    ended.dispose();
    if (e.exitCode !== 0) return;
    staleness.markBuilt();
    panel.refresh();
    // The watcher restarts the server when the binary is replaced. When it was
    // not — the content-addressed case above — nothing is running that is
    // stale, so there is nothing else to do.
  });
  vscode.tasks.executeTask(task);
}

const PIN = "opam pin add writ git+https://github.com/writ-lang/writ.git";

// Update an installed writ.
//
// Re-running the pin is the update: opam re-fetches the branch and rebuilds,
// which is exactly what `opam upgrade writ` would do for a pinned package and
// works whether or not one is pinned already. Typed into a terminal rather than
// spawned, because it takes minutes, prints as it goes, and may ask a question.
function update() {
  const vscode = require("vscode");
  if (engine.current().checkout) {
    build();
    return;
  }
  const t = vscode.window.createTerminal("writ update");
  t.show(true);
  t.sendText(PIN, false); // NOT executed: an install command is the user's to press enter on
}

function register(context) {
  const vscode = require("vscode");
  const on = (name, fn) =>
    context.subscriptions.push(vscode.commands.registerCommand(name, fn));

  on("writ.check", check);
  on("writ.show", show);
  on("writ.derive", derive);
  on("writ.compare", compare);
  on("writ.build", build);
  on("writ.update", update);

  on("writ.restartServer", async () => {
    await engine.restart();
    panel.refresh();
    vscode.window.setStatusBarMessage("Writ: language server restarted", 3000);
  });
  on("writ.showOutput", () => {
    const client = engine.current().client;
    if (client && client.outputChannel) client.outputChannel.show(true);
    else
      vscode.window.showInformationMessage(
        "Writ: no server log — the language server never started."
      );
  });
  on("writ.openSettings", () =>
    vscode.commands.executeCommand("workbench.action.openSettings", engine.SETTING)
  );
}

module.exports = { register, quote, PIN };
