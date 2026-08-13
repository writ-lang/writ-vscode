#!/usr/bin/env bash
# Copyright (C) 2026 Alex Kunich
# SPDX-License-Identifier: AGPL-3.0-or-later
# Install the .writ language support into VS Code.
#
#   ./install.sh              # build, install, verify
#   ./install.sh --uninstall  # remove it again
#
# Safe to re-run. Installs as a symlink into every VS Code extensions directory
# it finds, so editing this repo updates the extension with no reinstall.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ext_id="writ.writ-0.1.0"

# Extension ids this extension has been installed under BEFORE. The project was
# called `pol` (Partial Olog) and the extension `pol.pol`; see "rename: pol
# becomes writ". Kept so the rename can be migrated rather than left behind —
# purge_legacy below is the only thing that ever cleans these up.
legacy_globs=("pol.pol-*")

# WHERE THE ENGINE IS. This script ships with the extension, and the extension is
# usable three ways, so the answer is looked up rather than assumed:
#
#   1. $WRIT_REPO             — set it to say exactly which checkout to build.
#   2. $here/../..            — the extension living INSIDE a writ checkout, at
#                               tooling/vscode/, which is where it started.
#   3. $here/../writ          — the extension as its OWN repository, checked out
#                               beside the engine. This is what the split into
#                               writ/ and writ-vscode/ actually produces, and
#                               looking only at `../..` missed it entirely: two
#                               levels up from a sibling checkout is the
#                               directory that CONTAINS both, never the engine.
#   4. no checkout at all     — writ installed by opam pin or release tarball,
#                               where `writ-lsp` on PATH is the only server.
#
# Identified by the engine's own files, not by name, so a checkout in a directory
# called something else is still found.
is_repo() { [ -f "$1/dune-project" ] && [ -d "$1/core/stdlib" ]; }

repo=""
for cand in "${WRIT_REPO:-}" "$here/../.." "$here/../writ"; do
  [ -n "$cand" ] && [ -d "$cand" ] || continue
  cand=$(cd "$cand" && pwd)
  if is_repo "$cand"; then repo="$cand"; break; fi
done

if [ -n "$repo" ]; then
  in_checkout=yes
  server="$repo/_build/default/tooling/lsp/bin/writ_lsp.exe"
else
  in_checkout=no
  server=$(command -v writ-lsp 2>/dev/null || true)
fi

say()  { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# Every VS Code flavour keeps extensions somewhere different, and a Remote/WSL
# window reads .vscode-server rather than .vscode. Install into all that exist
# so the script does not have to guess which window you will open.
find_extension_dirs() {
  local found=()
  for d in "$HOME/.vscode/extensions" \
           "$HOME/.vscode-server/extensions" \
           "$HOME/.vscode-insiders/extensions" \
           "$HOME/.vscode-server-insiders/extensions" \
           "$HOME/.cursor/extensions" \
           "$HOME/.vscodium/extensions"; do
    [ -d "$d" ] && found+=("$d")
  done
  printf '%s\n' "${found[@]:-}"
}

mapfile -t ext_dirs < <(find_extension_dirs)
[ -n "${ext_dirs[0]:-}" ] || die "no VS Code extensions directory found.
Open this folder in VS Code once (which creates it), then re-run this script."

# Remove an install made under a name this extension no longer uses.
#
# WHY THIS EXISTS. An install from before the rename is a symlink named
# `pol.pol-0.1.0` pointing at a directory the rename took away. VS Code scans the
# extensions directory, cannot read a manifest through a dangling link, and
# reports "invalid extensions detected", naming `pol` — an extension the user
# CANNOT remove from the UI, because there is nothing behind it to uninstall.
# The marketplace pane then offers to "Install Locally" a ghost. Nothing in the
# renamed script removed it, so every pre-rename install stayed broken and
# visible. Run on install as well as uninstall: the person hitting this is
# installing the new extension, not uninstalling an old one they forgot about.
#
# `-e` is false for a dangling symlink, which is exactly the case to clean, so
# the test is `-e OR -L` and the removal is `rm -rf` on the link itself — never
# through it, which would delete a live checkout.
purge_legacy() {
  local d g p
  for d in "${ext_dirs[@]}"; do
    for g in "${legacy_globs[@]}"; do
      for p in "$d"/$g; do
        [ -e "$p" ] || [ -L "$p" ] || continue
        rm -rf "$p"
        say "removed a pre-rename install: $p"
      done
    done
  done
  # VS Code also keeps a registry, and an entry there outlives the directory —
  # it is what re-reports the extension as invalid. Only its own CLI can edit it
  # safely, so ask, and stay quiet when the entry is already gone.
  if command -v code >/dev/null 2>&1; then
    local id
    for g in "${legacy_globs[@]}"; do
      id="${g%-*}"
      if code --list-extensions 2>/dev/null | grep -qx "$id"; then
        code --uninstall-extension "$id" >/dev/null 2>&1 && \
          say "deregistered $id from VS Code"
      fi
    done
  fi
}

# ---------------------------------------------------------------- uninstall --
if [ "${1:-}" = "--uninstall" ]; then
  purge_legacy
  for d in "${ext_dirs[@]}"; do
    if [ -e "$d/$ext_id" ] || [ -L "$d/$ext_id" ]; then
      rm -rf "$d/$ext_id"
      say "removed $d/$ext_id"
    fi
  done
  say "done — reload your VS Code window to finish."
  exit 0
fi

purge_legacy

# -------------------------------------------------------------------- build --
if [ "$in_checkout" = yes ]; then
  say "building the language server"
  "$repo/scripts/with-ocaml.sh" dune build --root "$repo" 2>&1 | sed 's/^/    /' || \
    die "the build failed — fix that first, the extension is useless without the server."
  [ -x "$server" ] || die "build reported success but $server is missing."
else
  # Nothing to build: there is no engine here. But refusing to install would be
  # wrong too — the client resolves the server at activation, so an install now
  # and installing writ later is a legitimate order to do things in.
  if [ -n "$server" ] && [ -x "$server" ]; then
    say "using the installed server at $server"
  else
    warn "no \`writ-lsp\` on PATH — installing the client anyway, but it will have
    nothing to talk to until writ is installed (\`opam pin add writ\`, or a release
    tarball). Syntax highlighting works regardless; diagnostics will not."
  fi
fi

# ------------------------------------------------------------ dependencies --
command -v npm >/dev/null 2>&1 || die "npm is required to install the extension's
dependencies (vscode-languageclient). Install Node.js, then re-run."

say "installing extension dependencies"
if [ -f "$here/package-lock.json" ]; then
  (cd "$here" && npm ci --no-audit --no-fund 2>&1 | sed 's/^/    /')
else
  (cd "$here" && npm install --no-audit --no-fund 2>&1 | sed 's/^/    /')
fi

# ------------------------------------------------------------------ install --
for d in "${ext_dirs[@]}"; do
  rm -rf "$d/$ext_id"
  ln -s "$here" "$d/$ext_id"
  say "linked into $d"
done

# ------------------------------------------------------------------- verify --
# Prove the server actually answers, rather than trusting that it built. A
# handshake here is the difference between "installed" and "works".
#
# Skipped, not attempted, when there is no server: the no-checkout path above
# already said why, and piping into an empty command name would report a shell
# error about "" instead of the thing that is actually true.
if [ -n "$server" ] && [ -x "$server" ]; then
  say "verifying the server responds"
  init='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"processId":null,"rootUri":null,"capabilities":{}}}'
  exit_msg='{"jsonrpc":"2.0","method":"exit"}'
  reply=$(printf 'Content-Length: %d\r\n\r\n%sContent-Length: %d\r\n\r\n%s' \
            "${#init}" "$init" "${#exit_msg}" "$exit_msg" \
          | "$server" 2>/dev/null | tr -d '\r' || true)

  case "$reply" in
    *documentSymbolProvider*completionProvider*|*completionProvider*documentSymbolProvider*)
      say "server answered with its capabilities" ;;
    *)
      warn "the server did not answer a handshake as expected. The extension is
    installed, but check: $server" ;;
  esac
fi

cat <<EOF

$(say "installed")

  Last step, which this script cannot do for you:
    Reload the window — Ctrl+Shift+P → "Developer: Reload Window"
    VS Code only scans its extensions directory at startup.

  Then open any tests/models/*.writ file. To confirm the server is live, change a
  value to something outside its declared domain and watch it get underlined.

  If nothing happens, check View → Output → "Writ Language Server".
  If your workspace root is not this repo, set "writ.serverPath" to:
    $server

  Uninstall with: $0 --uninstall
EOF
