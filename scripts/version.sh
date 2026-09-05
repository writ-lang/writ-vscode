#!/bin/sh
# Copyright (C) 2026 Alex Kunich
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The version, in the two places here that have to agree — and against the
# engine, which is the version that decides.
#
#   scripts/version.sh              print them, and fail if they disagree
#   scripts/version.sh 0.2.0        set them
#   scripts/version.sh --from-writ  set them to what a writ checkout says
#
# WHY THIS EXISTS. The extension and the engine ship together and are separate
# repositories, so nothing structural keeps them in step: writ's version lives
# in its dune-project and is generated into the binary and the opam package,
# while this repository writes it into package.json by hand.
#
# install.sh used to hold a third copy, as the extension id — the one nobody
# thinks of at bump time, and the one with teeth: install under a stale id and
# the new extension lands BESIDE the old one, both manifests valid, and VS Code
# loads whichever it scans first. It now reads the manifest instead, which is
# why it is not listed below. The README's .vsix filename cannot be derived the
# same way, so it stays here.
#
# The panel compares the extension's version against the engine's at runtime and
# reports a mismatch to the user, which is what makes this worth enforcing here:
# a version that is wrong is not a cosmetic problem any more, it is a warning
# shown to someone whose install is fine.
set -e
cd "$(dirname "$0")/.."

pkg=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' package.json)
doc=$(sed -n 's/.*code --install-extension writ-\(.*\)\.vsix.*/\1/p' README.md)

# The engine's version, if a checkout is at hand. Read from dune-project rather
# than by running the binary: this must work in a checkout that has not been
# built, and dune-project is the source `writ --version` is generated from.
writ_version() {
  for cand in "${WRIT_REPO:-}" ../writ ..; do
    [ -n "$cand" ] && [ -f "$cand/dune-project" ] || continue
    sed -n 's/^(version \(.*\))$/\1/p' "$cand/dune-project" | head -1
    return
  done
}

set_all() {
  sed -i "s/^  \"version\": \".*\",$/  \"version\": \"$1\",/" package.json
  sed -i "s/code --install-extension writ-.*\.vsix/code --install-extension writ-$1.vsix/" README.md
}

if [ "${1:-}" = "--from-writ" ]; then
  engine=$(writ_version)
  [ -n "$engine" ] || {
    echo "no writ checkout found — set WRIT_REPO, or pass the version" >&2
    exit 1
  }
  set_all "$engine"
  echo "$pkg -> $engine (from the engine)"
  exit 0
fi

if [ -n "${1:-}" ]; then
  set_all "$1"
  echo "$pkg -> $1"
  exit 0
fi

printf 'package.json   %s\n' "$pkg"
printf 'README.md      %s\n' "$doc"

engine=$(writ_version)
if [ -n "$engine" ]; then
  printf 'writ           %s   (the engine, from its dune-project)\n' "$engine"
else
  printf 'writ           —   (no checkout beside this one; set WRIT_REPO to compare)\n'
fi

if [ "$pkg" != "$doc" ]; then
  echo "they disagree; run: scripts/version.sh $pkg" >&2
  exit 1
fi

# A version behind the engine is a real state — the extension is released when
# it changes, and it does not change every time writ does — so this is reported
# and not failed. What is failed above is the copies here contradicting each
# other, which is never anything but a mistake.
if [ -n "$engine" ] && [ "$pkg" != "$engine" ]; then
  echo "note: the extension is $pkg and the engine is $engine." >&2
  echo "      the panel will show that as a mismatch to anyone with both." >&2
  echo "      run: scripts/version.sh --from-writ" >&2
fi
