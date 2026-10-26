/**
 * The key the chase gives, asked of the pumpkin's worker (tools/pumpkin-worker in the repository).
 *
 * The first Halloween gave everybody the same key, so it was in Discord a minute later. Now each
 * caught runner gets a key of its own, made on the worker, and each key opens one pumpkin: the
 * first install of the app that brings it keeps it. A ticket is asked for the moment the chase
 * starts and spent when the runner is caught, so a key costs a chase rather than a request.
 *
 * The key is kept in this browser (mm-key) so the footer can show it again; it is worthless to
 * anybody else once spent, and worthless to the next person who copies it from a screenshot.
 */
export const PUMPKIN = 'https://pumpkin.dota2modmanager.com';

export type Claim = { key: string } | { error: 'early' | 'enough' | 'offline' | 'broken' };

/** Ask for a ticket as the chase starts. Null when the worker cannot be reached; the chase runs anyway. */
export function ticket(): Promise<string | null> {
  return fetch(`${PUMPKIN}/ticket`, { method: 'POST' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (j && typeof j.ticket === 'string' ? j.ticket : null))
    .catch(() => null);
}

/** Spend the ticket on a key. */
export async function claim(t: string | null): Promise<Claim> {
  if (!t) return { error: 'offline' };
  try {
    const r = await fetch(`${PUMPKIN}/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket: t }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && typeof j.key === 'string') {
      try { localStorage.setItem('mm-key', j.key); } catch { /* private mode */ }
      return { key: j.key };
    }
    if (j.error === 'early') return { error: 'early' };
    if (j.error === 'enough') return { error: 'enough' };
    return { error: 'broken' };
  } catch {
    return { error: 'offline' };
  }
}

/** The key this browser was given last, if any. */
export function keptKey(): string | null {
  try { return localStorage.getItem('mm-key'); } catch { return null; }
}
