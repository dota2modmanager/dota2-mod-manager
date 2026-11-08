/* The toolchain's copy in our bucket: where it is, what it is called, and when it is asked first. */

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
/** The bucket's folder of pinned archives. */
export const FALLBACK_BASE = 'https://cdn.dota2modmanager.com/tools/';
/**
 * The name of the copy of a pinned archive in the bucket, keyed by the tool, the version and the
 * build. The Windows build keeps the name it had when it was the only one: every release before
 * the Linux pin asks for exactly that name.
 */
/**
 * Where to ask for a pinned archive, in order. The bucket goes first while GitHub is known to be
 * down: its three proxies then wait out a timeout each, half a minute of a bar at nothing, before
 * the one copy that works gets asked. The digest checks the bytes from either.
 */
export const downloadOrder = (release: string, spare: string, githubDown: boolean): [string, string] => (githubDown ? [spare, release] : [release, spare]);

/** The name of a pinned archive in the bucket. The version goes in, and the build off Windows. */
export function fallbackName(name: string, version: string, build: string): string {
  return build === 'win32-x64' ? `${name}-${version}.zip` : `${name}-${version}-${build}.zip`;
}
