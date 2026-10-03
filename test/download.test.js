// Copyright (C) 2026 Alex Kunich
// SPDX-License-Identifier: AGPL-3.0-or-later

// The one-click download: which tarball, how it is checked, where the result
// sits in the search order, and when the panel offers it.
//
// Each of these fails quietly. The wrong tarball name is a 404 that reads like
// "GitHub is down". A checksum that is parsed wrong either refuses every
// download or accepts any. A downloaded engine placed AHEAD of PATH would
// silently override a writ someone installed on purpose, and a download button
// shown to someone whose writ-lsp is on PATH would fetch an engine that never
// runs.
//
// No network by default. WRIT_DOWNLOAD_LIVE=1 also downloads the real release
// into a temporary directory and runs it.
//
// Run: node test/download.test.js

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { suite } = require("./harness");
const d = require("../src/download");
const locate = require("../src/locate");
const panel = require("../src/panel");

const { check, done } = suite("download tests");

// ── which tarball ────────────────────────────────────────────────────────────
// The names `make release` gives: uname's spelling, not node's.
check("linux x64 is x86_64", d.platformOf("linux", "x64")?.arch === "x86_64");
check("linux arm64 is aarch64", d.platformOf("linux", "arm64")?.arch === "aarch64");
check("macOS has no tarball yet", d.platformOf("darwin", "arm64") === null);
check("nor does Windows", d.platformOf("win32", "x64") === null);
const plat = d.platformOf("linux", "x64");
check(
  "the asset is named as the release names it",
  d.assetBase("0.2.0", plat) === "writ-0.2.0-linux-x86_64"
);
check(
  "and is fetched from the tag's release",
  d.assetUrl("v0.2.0", "writ-0.2.0-linux-x86_64.tar.gz") ===
    "https://github.com/writ-lang/writ/releases/download/v0.2.0/writ-0.2.0-linux-x86_64.tar.gz"
);

// ── the checksum ─────────────────────────────────────────────────────────────
const hex = "ab".repeat(32);
check("a sha256sum line parses", d.parseChecksum(`${hex}  writ.tar.gz\n`) === hex);
check("upper case is normalised", d.parseChecksum(hex.toUpperCase() + "  x") === hex);
check("a short hash is refused", d.parseChecksum("abc  writ.tar.gz") === null);
check("so is an empty file", d.parseChecksum("") === null);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "writ-dl-test-"));
fs.writeFileSync(path.join(tmp, "f"), "writ");
// `printf writ | sha256sum`
check(
  "sha256 of a file is the known digest",
  d.sha256(path.join(tmp, "f")) ===
    "bd998adfd46eaff944ee5125a9ffaff2ecbf67d11ee8a2a3d2afd0946bc8adbb"
);

// ── what is installed ────────────────────────────────────────────────────────
const storage = path.join(tmp, "storage");
const fake = (dir) => {
  fs.mkdirSync(path.join(storage, dir, "bin"), { recursive: true });
  fs.writeFileSync(path.join(storage, dir, "bin", "writ-lsp"), "");
};
fake("writ-0.2.0-linux-x86_64");
fake("writ-0.10.0-linux-x86_64");
fs.mkdirSync(path.join(storage, "writ-0.3.0-linux-x86_64"), { recursive: true }); // interrupted
fs.mkdirSync(path.join(storage, ".download-abc", "bin"), { recursive: true }); // in progress
const found = d.installed(storage);
check("only complete installs count", found.length === 2);
check(
  "newest first, compared as numbers (0.10 after 0.2)",
  found[0] && found[0].version === "0.10.0" && found[1].version === "0.2.0"
);
check("a missing storage directory is no installs", d.installed(path.join(tmp, "none")).length === 0);

// ── where a download sits in the search order ───────────────────────────────
const dl = ["/s/writ-0.2.0-linux-x86_64/bin/writ-lsp"];
const order = locate.candidates(locate.DEFAULT_SERVER, ["/w/writ"], dl);
const onPath = locate.onPath(locate.INSTALLED);
check("a download is the LAST candidate", order[order.length - 1] === dl[0]);
check(
  "after every PATH entry, so a hand-installed writ wins",
  order.indexOf(dl[0]) > Math.max(...onPath.map((p) => order.indexOf(p)))
);
check(
  "an absolute setting still means exactly that server",
  locate.candidates("/opt/writ-lsp", ["/w/writ"], dl).join() === "/opt/writ-lsp"
);
check("no downloads changes nothing", locate.candidates(locate.DEFAULT_SERVER, []).length === onPath.length);
check(
  "the CLI of a download is found beside its server",
  (() => {
    const server = path.join(storage, "writ-0.2.0-linux-x86_64", "bin", "writ-lsp");
    fs.writeFileSync(path.join(path.dirname(server), "writ"), "");
    return locate.cliFor(server) === path.join(path.dirname(server), "writ");
  })()
);

// ── when the panel offers it ─────────────────────────────────────────────────
const html = (o) =>
  panel.renderHtml({ extension: "0.2.0", engineVersion: null, checkout: null, stale: null, ...o });
const none = html({ serverPath: null, downloadable: true });
check("no server: the panel offers the download", none.includes('data-cmd="writ.downloadEngine"'));
check("with opam as the second choice", none.includes('data-cmd="writ.update"'));
check(
  "on a platform with no tarball it does not",
  !html({ serverPath: null, downloadable: false }).includes("writ.downloadEngine")
);
const onPathMismatch = html({ serverPath: "/usr/bin/writ-lsp", engineVersion: "0.1.0" });
check(
  "a mismatched writ on PATH is not offered a download it would ignore",
  !onPathMismatch.includes("writ.downloadEngine") && onPathMismatch.includes("writ.update")
);
check(
  "a mismatched download is offered a fresh one",
  html({ serverPath: dl[0], engineVersion: "0.1.0", downloadable: true }).includes(
    "writ.downloadEngine"
  )
);
check(
  "every action button carries the command it runs",
  !/<button id="act"/.test(none)
);

// ── the real thing, on request ───────────────────────────────────────────────
(async () => {
  if (process.env.WRIT_DOWNLOAD_LIVE === "1" && d.platformOf()) {
    const live = path.join(tmp, "live");
    try {
      const got = await d.download({ storage: live, wanted: "0.0.0-unreleased" });
      check("live: the server is unpacked", fs.existsSync(got.server));
      const cli = locate.cliFor(got.server);
      const v = execFileSync(cli, ["--version"], { encoding: "utf8" });
      check("live: its writ runs and reports the version fetched", v.startsWith(`writ ${got.version}`));
      check("live: no work directory is left behind", fs.readdirSync(live).every((n) => !n.startsWith(".")));
    } catch (e) {
      check(`live: download succeeds (${e.message})`, false);
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  done();
})();
