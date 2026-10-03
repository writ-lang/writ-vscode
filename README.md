# Writ extension for Visual Studio Code

[![AGPL-3.0 License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

Writ is a language for modelling a rule-governed world and getting every
consequence back, with the route. This extension is its editor: highlighting
for all three file types, and diagnostics, outline, hover and completion
served by the language's own OCaml server, so what the editor says is what
`writ check` says.

![A writ model and a claim about it](https://raw.githubusercontent.com/writ-lang/writ-vscode/main/docs/images/river-example.png)

## Features

- Syntax highlighting for `.writ` models, `.claims` question files and
  `.rules` derivations
- Diagnostics from the real parser and type-checker, as you type
- Document outline, hover and completion, all from the server
- Check this file, with the sibling `.claims` attached; from a `.claims` file
  the roles swap and the model becomes the argument
- Show a situation, answer a relation, compare with another model, each in a
  terminal, each with the `writ` that belongs to the same install as the
  server, never whatever is first on `PATH`
- A panel in the Activity Bar that shows which writ you are actually talking
  to: both versions, the server's path, and whether they are in step
- The server restarts itself when its binary changes on disk, so a fresh
  `make build` is what answers, not the process from before it

**The extension bundles no server and downloads none.** The point of an
OCaml server is that the editor and the checker are the same code. It talks
to a `writ-lsp` you already have.

## Supported

| Piece         | Where it comes from                                                                 |
| ------------- | ----------------------------------------------------------------------------------- |
| `writ-lsp`    | [writ](https://github.com/writ-lang/writ): an opam pin, a release tarball, or a checkout built with `make build` |
| VS Code       | 1.82 or later                                                                       |
| Remote windows| The extension runs on the workspace side, next to the server                        |

### Feature Contributions

- **Language:** Writ (`.writ`, `.claims`, `.rules`), with grammar
- **View:** a writ mark in the Activity Bar with an Overview panel
- **Keybinding:** `Ctrl+K Ctrl+Enter` checks this file
- **Commands** in the Command Palette under **Writ**, and in the editor and
  explorer context menus: Check This File; Show a Situation…; Answer a
  Relation…; Compare With Another Model…; Open the Writ Panel; Restart the
  Language Server; Show the Server Log; Build the Engine; Update writ…;
  Settings
- **Activation:** on opening a Writ file, or the panel

## Getting Started

**You need writ too.** On Linux (x86_64 or arm64) the easy route is the
**Download writ** button: in the Writ panel, in the "no language server"
message, or as **Writ: Download writ** in the Command Palette. It fetches the
release matching this extension (or the latest one, if that version was never
released), verifies its checksum, unpacks it into the extension's own storage
and starts it. Nothing goes on your `PATH`, and uninstalling the extension
removes it.

A writ you install yourself always wins over a downloaded one. The usual route
puts `writ-lsp` on your `PATH`:

```console
$ opam pin add writ git+https://github.com/writ-lang/writ.git   # or unpack a release tarball
$ command -v writ-lsp
/home/you/.opam/default/bin/writ-lsp
```

`writ` is not in opam-repository, so the pin is the no-checkout route. The
other ways to get one are in [writ's README](https://github.com/writ-lang/writ#install);
any of them puts `writ-lsp` on your `PATH`, which is all this extension needs.

Then install the extension. From this repository:

```console
$ ./install.sh
```

That fetches the dependencies, links the extension into every VS Code
extensions directory it finds, and verifies the server answers a handshake,
so a success message means it works. With no `writ-lsp` yet it warns and
installs anyway; installing writ afterwards is a fine order. Given a checkout
of writ inside or beside this one, it builds the server from source first,
and that build wins over an installed one. Then reload the window
(Developer: Reload Window); VS Code scans its extensions directory only at
startup.

Or package a `.vsix`:

```console
$ scripts/package-extension.sh
$ code --install-extension writ-0.1.0.vsix
```

Open a `.writ` file. Nothing to configure.

## Usage

**Check.** `Ctrl+K Ctrl+Enter`, or the ▷ in the editor title, runs
`writ check` on the file with its sibling `.claims` attached if there is one.
Squiggles while you type come from the same checker, so the two never
disagree unless the server is stale, and the panel tells you when it is.

**The verbs**, from the Command Palette or the panel:

| Command                         | Runs                                                                 |
| ------------------------------- | -------------------------------------------------------------------- |
| **Show a Situation…**           | `writ show --at N`                                                   |
| **Answer a Relation…**          | `writ derive` over a `.rules` file; prefix the question with `why ` for the derivation tree |
| **Compare With Another Model…** | `writ compare` against a model you pick                              |

**The panel.** Click the writ mark in the Activity Bar, or run **Writ: Open
the Writ Panel** if the icon ended up unpinned. It prints both versions, the
server's path, and a verdict. Every way this can be wrong produces the same
symptom, an editor that highlights and says nothing else, and the causes
want different fixes:

| It says                                   | What happened                                   | The button           |
| ----------------------------------------- | ----------------------------------------------- | -------------------- |
| no language server                        | nothing was found at any candidate path         | download writ, build, or install with opam |
| older than `core/…`                       | the checkout was edited since it was built      | build the engine     |
| the engine is *x*, the extension is *y*   | one of the two was installed on its own         | build, update writ, or download a fresh one if the current one was a download |
| the server did not say which writ it is   | a writ from before the server reported one      | update writ          |

The stale case is the one nothing else catches: a build from before this
morning's edit reports the same version as a current one. The panel compares
times, and offers the build.

**The server log.** View, Output, "Writ Language Server" shows which server
was launched and says so when it swaps after a rebuild.

## Configuration

| Setting           | Default                                        | Description                                                                                                                                                         |
| ----------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `writ.serverPath` | `_build/default/tooling/lsp/bin/writ_lsp.exe`  | A relative path is resolved against each open workspace folder, so the default finds a checkout's own build. If none has it, `writ-lsp` is looked up on `PATH`, and after that a writ downloaded by the extension. An absolute path is used exactly as given. |

If nothing exists at any of those, the extension says so and names what it
looked for.

## Troubleshooting

- **A diagnostic you disagree with.** `writ check` is the authority. If they
  differ, the server is stale; the output channel shows whether it restarted.
- **No diagnostics at all.** Check that channel for which server was
  launched, or whether the extension reported finding none.
- **A `(load …)` resolving to the wrong file.** `WRIT_TRACE_LOADS=1 writ check
  FILE` prints what each load resolved to. A `stdlib.writ` beside your model
  replaces the installed one, by design and silently.
- **Removing a linked install:** `./install.sh --uninstall`. The install is a
  symlink into the extensions directory, so moving the clone breaks it.

## Developing the Extension

- Open this repository in VS Code and press F5 for an Extension Development
  Host. There is no compile step; every request is answered by the server.
- `scripts/test.sh` runs the tests under plain node, nothing stubbed.
- `scripts/version.sh` keeps the extension's version in step with writ's.
- [DEVELOPING.md](DEVELOPING.md) has the module map, what each test guards
  against, and the version scheme. Patches need the CLA in
  [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Copyright (C) 2026 Alex Kunich. GNU Affero General Public License, version 3
or later, the same as [writ](https://github.com/writ-lang/writ) itself. See
[LICENSE](LICENSE).
