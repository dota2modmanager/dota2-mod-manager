/* Likes on catalog mods and follows of their authors, kept by the catalog's account service
 * (crates/mm-core/src/catalog/social.rs).
 *
 * Off until the signed remote config names the service: then `enabled` is false, every count is
 * 0 and nothing on screen offers a like. Asked once when something first wants it, again after a
 * sign-in or a sign-out, and at most once a minute for everyone's numbers (main keeps them). A like
 * shows at once and is taken back if the service refuses it.
 *
 * Likes go by the download counter's key (core/download-counts.ts countKey), so the catalog site
 * and the app count the same mod the same way; follows go by the author's name as the catalog
 * writes it. */
import type { SocialState } from '../api/app.ts';
import type { Mod } from '../catalog/types.ts';
import { countKey } from './download-counts.ts';
import { state } from './store.ts';
import { toast } from '../ui/toast.ts';

const OFF: SocialState = { enabled: false, signedIn: false, likes: [], follows: [], counts: { likes: {}, followers: {} } };
const REFRESH_MS = 60_000;

let now: SocialState = OFF;
let askedAt = 0;
let asking: Promise<void> | null = null;
const listeners = new Set<() => void>();

const tell = (): void => { for (const fn of listeners) fn(); };

/** Something on screen follows the state through here. */
export function onSocial(fn: () => void): () => void {
  listeners.add(fn);
  if (Date.now() - askedAt > REFRESH_MS) void refreshSocial();
  return () => { listeners.delete(fn); };
}

/** Ask main again: after a sign-in or a sign-out, and when the minute is up. */
export function refreshSocial(): Promise<void> {
  if (asking) return asking;
  askedAt = Date.now();
  asking = window.api.social.state()
    .then((s) => { if (s && typeof s === 'object') now = s; })
    .catch(() => {})
    .finally(() => { asking = null; tell(); });
  return asking;
}

/** The whole state, as last answered. */
export const social = (): SocialState => now;

export const likeKey = (categoryId: string, m: Pick<Mod, 'name' | '_groupId'>): string => countKey(categoryId, m);
export const likesOf = (key: string): number => Number(now.counts.likes[key]) || 0;
export const liked = (key: string): boolean => now.likes.includes(key);
export const followersOf = (author: string): number => Number(now.counts.followers[author]) || 0;
export const following = (author: string): boolean => now.follows.includes(author);

/** The service's session, through the same sign-in as the title bar's: the browser, then back. */
async function signIn(): Promise<boolean> {
  toast(L`Открыл Discord в браузере — подтверди вход там`, 'ok', 6000);
  const r = await window.api.account.signIn();
  if (r.error) { toast(r.error, 'error', 7000); return false; }
  toast(L`Привет, ${r.account.username}`);
  state.settings = await window.api.settings.get();
  document.dispatchEvent(new Event('mm:account'));
  await refreshSocial();
  return now.signedIn;
}

/** One mark, shown before the service answers and put back if it refuses. */
async function mark(kind: 'like' | 'follow', name: string, on: boolean): Promise<void> {
  if (!now.enabled) return;
  if (!now.signedIn && !await signIn()) return;
  const list = kind === 'like' ? 'likes' : 'follows';
  const counts = kind === 'like' ? 'likes' : 'followers';
  const before = now;
  const was = Number(now.counts[counts][name]) || 0;
  now = {
    ...now,
    [list]: on ? [...now[list].filter((x) => x !== name), name] : now[list].filter((x) => x !== name),
    counts: { ...now.counts, [counts]: { ...now.counts[counts], [name]: Math.max(0, was + (on ? 1 : -1)) } },
  };
  tell();
  let r: { error?: string; count?: number };
  try { r = await window.api.social.mark(kind, name, on); } catch (e) { r = { error: String(e) }; }
  if (r.error || typeof r.count !== 'number') {
    now = before;
    tell();
    toast(r.error || L`Сервис каталога не ответил`, 'error', 6000);
    // an expired session says so here: the next click signs in again
    void refreshSocial();
    return;
  }
  now = { ...now, counts: { ...now.counts, [counts]: { ...now.counts[counts], [name]: r.count } } };
  tell();
}

export const toggleLike = (key: string): Promise<void> => mark('like', key, !liked(key));
export const toggleFollow = (author: string): Promise<void> => mark('follow', author, !following(author));

// signed in or out from the title bar: whose likes these are has changed
document.addEventListener('mm:account', () => {
  if (askedAt) void refreshSocial();
});
