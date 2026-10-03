// Tools the app can borrow, fetched only when something actually needs them.
//
// Reading a Dota item icon or a mod's own texture means decoding Source 2 formats, and the
// program that does that weighs fifty megabytes. Shipping it inside the installer would
// triple its size for a feature most people never touch, so the toolchain is downloaded on
// demand, kept in the app's own folder, and can be deleted from Settings without breaking
// anything that does not need it.
//
// Rules this file exists to enforce:
//   nothing runs that was not pinned - every tool is fetched at a version, from a URL, with
//     a SHA-256 that has to match, so "the download went through a proxy" cannot become "the
//     app now runs somebody else's binary";
//   nothing proprietary - Valve's own vpk.exe is not here and must not be added (see the
//     SignPath terms: a project that bundles it is not open source in their sense). Both
//     tools below are MIT, downloaded rather than bundled, and credited in the README;
//   the pins ship with the release - the version, the URL and the digest are in this file and
//     move only when a release moves them. There used to be a second channel: a config/tools.json
//     on main, read at first use. That file was never published, so every start asked for it and
//     got a 404, and the pins below were used anyway. A channel that never carried anything is
//     not a rollback plan, and an unsigned file that can redirect a fifty megabyte download is
//     not one worth building. Removed 2026-09-16; a new tool version travels with a release.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { downloadFile } from './net.ts';
import { openZip } from './safe-zip.ts';
import { FileTx } from './file-tx.ts';

/** A tool pinned to a version, a URL, and the digest those bytes have to hash to. */
interface Pin { version: string; url: string; sha256: string; bytes: number; exe: string; license: string; project: string }

/** What installed.json records for a tool on disk. */
type Installed = { version: string; exe: string; sha256: string; at: number };

/** How a download is going, for the bar at the bottom of the window. */
export type ToolProgress =
  | { type: 'stage'; label: string; stage: string }
  | { type: 'download'; label: string; loaded: number; total: number }
  | { type: 'done'; label: string }
  | { type: 'error'; label: string; message: string };

/** The only pins there are: what the app was built knowing. */
// Measured again 2026-09-07 for 20.0: the digest comes from GitHub's own release API and was
// confirmed by downloading the file and hashing it, and the archive was opened to check the
// executable is at its root under the name below.
export const BUILT_IN_PINS: Record<string, Pin> = {
  vrf: {
    version: '20.0',
    url: 'https://github.com/ValveResourceFormat/ValveResourceFormat/releases/download/20.0/cli-windows-x64.zip',
    sha256: 'd32ab327b8bbb42a2528866afb03bb582bdb779d0005488da32b90292afd3ff5',
    bytes: 52735867,
    exe: 'Source2Viewer-CLI.exe',
    license: 'MIT',
    project: 'https://github.com/ValveResourceFormat/ValveResourceFormat',
  },
};

/** Every tool the app knows how to fetch. */
const TOOL_NAMES: readonly string[] = Object.keys(BUILT_IN_PINS);

/* A copy of the pinned archive in this project's own bucket.
 *
 * The primary URL is a GitHub release, and every mirror src/net.ts knows is a proxy standing
 * in front of GitHub, so all of them go down together. This one does not: tools/r2-toolchain.mjs
 * copies the pinned archive there, byte for byte, after checking it against the same digest.
 *
 * Safe from anywhere, and that is the point of a pin: the digest lives in this file rather than
 * travelling with the URL, so whoever hands the bytes over cannot also decide what they should
 * hash to. The address is written here for the same reason the owner allowlist below is.
 */
const FALLBACK_BASE = 'https://cdn.dota2modmanager.com/tools/';
/** Where the copy of a pinned archive lives, keyed by the tool and the version pinned to it. */
const fallbackUrl = (name: string, version: string): string => `${FALLBACK_BASE}${name}-${version}.zip`;

/* Whose releases a pin may point at.
 *
 * "Some GitHub release with a matching digest" is not a pin: the digest travels in the same
 * file as the URL, so a rewritten config could name any repository on GitHub and hand over its
 * own hash to check it against. The owner is what makes the pin mean anything, and it is
 * decided here rather than in a file off the network.
 *
 * Two owners, because the project moved: Source 2 Viewer used to live under SteamDatabase and
 * now has an organisation of its own. GitHub 301s the old release URLs, so downloading still
 * works - but this check reads the URL as written in the pin rather than where it ends up, and
 * a pin naming the new owner would have been refused by a rule that only knew the old one. A
 * stale tool nobody can update, failing closed and quietly.
 *
 * Both are listed rather than the redirect being trusted. A redirect is a promise GitHub makes
 * today; the point of this list is that the owner is decided here.
 */
const PIN_REPOS: Record<string, string[]> = {
  vrf: ['ValveResourceFormat/ValveResourceFormat', 'SteamDatabase/ValveResourceFormat'],
};

/** Whether a pin names a version, an executable, a digest, and a release of an owner listed above. */
export function validPin(pin: unknown, name: string | null | undefined): boolean {
  const repos = (name && PIN_REPOS[name]) || [];
  const from = repos.length
    && new RegExp(`^https://github\\.com/(?:${repos.join('|')})/releases/download/`, 'i');
  if (!pin || typeof pin !== 'object' || !from) return false;
  const p = pin as Record<string, unknown>;
  return !!(typeof p.version === 'string' && p.version
    && typeof p.exe === 'string' && p.exe && !p.exe.includes('/') && !p.exe.includes('\\')
    && typeof p.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(p.sha256)
    && typeof p.url === 'string' && from.test(p.url));
}

/* A tool that has not answered by now is not going to. The user waits on this: the item picker
 * and the library show placeholders until it returns. */
const TOOL_TIMEOUT_MS = 60000;

/** Run one of the tools, hidden, and settle when it exits: resolved on 0, rejected otherwise. */
export function runTool(exe: string, args: string[], { timeoutMs = TOOL_TIMEOUT_MS } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(exe, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err) => (err ? reject(err) : resolve()));
  });
}

/** The tools in userData: what is there, fetching one at its pin, and deleting it again. */
export function createToolchain({ userDataDir, onProgress = () => {}, log = () => {} }: {
  userDataDir: string; onProgress?: (evt: ToolProgress) => void; log?: (msg: string) => void;
}) {
  const root = path.join(userDataDir, 'toolchain');
  const pins = BUILT_IN_PINS;

  const dirFor = (name: string, version: string) => path.join(root, name, version);
  const stateFile = path.join(root, 'installed.json');

  function installed(): Record<string, Installed> {
    try { return JSON.parse(fs.readFileSync(stateFile, 'utf-8')); } catch { return {}; }
  }

  function remember(name: string, entry: Installed | null): void {
    const all = installed();
    if (entry) all[name] = entry; else delete all[name];
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(all, null, 2));
  }

  /** Where this tool's executable sits right now, or null if it is not downloaded. */
  function pathOf(name: string): string | null {
    const entry = installed()[name];
    if (!entry) return null;
    const exe = path.join(dirFor(name, entry.version), entry.exe);
    return fs.existsSync(exe) ? exe : null;
  }

  /**
   * Make sure the tool is here, downloading it if it is not, and hand back the path to run.
   * @returns absolute path of the executable
   */
  async function ensure(name: string): Promise<string> {
    if (!TOOL_NAMES.includes(name)) throw new Error(`unknown tool ${name}`);
    const pin = pins[name];
    const have = installed()[name];
    if (have && have.version === pin.version) {
      const exe = pathOf(name);
      if (exe) return exe;
      log(`toolchain: ${name} ${have.version} was recorded but is gone from disk, fetching again`);
    }

    /* Whatever happens next, the bar at the bottom of the window hears how it ended. It hides
     * only on 'done' or 'error', and this used to send neither: a finished download left
     * "Downloading: vrf 50.3 / 50.3 MB" on screen until the app was closed, and a failed one
     * did the same with the bar stuck wherever the bytes had stopped. */
    try {
      const exe = await fetchAndUnpack(name, pin);
      onProgress({ type: 'done', label: name });
      return exe;
    } catch (err) {
      onProgress({ type: 'error', label: name, message: String((err as Error)?.message || err) });
      throw err;
    }
  }

  async function fetchAndUnpack(name: string, pin: Pin): Promise<string> {
    const dest = path.join(root, `${name}-${pin.version}.zip`);
    onProgress({ type: 'stage', label: name, stage: 'download' });
    const onBytes = (loaded: number, total: number) => onProgress({ type: 'download', label: name, loaded, total });
    let got;
    try {
      got = await downloadFile(pin.url, dest, { expectSha256: pin.sha256, onProgress: onBytes, log });
    } catch (err) {
      // Every mirror in net.ts is GitHub wearing another hostname, so a GitHub outage takes
      // the whole chain. The bucket is the one copy that does not share its fate.
      const spare = fallbackUrl(name, pin.version);
      log(`toolchain: ${name} not available from the release (${(err as Error)?.message || err}), trying ${spare}`);
      try {
        got = await downloadFile(spare, dest, { expectSha256: pin.sha256, onProgress: onBytes, log });
      } catch (spareErr) {
        /* The first error is the one worth having. If the release handed over bytes that did
         * not match the pin, that is what somebody needs to read - not a 404 from the copy
         * that was asked afterwards, which turns a tampering signal into a routine outage. */
        log(`toolchain: ${name} not available from the copy either (${(spareErr as Error)?.message || spareErr})`);
        throw err;
      }
    }
    log(`toolchain: ${name} ${pin.version} downloaded, ${(got.bytes / 1048576).toFixed(1)} MB`);

    // Unpacked as one change: a tool half-written is a tool that starts and then fails in a
    // way nobody can explain. safe-zip is what reads it, so a hostile archive from a moved
    // URL cannot write outside this folder.
    const into = dirFor(name, pin.version);
    fs.rmSync(into, { recursive: true, force: true });
    const archive = openZip(dest, { label: name });
    FileTx.run((tx) => archive.extractTo(into, tx), log);
    fs.rmSync(dest, { force: true });

    const exe = path.join(into, pin.exe);
    if (!fs.existsSync(exe)) {
      fs.rmSync(into, { recursive: true, force: true });
      throw new Error(`${pin.exe} is not in the ${name} archive`);
    }
    remember(name, { version: pin.version, exe: pin.exe, sha256: got.sha256, at: Date.now() });
    // an older version of the same tool is dead weight once this one works
    for (const old of fs.readdirSync(path.join(root, name))) {
      if (old !== pin.version) fs.rmSync(path.join(root, name, old), { recursive: true, force: true });
    }
    return exe;
  }

  /** What is on disk, for Settings and for the diagnostics report. */
  function state() {
    const have = installed();
    return TOOL_NAMES.map((name) => {
      const entry = have[name] || null;
      const dir = entry ? dirFor(name, entry.version) : null;
      let bytes = 0;
      if (dir) {
        try { for (const f of fs.readdirSync(dir)) bytes += fs.statSync(path.join(dir, f)).size; } catch { /* gone */ }
      }
      return {
        name,
        version: entry ? entry.version : null,
        latest: pins[name].version,
        installedBytes: bytes,
        downloadBytes: pins[name].bytes || 0,
        license: pins[name].license,
        project: pins[name].project,
        ready: !!pathOf(name),
      };
    });
  }

  function remove(name: string): void {
    fs.rmSync(path.join(root, name), { recursive: true, force: true });
    remember(name, null);
  }

  return { ensure, pathOf, state, remove, root, TOOL_NAMES };
}

