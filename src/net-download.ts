// A file downloaded to disk across the mirror chain (src/net.ts explains it): resumed where a
// partial download stopped, checked against the hash the catalog published, and a mirror whose
// bytes do not match is treated as a mirror that failed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { hostOf, mirrorsFor, noteFailure } from './net-mirrors.ts';
import { fetchMirrored } from './net-fetch.ts';

/** A file on disk, and how it got there. */
export interface Download {
  path: string;
  bytes: number;
  sha256: string;
  resumedFrom: number;
  /** nothing matched the published hash, and the catalog's own host's copy was taken */
  unverified?: boolean;
}

export const sha256 = (file: string): Promise<string> => new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha256');
  fs.createReadStream(file)
    .on('data', (chunk) => hash.update(chunk))
    .on('error', reject)
    .on('end', () => resolve(hash.digest('hex')));
});

/**
 * Download to a file, resuming where an interrupted attempt stopped.
 *
 * The half-finished file is kept as <dest>.part and picked up with a Range request. Every
 * mirror measured supports it, and a mod archive is up to 300 MB: starting a 60 MB download
 * over because a train went into a tunnel is the difference between a mod and a shrug.
 *
 * @param opts.expectSha256 what this file should hash to; a mirror handing over
 *   something else is dropped and the next one is asked
 * @param opts.fromPublishedList the expectation above came from a list somebody
 *   else maintains (the catalog's `mod-hashes.json`, or what this machine saw last time),
 *   rather than from a hash pinned in this project. Such a list can simply be wrong, and when
 *   it is, the file it names outranks it. Never pass this for the app's own update or for the
 *   toolchain: those hashes are pinned here and a mismatch there is the thing being guarded.
 */
export async function downloadFile(url: string, dest: string, {
  onProgress = () => {}, expectSha256 = null, fromPublishedList = false, log = () => {},
}: {
  onProgress?: (loaded: number, total: number) => void;
  expectSha256?: string | null;
  fromPublishedList?: boolean;
  log?: (msg: string) => void;
} = {}): Promise<Download> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  /* A mirror that answers with bytes we cannot use has failed, exactly like one that does not
   * answer at all - and until 2026-09-10 only the second kind was treated that way. The whole
   * download was abandoned on the first wrong checksum, so a single stale copy on one mirror
   * took the mod away from everybody who reaches that mirror first.
   *
   * That is not hypothetical: the bucket skipped an archive it already had under the same
   * name, so 24 mods that upstream had replaced still sat there in their old versions. Anybody
   * who cannot reach GitHub got those bytes, the checksum said no, and the install stopped -
   * while three proxies that had the current file were never asked.
   *
   * So a wrong checksum costs that mirror its turn, not the mod.
   */
  const refused: string[] = [];
  const mirrorCount = Math.max(1, mirrorsFor(url).length);

  /* And the other half of it: the list can be wrong about the file.
   *
   * `mod-hashes.json` is rebuilt by a bot in the catalog's repository, beside the archives it
   * describes. On 2026-09-10 it named a hash for heroes/Axe Kratos.zip that no copy of that
   * file has ever had - not GitHub's, not the API's, not any proxy's - so the mod was refused
   * for everybody, including people whose GitHub works perfectly.
   *
   * A published hash is worth having because a proxy is a stranger and the hash proves the
   * bytes are the ones the catalog's author signed for. It cannot prove anything about GitHub
   * itself: the list lives in the same repository as the archives, so whoever could rewrite
   * one could rewrite the other. When every mirror disagrees with the list and the catalog's
   * own host is among them, the list is the thing that is out of date.
   *
   * So the origin's copy is kept aside rather than deleted, and used if nothing verifies. The
   * guarantee that survives: no proxy can get bytes installed that GitHub did not serve.
   */
  const kept = `${dest}.origin`;
  let haveOriginCopy = false;
  const dropKept = () => { if (haveOriginCopy) fs.rmSync(kept, { force: true }); haveOriginCopy = false; };

  for (let attempt = 0; ; attempt++) {
    let have = 0;
    try { have = fs.statSync(part).size; } catch { /* nothing to resume */ }

    const headers: Record<string, string> = have > 0 ? { Range: `bytes=${have}-` } : {};
    let answered: { host: string; origin: boolean } = { host: hostOf(url), origin: false };
    const res = await fetchMirrored(url, {
      headers, exclude: refused, log, onMirror: (m) => { answered = m; },
    });
    if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
    const host = answered.host;

    // A mirror that ignores Range (or a file that changed upstream) answers 200 with the whole
    // thing: start over rather than glue two halves of different files together.
    const resuming = res.status === 206 && have > 0;
    if (!resuming && have > 0) {
      log(`resume refused by ${host}, starting over`);
      have = 0;
    }
    const totalHeader = Number(res.headers.get('content-length')) || 0;
    const total = totalHeader ? totalHeader + (resuming ? have : 0) : 0;

    const out = fs.createWriteStream(part, { flags: resuming ? 'a' : 'w' });
    let loaded = have;
    if (!res.body) throw new Error(`HTTP ${res.status} with no body`);
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        loaded += value.length;
        onProgress(loaded, total);
        await new Promise<void>((resolve, reject) => {
          out.write(Buffer.from(value), (err) => (err ? reject(err) : resolve()));
        });
      }
    } finally {
      await new Promise<void>((resolve) => { out.end(() => resolve()); });
    }

    const digest = await sha256(part);
    if (expectSha256 && digest !== expectSha256) {
      // half a file resumed from a mirror that turned out to be wrong is worth nothing, and
      // leaving it behind would poison the Range request of whichever mirror answers next
      if (fromPublishedList && answered.origin) {
        dropKept();
        fs.renameSync(part, kept);
        haveOriginCopy = true;
      } else {
        fs.rmSync(part, { force: true });
      }
      noteFailure(host, 'checksum mismatch');
      refused.push(host);
      log(`mirror ${host} served ${path.basename(dest)} with the wrong checksum`);
      if (attempt + 1 < mirrorCount) continue;

      // Nothing verified. If the catalog's own host handed over a copy, it is the file and the
      // list is stale; anything else here is a mod nobody can vouch for.
      if (haveOriginCopy) {
        const kind = await sha256(kept);
        fs.rmSync(dest, { force: true });
        fs.renameSync(kept, dest);
        haveOriginCopy = false;
        log(`${path.basename(dest)}: no copy matches the published hash; taking the one from the host the catalog names, which is where the list is built`);
        return { path: dest, bytes: fs.statSync(dest).size, sha256: kind, resumedFrom: 0, unverified: true };
      }
      // flagged rather than matched on its wording: the caller turns this into a sentence in
      // the user's language, and it should not have to recognise it by its English
      const bad: Error & { checksum?: boolean } = new Error(`checksum mismatch for ${path.basename(dest)}`);
      bad.checksum = true;
      throw bad;
    }
    dropKept();
    fs.rmSync(dest, { force: true });
    fs.renameSync(part, dest);
    return { path: dest, bytes: fs.statSync(dest).size, sha256: digest, resumedFrom: resuming ? have : 0 };
  }
}
