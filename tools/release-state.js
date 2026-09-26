/* What a published release has to carry, and what the update mirror has to hold, in one place.
 *
 * release.yml reads the list before it publishes and again after; tools/release-watch.mjs reads it
 * every few hours; tools/r2-release.mjs builds the mirror from it. Until 2026-09-26 each of those
 * kept a list of its own in shell, and the lists had drifted: beta.yml was checked after publishing
 * and added after publishing, so on 2.8.0-beta.1 the check was the first thing to notice it was
 * missing, and on 2.7.1 a failed step before it meant it was never added at all.
 *
 * With immutable releases a published release cannot gain a file, so "every file" is decided once,
 * here, and the draft is held to it before anybody can see it.
 */
const { betaName } = require('./mirror-plan.js');

/** What electron-updater reads on each channel, and what src/portable-update.js reads. */
const FEEDS = ['latest.yml', 'latest-linux.yml', 'portable.yml', 'beta.yml', 'beta-linux.yml'];
/** What those feeds point at. */
const BINARIES = ['Dota-2-Mod-Manager-Setup.exe', 'Dota-2-Mod-Manager-Portable.exe', 'Dota-2-Mod-Manager.AppImage'];
/** What somebody checking a download reads: checksums, their signed bundle, the SBOM. */
const PROOF = ['SHA256SUMS', 'SHA256SUMS.intoto.jsonl', 'dota2-mod-manager.cdx.json'];
/** Every file a published release carries, a beta included: a beta carries latest.yml too,
 *  because electron-builder names its feed that whatever the version says. */
const REQUIRED_ASSETS = [...FEEDS, ...BINARIES, ...PROOF];

/** Which required files are not among `names`. */
function missingAssets(names) {
  const have = new Set(names);
  return REQUIRED_ASSETS.filter((n) => !have.has(n));
}

/** 2.8.0-beta.1 -> { core: [2, 8, 0], pre: ['beta', 1] }, or null for anything else. */
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(v));
  if (!m) return null;
  const pre = m[4] ? m[4].split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [];
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre };
}

/** Semantic-version order: negative when a comes first. A prerelease sorts before its release. */
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return String(a).localeCompare(String(b));
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    if (typeof p === 'number' && typeof q === 'number') return p - q;
    if (typeof p === 'number') return -1;
    if (typeof q === 'number') return 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

const isBetaVersion = (v) => /-/.test(String(v));

/**
 * The newest release everybody is on, and the newest a tester is on, out of the releases GitHub
 * lists. A draft is nobody's. `beta` is null unless a beta newer than the release is out.
 * @param {Array<{tag_name: string, draft: boolean, prerelease: boolean}>} releases
 */
function channelHeads(releases) {
  const out = (releases || [])
    .filter((r) => !r.draft && parseVersion(r.tag_name))
    .map((r) => ({ ...r, version: r.tag_name.replace(/^v/, '') }))
    .sort((a, b) => compareVersions(b.version, a.version));
  const stable = out.find((r) => !r.prerelease && !isBetaVersion(r.version)) || null;
  const newest = out[0] || null;
  const beta = newest && stable && newest !== stable && isBetaVersion(newest.version)
    && compareVersions(newest.version, stable.version) > 0 ? newest : null;
  return { stable, beta };
}

/** The version a feed file announces, or null. */
function feedVersion(text) {
  const m = /^version:\s*['"]?([^\s'"]+)/m.exec(String(text || ''));
  return m ? m[1] : null;
}

/**
 * What the mirror has to hold for these two heads: each feed with the version it must announce,
 * each binary with the size it must have. A beta's binaries carry -beta, and its feeds are the
 * beta channel's; with no beta out, the beta channel reads the release.
 * @returns {Array<{name: string, version?: string, size?: number}>}
 */
function mirrorExpectation({ stable, beta }) {
  if (!stable) return [];
  const sizeIn = (rel, name) => ((rel.assets || []).find((a) => a.name === name) || {}).size;
  const want = [];
  for (const name of ['latest.yml', 'latest-linux.yml', 'portable.yml']) want.push({ name, version: stable.version });
  for (const name of BINARIES) want.push({ name, size: sizeIn(stable, name) });
  const tester = beta || stable;
  for (const name of ['beta.yml', 'beta-linux.yml']) want.push({ name, version: tester.version });
  if (beta) for (const name of BINARIES) want.push({ name: betaName(name), size: sizeIn(beta, name) });
  return want;
}

/**
 * What differs between the mirror and what it has to hold.
 * @param {Array<{name: string, version?: string, size?: number}>} want
 * @param {Map<string, {status: number, version?: string|null, size?: number|null}>} seen
 * @returns {string[]} one line per difference, empty when the mirror is right
 */
function mirrorDrift(want, seen) {
  const out = [];
  for (const w of want) {
    const s = seen.get(w.name);
    if (!s || s.status !== 200) {
      out.push(`${w.name} is not on the mirror${s ? ` (HTTP ${s.status})` : ''}`);
    } else if (w.version && s.version !== w.version) {
      out.push(`${w.name} announces ${s.version || 'no version'}, and ${w.version} is out`);
    } else if (w.size && s.size !== w.size) {
      out.push(`${w.name} is ${s.size} bytes, and the release's copy is ${w.size}`);
    }
  }
  return out;
}

/* ---------- the Discord post ---------- */

/** Discord caps an embed description at 4096 characters; the notes get the room left after the link. */
const NOTES_LIMIT = 3200;
/** Written into the release notes once the post went out, where nothing renders it. */
const ANNOUNCED = '<!-- announced in Discord -->';
/** The last line of every release page. The SignPath Foundation asks for the term "Code signing
 *  policy" on the pages people download from; the Discord post is not one, and goes without it. */
const SIGNING_POLICY = '[Code signing policy](https://dota2modmanager.com/code-signing/)';

/**
 * The message for a release, cut by characters rather than bytes: `head -c` could stop in the
 * middle of a letter, and the post would carry half of it.
 */
function discordPayload({ name, url, notes }) {
  const chars = [...String(notes || '').replace(/\r\n/g, '\n').replace(ANNOUNCED, '').replace(SIGNING_POLICY, '').trim()];
  let text = chars.join('');
  if (chars.length > NOTES_LIMIT) text = `${chars.slice(0, NOTES_LIMIT).join('').replace(/\s+\S*$/, '')}…`;
  if (!text) text = 'A new release has been published!';
  return {
    content: '**Mod Manager Updated!**',
    embeds: [{ title: [...String(name)].slice(0, 256).join(''), url, description: `${text}\n\n[**Open Release Page**](${url})`, color: 8585067 }],
    username: 'GitHub',
    avatar_url: 'https://i.postimg.cc/zGJTFHyj/github.webp',
  };
}

/**
 * The section of a changelog for one version, without its heading, or '' when there is none.
 * The same cut release.yml makes with awk for the release page: from "## 2.8.0" to the next "## ".
 */
function changelogSection(text, version) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  // "## 2.8.0-beta.1" is not the section of 2.8.0: a version ends where no letter, digit, dot or
  // hyphen follows (release.yml's awk stopped only at [^0-9.] and could take a beta's notes)
  const head = new RegExp(`^## ${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^-0-9A-Za-z.]|$)`);
  const at = lines.findIndex((l) => head.test(l));
  if (at < 0) return '';
  const end = lines.findIndex((l, i) => i > at && /^## /.test(l));
  return lines.slice(at + 1, end < 0 ? undefined : end).join('\n').trim();
}

/* ---------- what tools/release-watch.mjs holds a release to ---------- */

/** Releases published before this are held to the mirror and nothing else: 2.7.1 went out
 *  without a Discord post on purpose, and announcing it now would be news days late. */
const WATCH_FROM = '2026-09-26T00:00:00Z';
/** Whether the release went out after the watch began. */
const watched = (release) => Boolean(release && release.published_at && release.published_at >= WATCH_FROM);
/** Whether the notes say the Discord post went out. */
const announced = (release) => String((release && release.body) || '').includes(ANNOUNCED);
/** Whether the notes carry the antivirus report: tools/virustotal.mjs opens it with this line. */
const VIRUSTOTAL_MARK = '<!-- virustotal -->';
const scanned = (release) => String((release && release.body) || '').includes(VIRUSTOTAL_MARK);

module.exports = {
  FEEDS, BINARIES, PROOF, REQUIRED_ASSETS, NOTES_LIMIT, ANNOUNCED, SIGNING_POLICY, WATCH_FROM,
  missingAssets, parseVersion, compareVersions, isBetaVersion, channelHeads, feedVersion,
  mirrorExpectation, mirrorDrift, discordPayload, changelogSection, watched, announced, scanned,
};

/* From a workflow:
 *   node tools/release-state.js missing < names.txt     prints what is missing, fails if anything is
 *   node tools/release-state.js discord notes.md NAME URL   prints the post */
if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2);
  const fs = require('fs');
  if (cmd === 'missing') {
    const names = fs.readFileSync(0, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const gone = missingAssets(names);
    for (const n of gone) console.log(n);
    process.exit(gone.length ? 1 : 0);
  } else if (cmd === 'discord') {
    let notes = '';
    try { notes = fs.readFileSync(args[0], 'utf8'); } catch { /* no notes: the fallback line */ }
    process.stdout.write(JSON.stringify(discordPayload({ name: args[1], url: args[2], notes })));
  } else {
    console.error('usage: node tools/release-state.js missing < names | discord <notes.md> <name> <url>');
    process.exit(2);
  }
}
