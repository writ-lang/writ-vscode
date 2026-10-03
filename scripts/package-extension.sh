#!/bin/sh
# Copyright (C) 2026 Alex Kunich
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Build the .vsix. Needs @vscode/vsce, which npx will fetch.
#
#   scripts/package-extension.sh
#
# The version is CHECKED first, not assumed. A .vsix is named after the version
# in the manifest and installs under an id built from it, so packaging with the
# copies out of step produces an artifact that is wrong in its filename and in
# where VS Code files it — and neither is visible until someone has both
# installed. scripts/version.sh is the check; this is the one place that cannot
# skip it.
set -e
cd "$(dirname "$0")/.."

command -v npx >/dev/null 2>&1 || { echo "npx is not installed" >&2; exit 1; }

scripts/version.sh >/dev/null || {
  echo "the version is inconsistent — see scripts/version.sh" >&2
  exit 1
}
version=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' package.json)

# The dependencies are SHIPPED: vscode-languageclient is the one thing this
# extension does not get from the engine, and a .vsix without node_modules
# activates to a module-not-found.
if [ ! -d node_modules/vscode-languageclient ]; then
  echo "==> installing dependencies"
  if [ -f package-lock.json ]; then
    npm ci --no-audit --no-fund
  else
    npm install --no-audit --no-fund
  fi
fi

npx --yes @vscode/vsce package --out "writ-$version.vsix"

echo
echo "built writ-$version.vsix"
echo "install it with: code --install-extension writ-$version.vsix"
echo
echo "it needs a writ-lsp to talk to; see scripts/version.sh for whether this"
echo "version matches the engine beside it."
