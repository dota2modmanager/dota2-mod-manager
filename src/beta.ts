/* The beta channel: who is let in, and which update feed this copy reads.
 *
 * Staged rollout was dropped in September 2026 for a good reason: an urgent fix has to reach
 * everybody at once, and two versions in the wild at the same time make a Discord thread
 * impossible to follow. A beta channel is the other half of that argument. It is not a slice of
 * everybody, it is a few people the maintainer picked himself, who know they are running the
 * build that has not been released yet.
 *
 * Who: the accounts already signed in with Discord (src/discord-auth.ts). The list lives in the
 * signed config/app.json, so it changes without a release, and it holds hashes rather than ids -
 * that file is public, and a list of a dozen people's Discord accounts is not ours to publish.
 * The salt sits next to the list: it does not make a hash unguessable for somebody who already
 * has a specific id in mind, and it does stop the file being a ready-made list to look up.
 *
 * What it is not: a lock. Nothing here is checked by a server, the build itself is a public
 * prerelease on GitHub, and a determined person can download it whatever this says. The gate
 * decides who is offered the beta, not who is able to run it. If that ever needs to be a real
 * lock, the files have to move behind something that verifies a Discord token, and that is a
 * different piece of work.
 *
 * Signing out of Discord takes the beta with it: without an id there is nobody to check against,
 * so the channel falls back to the stable one on the next check.
 */
import { createHash } from 'node:crypto';

/** The channel name electron-updater reads, and the file it looks for: beta.yml. */
export const BETA_CHANNEL = 'beta';
/** What everybody else reads: latest.yml, the release channel. */
export const STABLE_CHANNEL = 'latest';

export type Channel = typeof BETA_CHANNEL | typeof STABLE_CHANNEL;

/** The `beta` block of the signed config: a salt and the hashed ids let in. */
export interface BetaList { salt?: string; ids?: unknown[] }

/** Who is asking and whether they switched the beta on. */
export interface BetaAsk { discordId?: string | null; beta?: BetaList | null; wanted?: boolean }

/**
 * How an id becomes a line in the public list.
 * @param id    the Discord account id
 * @param salt  from the same block of the config
 */
export function idHash(id: string | number, salt: string | undefined): string {
  return createHash('sha256').update(`${String(salt || '')}:${String(id || '').trim()}`).digest('hex');
}

/**
 * Is this account on the list? A missing list, a missing id or a damaged entry all mean no,
 * because the honest answer to "should this person be offered an unreleased build" is no
 * until something says otherwise.
 * @param beta  the `beta` block of the signed config
 */
export function isTester(discordId: string | null | undefined, beta: BetaList | null | undefined): boolean {
  if (!discordId || !beta || !Array.isArray(beta.ids) || !beta.ids.length) return false;
  const want = idHash(discordId, beta.salt);
  return beta.ids.some((entry) => typeof entry === 'string' && entry.toLowerCase() === want);
}

/**
 * Which update channel this copy should read now.
 *
 * `wanted` is the switch in settings. It is deliberately not enough on its own: a copy whose
 * owner was taken off the list, or who signed out of Discord, goes back to the stable channel
 * with the switch still on, and turns beta again by itself if they are let back in.
 *
 */
export function channelFor({ discordId = null, beta = null, wanted = false }: BetaAsk = {}): Channel {
  return wanted && isTester(discordId, beta) ? BETA_CHANNEL : STABLE_CHANNEL;
}

/**
 * What the settings screen needs to draw: whether to show the switch at all, and where it sits.
 * Somebody who is not on the list is not told there is a list - a switch they cannot use is
 * noise, and "you are not invited" is a worse thing to read than nothing.
 */
export function betaState({ discordId = null, beta = null, wanted = false }: BetaAsk = {}): { eligible: boolean; on: boolean; channel: Channel } {
  const eligible = isTester(discordId, beta);
  return { eligible, on: eligible && Boolean(wanted), channel: channelFor({ discordId, beta, wanted }) };
}
