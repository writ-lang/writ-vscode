// Copyright (C) 2026 Alex Kunich
// SPDX-License-Identifier: AGPL-3.0-or-later

// What the test files share: counting, and a name for a failure.
//
// Deliberately not a framework. Each file is `node test/NAME.test.js` and
// nothing has to be installed to run one — which matters because this
// repository's only dependency is vscode-languageclient, and a test runner
// would be the second.

function suite(label) {
  let failed = 0;
  let passed = 0;
  return {
    check(name, cond) {
      if (cond) passed++;
      else {
        console.log(`FAIL: ${name}`);
        failed++;
      }
    },
    done() {
      console.log(
        failed === 0
          ? `${label}: ${passed} checks passed`
          : `${label}: ${failed} FAILED of ${failed + passed}`
      );
      process.exit(failed === 0 ? 0 : 1);
    },
  };
}

module.exports = { suite };
