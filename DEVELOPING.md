# Working on the Writ extension

This is for people changing the extension. To use it, the [README](README.md) is enough; to send a patch, see [CONTRIBUTING.md](CONTRIBUTING.md) first.

There is no compile step: every LSP request is answered by the OCaml server, so
a build pipeline would exist to typecheck glue. What the glue has instead is
structure — `extension.js` is the wiring, and one module per concern under
`src/`:

| | |
| --- | --- |
| `locate.js` | where the engine is: the candidate order, the checkout a server came from, and the `writ` belonging to it |
| `download.js` | fetching a released writ into the extension's storage: which tarball, the checksum, the unpack |
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

Six files, and each one is there because its subject fails **silently**:

| | |
| --- | --- |
| `test/watcher.test.js` | a watcher that never fires looks exactly like a server that is up to date |
| `test/resolve.test.js` | the wrong candidate order means "no language server" on a machine that has one |
| `test/status.test.js` | the verdict is shown to users as a warning; getting it wrong means telling someone with a good install that it is broken |
| `test/manifest.test.js` | nothing typechecks `package.json` — a command contributed but not registered appears in the palette and does nothing |
| `test/engine.test.js` | the engine is a separate install — a capability `writ-lsp` stops advertising, or a flag the CLI renames, leaves the extension running and doing nothing. It drives the real server and runs each command line the verbs build; with no `writ-lsp` on PATH it skips, and `WRIT_E2E_REQUIRED=1` makes that a failure |
| `test/download.test.js` | the wrong tarball name is a 404 that reads like an outage, a download ranked ahead of PATH overrides a writ installed on purpose, and a download button shown to someone with `writ-lsp` on PATH fetches an engine that never runs. `WRIT_DOWNLOAD_LIVE=1` also downloads the real release and runs it |

## The version

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
the `.vsix` filename in the README.

