# Writ language support for VS Code

<img src="docs/images/writ-mark-200.png" alt="writ" width="120" align="left" hspace="16" vspace="4">

*The editor client for [writ](https://github.com/writ-lang/writ). The language,
the checker and the language server live there; this repository is the VS Code
front end and nothing else.*

Editor support for **Writ** — *Partial Olog*, an abstract language for modelling
real-world domains — over all three of its file types:

| | |
| --- | --- |
| `.writ` | models and libraries — schema, instance, transitions |
| `.claims` | the questions asked of a model, kept as their own document |
| `.rules` | Datalog-style derivations over a model's situation space |

Syntax highlighting, plus everything the language's own server provides:
diagnostics from the real parser and type-checker, a document outline, hover
and completion — and the verbs, from a panel in the Activity Bar.

**The extension does not bundle a server and does not download one.** The point
of an OCaml server is that the editor and the checker are the *same code*, so a
diagnostic in the editor is one `writ check` would give you. It talks to a
`writ-lsp` you already have.

## The panel

Click the writ mark in the Activity Bar, or run **Writ: Open the Writ Panel**
from the Command Palette — the icon can end up unpinned, and then the palette is
the way in.

It shows two things, and both are there because they are otherwise invisible.

**Which writ you are actually talking to.** The extension and the engine are
separate installs; the panel prints both versions, the server's path, and
whether the two are in step. Every way that can be wrong produces the *same*
symptom — an editor that highlights and says nothing else — and the causes want
different fixes:

| what it says | what happened | the button |
| --- | --- | --- |
| no language server | nothing was found at any candidate path | build, or update writ |
| older than `core/…` | the checkout has been edited since it was built | build the engine |
| the engine is *x*, the extension is *y* | one of the two was installed on its own | build, or update writ |
| the server did not say which writ it is | a writ from before the server reported one | update writ |

The stale case is the one nothing else catches. writ's version only moves when
someone bumps it, so a build from before this morning's edit reports exactly the
same version as a current one — the two agree, and the agreement is the
misleading part. The panel compares *times*, and offers the build.

**The verbs**, which the extension used to expose none of:

| | |
| --- | --- |
| Check this file | `writ check`, with the sibling `.claims` attached if there is one. From a `.claims` file the roles swap and the model becomes the argument. <kbd>Ctrl+K</kbd> <kbd>Ctrl+Enter</kbd>, or the ▷ in the editor title bar. |
| Show a situation… | `writ show --at N` |
| Answer a relation… | `writ derive`, over a `.rules` file — prefix the question with `why ` for the derivation tree |
| Compare with another model… | `writ compare` against a model you pick |

Each runs in a terminal, and each runs the `writ` belonging to *the same install
as the language server* — never whatever is first on `PATH`. An editor whose
"check this file" disagreed with its own squiggles would be worse than having no
command at all.

## Install

Two routes. The extension tries them in this order.

### With writ installed, and no checkout

The ordinary case. The extension needs `writ-lsp` on your `PATH`:

```console
$ opam pin add writ git+https://github.com/writ-lang/writ.git   # or unpack a release tarball
$ command -v writ-lsp                                          # confirm it is on PATH
/home/you/.opam/default/bin/writ-lsp
```

`writ` is not in opam-repository, so there is no `opam install writ` to run — the
pin is the no-checkout route, and opam does the cloning. The other ways to get
one (a release tarball, `make install-writ` from a checkout) are in
[writ's README](https://github.com/writ-lang/writ#install); any of them puts
`writ-lsp` on your `PATH`, which is all this extension needs.

Then install the extension — from a `.vsix`, or by linking it (below) — and
open a `.writ` file. Nothing to configure.

### From this repository

```console
$ ./install.sh
```

That fetches the extension's dependencies, links the extension into every VS
Code extensions directory it finds, and **verifies the server answers a
handshake** — so a success message means it works, not merely that it
installed. With no `writ-lsp` yet it warns and installs anyway: the server is
resolved when the extension activates, so installing writ afterwards is a
perfectly good order to do things in.

Given a checkout of [writ](https://github.com/writ-lang/writ) instead, the same
script builds the server from source first, and that build wins over any
installed one — which is what you want while changing the language itself. It
finds the checkout whether this extension sits *inside* it (as `tooling/vscode/`,
where it began) or *beside* it, the layout the split into two repositories
gives you:

```
projects/
  writ/          ← the engine; the server is built here
  writ-vscode/   ← this extension
```

Open the directory holding both and the extension still finds that build: it
looks in each workspace folder and in the checkouts one level below it. If your
checkouts are somewhere else entirely, point `WRIT_REPO` at the engine when
installing, or set `writ.serverPath` to an absolute path.

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
from [writ](https://github.com/writ-lang/writ) — this repository contains no OCaml
and builds nothing.

### Packaging it instead

```console
$ scripts/package-extension.sh
$ code --install-extension writ-0.1.0.vsix
```

That fetches the dependencies if they are missing and **checks the version
first**: a `.vsix` is named after the version in the manifest and installs under
an id built from it, so packaging with the copies out of step produces an
artifact that is wrong in its filename *and* in where VS Code files it — and
neither is visible until someone has two of them installed.

Or open this repository in VS Code and press <kbd>F5</kbd> for an Extension
Development Host.

## The setting

**`writ.serverPath`** — default
`_build/default/tooling/lsp/bin/writ_lsp.exe`.

- A **relative** path is resolved against each open workspace folder, so the
  default finds a checkout's own build with nobody editing a setting.
- If no workspace folder has it, **`writ-lsp` is looked up on `PATH`** — which is
  what an opam pin or a release tarball provides, and is how this extension
  works with no checkout at all.
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

The client watches the binary and restarts on its own. **View → Output → "Writ
Language Server"** shows which server it launched, and says so when it swaps:

```
[client] server: /home/you/writ/_build/default/tooling/lsp/bin/writ_lsp.exe
[client] server binary changed on disk — restarting (…)
[client] server restarted; diagnostics are from the current build
```

## If something looks wrong

- **A diagnostic you disagree with** — `writ check` is the authority; same code,
  no process to go stale. If they differ, the server is stale, and the output
  channel above shows whether it restarted.
- **No diagnostics at all** — check that channel for which server was launched,
  or whether the extension reported finding none.
- **A `(load …)` resolving to the wrong file** — `WRIT_TRACE_LOADS=1 writ check
  FILE` prints what each load actually resolved to. A `stdlib.writ` sitting
  beside your model replaces the installed one, by design and silently.

## Development

There is no compile step: every LSP request is answered by the OCaml server, so
a build pipeline would exist to typecheck glue. What the glue has instead is
structure — `extension.js` is the wiring, and one module per concern under
`src/`:

| | |
| --- | --- |
| `locate.js` | where the engine is: the candidate order, the checkout a server came from, and the `writ` belonging to it |
| `watcher.js` | restart when the server binary is replaced |
| `staleness.js` | is the built server older than the sources it was built from |
| `engine.js` | what engine this editor is talking to, and the verdict on it |
| `panel.js` | the Activity Bar view |
| `commands.js` | the verbs |

Only `extension.js` and each module's `register` touch the `vscode` API. The
rest is plain JavaScript that runs under node — which is what the tests
exercise, with nothing stubbed and nothing installed:

```console
$ scripts/test.sh
```

Four files, and each one is there because its subject fails **silently**:

| | |
| --- | --- |
| `test/watcher.test.js` | a watcher that never fires looks exactly like a server that is up to date |
| `test/resolve.test.js` | the wrong candidate order means "no language server" on a machine that has one |
| `test/status.test.js` | the verdict is shown to users as a warning; getting it wrong means telling someone with a good install that it is broken |
| `test/manifest.test.js` | nothing typechecks `package.json` — a command contributed but not registered appears in the palette and does nothing |

### The version

The extension and the engine are released together and live in separate
repositories, so nothing structural keeps them in step — and the panel now
*shows* a mismatch to the user, which makes a version that is merely forgotten
into a warning on somebody's working install.

```console
$ scripts/version.sh              # print them, and fail if they disagree
$ scripts/version.sh 0.2.0        # set them
$ scripts/version.sh --from-writ  # set them to what a writ checkout says
```

It reads writ's own version from the `dune-project` of a checkout beside this
one, or of `$WRIT_REPO`. `install.sh` derives its extension id from the manifest
rather than holding a copy, so the only two places left are `package.json` and
the `.vsix` filename in this file.

## License

Copyright (C) 2026 Alex Kunich. **GNU Affero General Public License, version 3
or later** — the same as [writ](https://github.com/writ-lang/writ) itself. See
[LICENSE](LICENSE).
