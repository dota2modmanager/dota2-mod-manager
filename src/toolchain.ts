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
import { t } from './i18n.ts';

/** A tool pinned to a version, a URL, and the digest those bytes have to hash to. */
interface Pin { version: string; url: string; sha256: string; bytes: number; exe: string; license: string; project: string }

/**
 * What installed.json records for a tool on disk. `build` is missing from every record written
 * before there was more than one build, and those are all the Windows one: it was the only pin.
 */
type Installed = { version: string; exe: string; sha256: string; at: number; build?: string };

/** How a download is going, for the bar at the bottom of the window. */
export type ToolProgress =
  | { type: 'stage'; label: string; stage: string }
  | { type: 'download'; label: string; loaded: number; total: number }
  | { type: 'done'; label: string }
  | { type: 'error'; label: string; message: string };

/** The build of a tool this machine runs: platform and processor, as Node names them. */
export const HOST_BUILD = `${process.platform}-${process.arch}`;

/* The only pins there are: what the app was built knowing, one per build of each tool.
 *
 * There was one, the Windows build, and Linux downloaded it too: a Windows program the system
 * refuses to start (EACCES), so every item icon and hero portrait on Linux failed into the log
 * from 2.4.0 on. A machine with no build of its own here gets no tool rather than another's.
 *
 * Measured 2026-11-07 for 20.1: each digest comes from GitHub's own release API and was confirmed
 * by downloading the file and hashing it, and each archive was opened to check the executable is
 * at its root under the name below. 20.0 could not read a style built by a recent resourcecompiler
 * (Crystal Interface, Material You): it exited 0 and wrote nothing. */
const VRF = {
  version: '20.1',
  license: 'MIT',
  project: 'https://github.com/ValveResourceFormat/ValveResourceFormat',
};
const VRF_RELEASE = 'https://github.com/ValveResourceFormat/ValveResourceFormat/releases/download/20.1';
/** Every tool's pins, by build (HOST_BUILD's shape): the comment above says why there are several. */
export const BUILT_IN_PINS: Record<string, Record<string, Pin>> = {
  vrf: {
    'win32-x64': {
      ...VRF,
      url: `${VRF_RELEASE}/cli-windows-x64.zip`,
      sha256: '67aaf8a67a85ca60fd09ff343e62103a4cdf3a2d177fc656231d7d734c5b3aa3',
      bytes: 52773073,
      exe: 'Source2Viewer-CLI.exe',
    },
    'linux-x64': {
      ...VRF,
      url: `${VRF_RELEASE}/cli-linux-x64.zip`,
      sha256: '29d25a6d6b62377fc5386c3e5145b0a2180a401a50041afe9494b3f503deaef5',
      bytes: 53094205,
      exe: 'Source2Viewer-CLI',
    },
  },
};

/** Every tool the app knows how to fetch. */
const TOOL_NAMES: readonly string[] = Object.keys(BUILT_IN_PINS);

/** A tool's pin for one build, or null when that build has none. */
export function pinFor(name: string, build: string = HOST_BUILD): Pin | null {
  return BUILT_IN_PINS[name]?.[build] || null;
}

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
/**
 * The name of the copy of a pinned archive in the bucket, keyed by the tool, the version and the
 * build. The Windows build keeps the name it had when it was the only one: every release before
 * the Linux pin asks for exactly that name.
 */
export function fallbackName(name: string, version: string, build: string): string {
  return build === 'win32-x64' ? `${name}-${version}.zip` : `${name}-${version}-${build}.zip`;
}

/* Whose releases a pin may point at. The digest travels in the same file as the URL, so a rewritten
 * config could otherwise name any repository and hand over its own hash: the owner is what makes a
 * pin mean anything, and it is decided here. Two owners, because Source 2 Viewer moved from
 * SteamDatabase to its own organisation, and this reads the URL as written, not where GitHub 301s
 * it. */
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
export function createToolchain({ userDataDir, onProgress = () => {}, log = () => {}, build = HOST_BUILD }: {
  userDataDir: string; onProgress?: (evt: ToolProgress) => void; log?: (msg: string) => void;
  /** the build to fetch and to accept on disk; tests name one, the app runs its own */
  build?: string;
}) {
  const root = path.join(userDataDir, 'toolchain');

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

  /**
   * Where this tool's executable sits right now, or null if it is not downloaded. A build for
   * another machine counts as not downloaded: it is on disk, and it cannot run here.
   */
  function pathOf(name: string): string | null {
    const entry = installed()[name];
    if (!entry || (entry.build || 'win32-x64') !== build) return null;
    const exe = path.join(dirFor(name, entry.version), entry.exe);
    return fs.existsSync(exe) ? exe : null;
  }

  /**
   * Make sure the tool is here, downloading it if it is not, and hand back the path to run.
   * @returns absolute path of the executable
   */
  async function ensure(name: string): Promise<string> {
    if (!TOOL_NAMES.includes(name)) throw new Error(`unknown tool ${name}`);
    const pin = pinFor(name, build);
    if (!pin) throw new Error(t('Для этой системы ({0}) нет сборки {1}', build, name));
    const have = installed()[name];
    if (have && have.version === pin.version) {
      const exe = pathOf(name);
      if (exe) return exe;
      log(`toolchain: ${name} ${have.version} (${have.build || 'win32-x64'}) was recorded but cannot run here as ${build}, fetching again`);
    }

    /* Whatever happens next, the bar at the bottom of the window hears how it ended: it hides only
     * on 'done' or 'error', and without them it stayed up until the app was closed. */
    try {
      const exe = await fetchAndUnpack(name, pin);
      onProgress({ type: 'done', label: name });
      return exe;
    } catch (err) {
      onProgress({ type: 'error', label: name, message: String((err as Error)?.message || err) });
      throw err;
    }
  }

  /** A tool on disk brought up to its pin: pathOf takes whatever is there, so nothing else would. */
  async function catchUp(): Promise<void> {
    for (const name of TOOL_NAMES) {
      const have = installed()[name];
      const pin = pinFor(name, build);
      if (have && pin && have.version !== pin.version) await ensure(name);
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
      const spare = FALLBACK_BASE + fallbackName(name, pin.version, build);
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
    // the archive marks it executable, and the unzip keeps contents, not modes
    if (!build.startsWith('win32')) fs.chmodSync(exe, 0o755);
    remember(name, { version: pin.version, exe: pin.exe, sha256: got.sha256, at: Date.now(), build });
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
      const pin = pinFor(name, build);
      return {
        name,
        version: entry ? entry.version : null,
        latest: pin?.version ?? null,
        installedBytes: bytes,
        downloadBytes: pin?.bytes || 0,
        license: pin?.license ?? null,
        project: pin?.project ?? null,
        /** whether this machine has a build of it at all */
        available: !!pin,
        ready: !!pathOf(name),
      };
    });
  }

  function remove(name: string): void {
    fs.rmSync(path.join(root, name), { recursive: true, force: true });
    remember(name, null);
  }

  return { ensure, catchUp, pathOf, state, remove, root, TOOL_NAMES };
}

