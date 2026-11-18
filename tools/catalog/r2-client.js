// Talking to R2, which speaks S3, which wants SigV4.
//
// No SDK: SigV4 is a hash of a canonical string, and eighty lines of crypto beats a dependency
// tree for a bucket this project writes to from two scripts. It was one script until
// 2026-09-10, when the release assets needed a second home as well as the mods, and a second
// copy of this is how the catalog walk came to be wrong in one of the three places that had it.
//
// Credentials come from the environment: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
const crypto = require('crypto');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest();

/* RFC 3986, not encodeURIComponent.
 *
 * SigV4 hashes a canonical request containing the encoded path, and S3 builds its own copy of
 * that string from what arrives. encodeURIComponent leaves ! ' ( ) * alone where S3 percent-
 * encodes them, so the two strings differ and the request comes back 403 SignatureDoesNotMatch.
 * One mod in the catalog is called "Techies Bismillah Blast Off!.zip" and it had never once
 * been mirrored.
 */
const rfc3986 = (segment) => encodeURIComponent(segment)
  .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** The path as SigV4 wants it: every segment encoded, separators left alone. */
const encodePath = (key) => `/${key.split('/').map(rfc3986).join('/')}`;

/**
 * A bucket you can list, put to and delete from.
 *
 * @param {object} [env]  where to read credentials from; the process environment by default
 * @returns {{ bucket: string, list: Function, put: Function, remove: Function, url: Function }}
 */
function createR2({ env = process.env, bucket = env.R2_BUCKET || 'd2mm-mods' } = {}) {
  const account = env.R2_ACCOUNT_ID || '';
  const key = env.R2_ACCESS_KEY_ID || '';
  const secret = env.R2_SECRET_ACCESS_KEY || '';
  const host = `${account}.r2.cloudflarestorage.com`;

  /** SigV4, all of it. R2 wants region "auto" and service "s3". */
  function sign({ method, path: objectPath, payloadHash, headers = {}, query = '' }) {
    const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = stamp.slice(0, 8);
    const all = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': stamp, ...headers };
    const names = Object.keys(all).map((n) => n.toLowerCase()).sort();
    const canonicalHeaders = names
      .map((n) => `${n}:${String(all[Object.keys(all).find((k) => k.toLowerCase() === n)]).trim()}\n`)
      .join('');
    const signedHeaders = names.join(';');
    const canonical = [method, encodePath(objectPath), query, canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${date}/auto/s3/aws4_request`;
    const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha(canonical)].join('\n');
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${secret}`, date), 'auto'), 's3'), 'aws4_request');
    const signature = hmac(signingKey, toSign).toString('hex');
    return {
      ...all,
      Authorization: `AWS4-HMAC-SHA256 Credential=${key}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
  }

  const url = (objectPath, query) => `https://${host}${encodePath(objectPath)}${query ? `?${query}` : ''}`;

  /**
   * Every object under `prefix`, as a Map of key to size.
   * Paged, because a bucket with a thousand mods in it does not answer in one response.
   */
  async function list(prefix = '') {
    const have = new Map();
    let token = '';
    do {
      const q = new URLSearchParams({ 'list-type': '2', 'max-keys': '1000' });
      if (prefix) q.set('prefix', prefix);
      if (token) q.set('continuation-token', token);
      q.sort();
      const query = q.toString();
      const res = await fetch(url(bucket, query), { headers: sign({ method: 'GET', path: bucket, payloadHash: sha(''), query }) });
      const xml = await res.text();
      if (!res.ok) throw new Error(`list: HTTP ${res.status} ${xml.slice(0, 300)}`);
      for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>[\s\S]*?<Size>(\d+)<\/Size>/g)) {
        have.set(m[1], Number(m[2]));
      }
      token = /<NextContinuationToken>([^<]+)</.exec(xml)?.[1] ?? '';
    } while (token);
    return have;
  }

  /** Writes one object. `body` is a Buffer, because everything here is already in memory. */
  async function put(objectKey, body, contentType = 'application/octet-stream') {
    const full = `${bucket}/${objectKey}`;
    const payloadHash = sha(body);
    const headers = sign({
      method: 'PUT',
      path: full,
      payloadHash,
      headers: { 'content-length': String(body.length), 'content-type': contentType },
    });
    const res = await fetch(url(full), { method: 'PUT', headers, body });
    if (!res.ok) throw new Error(`put ${objectKey}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }

  /** Removes one object. A key that is not there is not an error worth stopping for. */
  async function remove(objectKey) {
    const full = `${bucket}/${objectKey}`;
    const headers = sign({ method: 'DELETE', path: full, payloadHash: sha('') });
    const res = await fetch(url(full), { method: 'DELETE', headers });
    if (!res.ok && res.status !== 404) {
      throw new Error(`delete ${objectKey}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
  }

  return { bucket, list, put, remove, url, sign, configured: Boolean(account && key && secret) };
}

/* Replacing an object in the bucket does not replace what Cloudflare already handed out.
 *
 * The bucket is served through a cache, and .zip and .vpk are among the extensions it caches
 * by default. So an archive that someone downloaded before it was replaced keeps arriving from
 * the edge in its old form, for as long as the entry lives - measured on 2026-09-10, one of
 * the twenty-three archives refreshed that day was still being served in the version it had on
 * 28 August, more than an hour after the object under it had changed.
 *
 * The app survives it, since a copy that fails its checksum now costs the mirror its turn
 * rather than the mod. That is a safety net, not a reason for the mirror to be wrong.
 *
 * Needs CLOUDFLARE_ZONE_ID and a token allowed to purge that zone. It never throws: a missing
 * credential comes back as `skipped`, a refused or failed batch is counted in `failed`, and
 * r2-sync turns either into a red job. Until 2026-09-15 both only printed a line, and the purge
 * had in fact never run once.
 *
 * @param {string[]} urls  public URLs to drop from the cache
 * @param {object} [env]
 * @returns {Promise<{purged: number, failed?: number, skipped?: string}>}
 */
async function purgeCache(urls, { env = process.env, log = console.log } = {}) {
  const unique = [...new Set(urls)].filter(Boolean);
  if (!unique.length) return { purged: 0 };

  const zone = env.CLOUDFLARE_ZONE_ID || '';
  const token = env.CLOUDFLARE_PURGE_TOKEN || env.CLOUDFLARE_API_TOKEN || '';
  if (!zone || !token) {
    log(`cache: ${unique.length} replaced object(s) want purging, and CLOUDFLARE_ZONE_ID / a token with Cache Purge are not set`);
    return { purged: 0, skipped: 'no credentials' };
  }

  let purged = 0;
  let failed = 0;
  // the API takes at most 30 URLs per call
  for (let i = 0; i < unique.length; i += 30) {
    const batch = unique.slice(i, i + 30);
    try {
      const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ files: batch }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.success === false) {
        const why = (body.errors || []).map((e) => e.message).join('; ') || `HTTP ${res.status}`;
        log(`cache: purge refused for ${batch.length} url(s): ${why}`);
        failed += batch.length;
        continue;
      }
      purged += batch.length;
    } catch (e) {
      log(`cache: purge failed for ${batch.length} url(s): ${e.message}`);
      failed += batch.length;
    }
  }
  if (purged) log(`cache: purged ${purged} of ${unique.length} replaced object(s)`);
  return failed ? { purged, failed } : { purged };
}

module.exports = { createR2, encodePath, rfc3986, sha, purgeCache };
