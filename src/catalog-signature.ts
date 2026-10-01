// Making the catalog's own author the only person who can change the catalog.
//
// The app reads mods.json, constants.json and guides.json from somebody else's repository,
// and when raw.githubusercontent is unreachable it reads them through public proxies instead
// (see net.js). A proxy is a stranger who hands over bytes claiming they are GitHub's, and
// nothing in the transport can tell the difference. For a mod archive that is survivable: it
// is checked against a digest and the worst case is a broken hero model. For the catalog it
// is not, because the catalog is a list of URLs the app will fetch and names it will show.
//
// A signature settles it without asking anyone to trust the route. The catalog's author signs
// the files with a key only he holds, publishes <name>.sig next to each, and the app verifies
// against a public key baked into this file. A rewritten mods.json then fails here rather than
// at the point where somebody's machine does what it says.
//
// Without a key this module answers "nothing pinned, carry on", which is what it did from the
// day it was written until 2026-09-10. Refusing every fetch because a signature had not been
// arranged yet would have taken the app down for everybody and protected nobody.
import { createPublicKey, verify as verifyWith } from 'node:crypto';

// Base64 SPKI of the catalog author's ed25519 public key. `tools/sign-catalog.js --keygen`
// prints one in exactly this form. Empty means verification is off.
//
// Pinned on 2026-09-10, and not the day the key arrived. A signature is only good for the
// bytes it was made from, and the catalog was publishing data and signature in separate
// commits: for the one to eight minutes between them the published files disagreed with their
// own signatures, which reads here as an attack and is really a bot that has not run yet.
// Anybody already using the app would have kept their cached catalog; anybody installing it in
// those minutes would have had no catalog at all, and the catalog moves about five times a day.
// The author now writes the data and the signatures in one commit, so there is no moment when
// what is published disagrees with what is signed.
export const CATALOG_PUBLIC_KEY = 'MCowBQYDK2VwAyEAkzP+iIJLaFlc20Uj3OyLnDX4arckiBuSpPk1BcRKUsk=';

// Where the signatures live in the catalog repository, and what they are called there:
// assets/signatures/mods.json.sig for assets/data/mods.json.
export const SIG_DIR = 'assets/signatures';
/** Appended to a data file's name to get its signature's: mods.json -> mods.json.sig. */
export const SIG_SUFFIX = '.sig';

/** Is there a key to check against at all? */
export function configured(key: string = CATALOG_PUBLIC_KEY): boolean {
  return !!(key && key.trim());
}

/**
 * @param payload      the file exactly as it was published
 * @param signatureB64 contents of the .sig file (base64, whitespace ignored)
 * @param key          base64 SPKI public key; defaults to the pinned one
 * @returns true when the signature is this key's signature over this payload
 */
export function verify(payload: string | Buffer, signatureB64: unknown, key: string = CATALOG_PUBLIC_KEY): boolean {
  if (!configured(key)) return true; // nothing pinned, see the note at the top
  try {
    const pub = createPublicKey({
      key: Buffer.from(key.trim(), 'base64'),
      format: 'der',
      type: 'spki',
    });
    const sig = Buffer.from(String(signatureB64 || '').trim(), 'base64');
    if (!sig.length) return false;
    return verifyWith(null, Buffer.from(payload), pub, sig);
  } catch {
    return false; // a malformed key or signature is a failed check, never a passed one
  }
}
