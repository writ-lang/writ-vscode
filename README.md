# Pol language support for VS Code

*The editor client for [pol](https://github.com/sajonaro/pol). The language,
the checker and the language server live there; this repository is the VS Code
front end and nothing else.*

Editor support for **Pol** — *Partial Olog*, an abstract language for modelling
real-world domains — over all three of its file types:

| | |
| --- | --- |
| `.pol` | models and libraries — schema, instance, transitions |
| `.claims` | the questions asked of a model, kept as their own document |
| `.rules` | Datalog-style derivations over a model's situation space |

Syntax highlighting, plus everything the language's own server provides:
diagnostics from the real parser and type-checker, a document outline, hover
and completion.

**The extension does not bundle a server and does not download one.** The point
of an OCaml server is that the editor and the checker are the *same code*, so a
diagnostic in the editor is one `pol check` would give you. It talks to a
`pol-lsp` you already have.

## Install

Two routes. The extension tries them in this order.

### With pol installed, and no checkout

The ordinary case. The extension needs `pol-lsp` on your `PATH`:

```console
$ opam install pol          # or unpack a release tarball
$ pol-lsp --help            # confirm it is on PATH
```

Then install the extension — from a `.vsix`, or by linking it (below) — and
open a `.pol` file. Nothing to configure.

### From this repository

```console
$ ./install.sh
```

That fetches the extension's dependencies, links the extension into every VS
Code extensions directory it finds, and **verifies the server answers a
handshake** — so a success message means it works, not merely that it
installed. With no `pol-lsp` yet it warns and installs anyway: the server is
resolved when the extension activates, so installing pol afterwards is a
perfectly good order to do things in.

Dropped inside a checkout of [pol](https://github.com/sajonaro/pol) instead —
as `tooling/vscode/` — the same script builds the server from source first, and
that build wins over any installed one. That is what you want while changing
the language itself.

Then reload the window (<kbd>Ctrl+Shift+P</kbd> → *Developer: Reload Window*).
VS Code only scans its extensions directory at startup, which is the one step a
script cannot do for you.

Re-running is safe. To remove it:

```console
$ ./install.sh --uninstall
```

The install is a **symlink** into the extensions directory, so editing this repo
updates the extension with no reinstall — and moving or deleting the clone
breaks it, which is the trade.

### Requirements

`npm`, for `vscode-languageclient`. Everything else is the server, which comes
from [pol](https://github.com/sajonaro/pol) — this repository contains no OCaml
and builds nothing.

### Packaging it instead

```console
$ npm install
$ npx @vscode/vsce package
$ code --install-extension pol-0.1.0.vsix
```

Or open `tooling/vscode/` in VS Code and press <kbd>F5</kbd> for an Extension
Development Host.

## The setting

**`pol.serverPath`** — default
`_build/default/tooling/lsp/bin/pol_lsp.exe`.

- A **relative** path is resolved against each open workspace folder, so the
  default finds a checkout's own build with nobody editing a setting.
- If no workspace folder has it, **`pol-lsp` is looked up on `PATH`** — which is
  what `opam install pol` and the release tarball provide, and is how this
  extension works with no checkout at all.
- An **absolute** path is used exactly as given and nothing else is tried: if
  you name a server, you mean that server.

If none exists, the extension says so and names what it looked for. Silence
would be worse — a server that starts and answers nothing looks identical to a
broken one, and is much harder to chase.

## It restarts itself when the server changes

`make build` writes a *new* file over the server; a process already running
keeps the old one. Without this the editor goes on answering with a language one
build out of date, and the symptom is a squiggle on code the CLI accepts — at
its most confusing exactly when you are changing the language.

The client watches the binary and restarts on its own. **View → Output → "Pol
Language Server"** shows which server it launched, and says so when it swaps:

```
[client] server: /home/you/pol/_build/default/tooling/lsp/bin/pol_lsp.exe
[client] server binary changed on disk — restarting (…)
[client] server restarted; diagnostics are from the current build
```

## If something looks wrong

- **A diagnostic you disagree with** — `pol check` is the authority; same code,
  no process to go stale. If they differ, the server is stale, and the output
  channel above shows whether it restarted.
- **No diagnostics at all** — check that channel for which server was launched,
  or whether the extension reported finding none.
- **A `(load …)` resolving to the wrong file** — `POL_TRACE_LOADS=1 pol check
  FILE` prints what each load actually resolved to. A `stdlib.pol` sitting
  beside your model replaces the installed one, by design and silently.

## Development

`extension.js` is the whole client, and there is no compile step: every LSP
request is answered by the OCaml server, so a build pipeline would exist to
typecheck sixty lines of glue.

Two behaviours have tests, because both fail **silently** when broken:

```console
$ node test-watcher.js    # the restart-on-rebuild watcher
$ node test-resolve.js    # where the server is looked for
```

Both run as a fitness gate in the pol repository. `vscode` and `vscode-languageclient` are stubbed at
the module loader, so neither needs an editor.

## License

Copyright (C) 2026 Alex Kunich. **GNU Affero General Public License, version 3
or later** — the same as [pol](https://github.com/sajonaro/pol) itself. See
[LICENSE](LICENSE).
