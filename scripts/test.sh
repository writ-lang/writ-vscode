#!/bin/sh
# Copyright (C) 2026 Alex Kunich
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Every test, in plain node. No runner and nothing to install: this repository's
# one dependency is vscode-languageclient, and a test framework would be the
# second — for four files that each print a line.
set -e
cd "$(dirname "$0")/.."

failed=0
for t in test/*.test.js; do
  node "$t" || failed=1
done

# The version is not a test file, but it is checked the same way and by the same
# people at the same moment.
scripts/version.sh >/dev/null || failed=1

[ "$failed" = 0 ] || { echo; echo "some checks FAILED" >&2; exit 1; }
