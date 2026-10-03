// Copyright (C) 2026 Alex Kunich
// SPDX-License-Identifier: AGPL-3.0-or-later

// The manifest against the code.
//
// package.json is the half of an extension that nothing typechecks. A command
// contributed but never registered shows up in the palette and does nothing
// when picked; a command registered but not contributed is unreachable except
// from a button; a menu or a webview button naming a command that is neither is
// a click that silently fails. All three are invisible until someone tries the
// one path that hits them, and none of them is a crash — which is why they get
// a test rather than a review.
//
// The panel in particular is HTML in a string: the buttons carry command ids
// that no tool anywhere resolves.
//
// Run: node test/manifest.test.js

const fs = require("fs");
const path = require("path");
const { suite } = require("./harness");

const { check, done } = suite("manifest tests");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const c = pkg.contributes;
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

// Every `writ.…` id the source registers, wherever it registers it.
const source = ["src/commands.js", "src/panel.js"].map(read).join("\n");
const registered = new Set(
  [...source.matchAll(/(?:registerCommand\(|\bon\()\s*"(writ\.[\w.]+)"/g)].map((m) => m[1])
);

const contributed = new Set(c.commands.map((x) => x.command));

// --- contributed against registered ----------------------------------------

for (const id of contributed)
  check(`${id} is contributed and registered`, registered.has(id));

// The reverse is not an error in general — a command can exist for a button
// alone — but it is worth knowing about, because an id that is registered and
// contributed nowhere is one nobody can reach from the palette either.
for (const id of registered)
  check(`${id} is registered and contributed`, contributed.has(id));

// --- everything that NAMES a command ---------------------------------------

const referenced = new Set();
for (const group of Object.values(c.menus || {}))
  for (const item of group) referenced.add(item.command);
for (const b of c.keybindings || []) referenced.add(b.command);
// The panel's buttons, which are command ids inside an HTML string.
for (const m of read("src/panel.js").matchAll(/(?:data-cmd="|command: ')(writ\.[\w.]+)/g))
  referenced.add(m[1]);
// And the ones the activation error offers.
for (const m of read("extension.js").matchAll(/executeCommand\("(writ\.[\w.]+)"/g))
  referenced.add(m[1]);

for (const id of referenced)
  check(`${id}, named in a menu or a button, exists`, registered.has(id));

check("the panel does name commands, so the check above is not vacuous", referenced.size > 5);

// --- the activity bar ------------------------------------------------------

const container = c.viewsContainers.activitybar[0];
check("there is an activity bar container", !!container);
check("its views are keyed by its id", Array.isArray(c.views[container.id]));

const view = c.views[container.id][0];
check("the view is a webview, which is what the panel renders", view.type === "webview");
check(
  "and the extension activates when it is opened — otherwise the panel that " +
    "explains a missing server would itself need a .writ file open to appear",
  (pkg.activationEvents || []).includes("onView:" + view.id)
);
check(
  "the panel registers a provider for exactly that id",
  read("src/panel.js").includes('registerWebviewViewProvider("' + view.id + '"')
);
check(
  "and the palette route focuses that same view — the activity bar icon can " +
    "be unpinned, and then it is the only way in",
  read("src/panel.js").includes('executeCommand("' + view.id + '.focus")')
);

// --- files the manifest promises -------------------------------------------

const icons = [
  container.icon,
  ...Object.values((c.languages[0] || {}).icon || {}),
  pkg.icon,
].filter(Boolean);
for (const i of icons)
  check(`${i} exists`, fs.existsSync(path.join(root, i.replace(/^\.\//, ""))));
check("the language icons are declared for both themes", icons.length >= 4);

check(
  "the grammar file exists",
  fs.existsSync(path.join(root, c.grammars[0].path.replace(/^\.\//, "")))
);
check("main points at a real file", fs.existsSync(path.join(root, pkg.main.replace(/^\.\//, ""))));

// --- the setting the code actually reads -----------------------------------

const setting = Object.keys(c.configuration.properties)[0];
check(
  "the contributed setting is the one src/engine.js reads",
  read("src/engine.js").includes('SETTING = "' + setting + '"')
);
check(
  "and its default is the path src/locate.js defaults to",
  c.configuration.properties[setting].default ===
    read("src/locate.js").match(/DEFAULT_SERVER = "([^"]+)"/)[1]
);

// --- version -----------------------------------------------------------------
//
// Cheap here, and the README is the copy that gets forgotten. scripts/version.sh
// is the thing that fixes it; this is the thing that notices.
check(
  "the README's .vsix filename carries the manifest's version",
  read("README.md").includes("writ-" + pkg.version + ".vsix")
);

done();
