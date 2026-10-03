// Copyright (C) 2026 Alex Kunich
// SPDX-License-Identifier: AGPL-3.0-or-later

// Fetch a released writ into the extension's own storage, so a user with no
// opam and no checkout gets a working editor from one button.
//
// The release tarball is the unit, not a lone `writ-lsp`. It carries the
// server, the `writ` the verbs run, and the standard library at
// share/writ/lib, which is where the resolver looks relative to the binary. So
// once unpacked, locate.cliFor finds the CLI beside the server and
// `(load "stdlib.writ")` resolves, with nothing configured.
//
// WHICH RELEASE. The extension and the engine are released together, so the
// one to fetch is the tag matching this extension's version. When that tag has
// no release, the latest release is used and the panel's version verdict says
// so. A newer engine is a better answer than no engine.
//
// VERIFIED BEFORE IT RUNS. Every tarball ships with a .sha256 beside it, and a
// download whose bytes do not match is deleted rather than unpacked.
//
// Plain node: no `vscode` here, so every part except the network is checked
// under node by test/download.test.js.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

const REPO = "writ-lang/writ";

// node's platform/arch to the names `make release` gives its tarballs
// (`uname -s | tr A-Z a-z` and `uname -m`). Only what is published is listed:
// a platform missing here has no tarball, and the caller says so rather than
// trying a URL that cannot exist.
const PLATFORMS = {
  "linux-x64": { os: "linux", arch: "x86_64" },
  "linux-arm64": { os: "linux", arch: "aarch64" },
};

function platformOf(platform = process.platform, arch = process.arch) {
  return PLATFORMS[`${platform}-${arch}`] || null;
}

// The tarball's base name, which is also the directory it unpacks to.
function assetBase(version, plat) {
  return `writ-${version}-${plat.os}-${plat.arch}`;
}

function assetUrl(tag, file) {
  return `https://github.com/${REPO}/releases/download/${tag}/${file}`;
}

// A .sha256 file is `HEX  NAME`, as sha256sum writes it.
function parseChecksum(text) {
  const m = /^([0-9a-f]{64})\b/i.exec(String(text).trim());
  return m ? m[1].toLowerCase() : null;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

// Released engines already unpacked under `storage`, newest first. A
// directory counts only when its server is actually there: an interrupted
// unpack is not an install.
function installed(storage) {
  let entries;
  try {
    entries = fs.readdirSync(storage, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && /^writ-\d/.test(e.name))
    .map((e) => ({
      version: e.name.replace(/^writ-/, "").replace(/-[a-z]+-[a-z0-9_]+$/, ""),
      server: path.join(storage, e.name, "bin", "writ-lsp"),
    }))
    .filter((x) => fs.existsSync(x.server))
    .sort((a, b) => compareVersions(b.version, a.version));
}

function compareVersions(a, b) {
  const pa = a.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

// ── the network ─────────────────────────────────────────────────────────────

async function exists(url) {
  const r = await fetch(url, { method: "HEAD", redirect: "follow" });
  return r.ok;
}

// The tag to fetch: this extension's own version if it was released, else the
// latest release. Returns { tag, version }.
async function chooseRelease(wanted, plat) {
  const tag = `v${wanted}`;
  if (await exists(assetUrl(tag, assetBase(wanted, plat) + ".tar.gz")))
    return { tag, version: wanted };
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!r.ok) throw new Error(`could not ask GitHub for the latest release (${r.status})`);
  const latest = (await r.json()).tag_name;
  return { tag: latest, version: latest.replace(/^v/, "") };
}

async function fetchTo(url, file) {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}

function untar(archive, into) {
  return new Promise((resolve, reject) =>
    execFile("tar", ["xzf", archive, "-C", into], (e, _out, err) =>
      e ? reject(new Error(`tar: ${String(err).trim() || e.message}`)) : resolve()
    )
  );
}

// Download, verify and unpack a release into `storage`. Returns
// { version, server }. `say` reports progress in a few words.
async function download({ storage, wanted, say = () => {} }) {
  const plat = platformOf();
  if (!plat)
    throw new Error(
      `no released writ for ${process.platform}-${process.arch}; ` +
        "install it with opam instead"
    );
  say("finding the release");
  const { tag, version } = await chooseRelease(wanted, plat);
  const base = assetBase(version, plat);
  const final = path.join(storage, base);
  const server = path.join(final, "bin", "writ-lsp");
  if (fs.existsSync(server)) return { version, server };

  fs.mkdirSync(storage, { recursive: true });
  // Unpacked INSIDE storage so the last step is a rename on one filesystem,
  // which is atomic. A dot-name is never mistaken for an install by
  // [installed].
  const work = fs.mkdtempSync(path.join(storage, ".download-"));
  try {
    const tarball = path.join(work, base + ".tar.gz");
    say(`downloading writ ${version}`);
    await fetchTo(assetUrl(tag, base + ".tar.gz"), tarball);
    await fetchTo(assetUrl(tag, base + ".tar.gz.sha256"), tarball + ".sha256");

    say("verifying the checksum");
    const want = parseChecksum(fs.readFileSync(tarball + ".sha256", "utf8"));
    const got = sha256(tarball);
    if (!want || want !== got)
      throw new Error(`checksum mismatch for ${base}.tar.gz: expected ${want}, got ${got}`);

    say("unpacking");
    await untar(tarball, work);
    const unpacked = path.join(work, base);
    if (!fs.existsSync(path.join(unpacked, "bin", "writ-lsp")))
      throw new Error(`${base}.tar.gz has no bin/writ-lsp`);
    for (const exe of ["writ", "writ-lsp", "writ-mcp"]) {
      const p = path.join(unpacked, "bin", exe);
      if (fs.existsSync(p)) fs.chmodSync(p, 0o755);
    }
    // Into place in one step, so `installed` never sees half an engine.
    fs.rmSync(final, { recursive: true, force: true });
    fs.renameSync(unpacked, final);
    return { version, server };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = {
  REPO,
  platformOf,
  assetBase,
  assetUrl,
  parseChecksum,
  sha256,
  installed,
  compareVersions,
  chooseRelease,
  download,
};
