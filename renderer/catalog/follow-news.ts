/* What following an author is for: at the start, once the catalog is in, the app says which mods
 * the people you follow added since you last opened it, and offers their page.
 *
 * "Since" is the time of the last start with the account service on, kept per viewer in
 * localStorage. The first such start only sets it: nothing is new to a list that was never read. */
import type { Mod } from './types.ts';
import { modAuthors, sameName } from './filters.ts';
import { refreshSocial, social } from '../core/social.ts';
import { toast } from '../ui/toast.ts';

const SEEN = 'mm-follow-seen';

function readSeen(): number {
  try { return Number(localStorage.getItem(SEEN)) || 0; } catch { return 0; }
}
function writeSeen(at: number): void {
  try { localStorage.setItem(SEEN, String(at)); } catch { /* private storage: the next start says it again */ }
}

/** The new mods of followed authors among `mods` since `seen`, newest first, each with its author. */
export function newFromFollowed(mods: Mod[], follows: string[], seen: number): { mod: Mod; author: string }[] {
  if (!seen || !follows.length) return [];
  const out: { mod: Mod; author: string }[] = [];
  for (const m of mods) {
    if ((m.meta?.date || 0) <= seen) continue;
    const author = modAuthors(m).find((a) => follows.some((f) => sameName(a, f)));
    if (author) out.push({ mod: m, author });
  }
  return out.sort((a, b) => (b.mod.meta?.date || 0) - (a.mod.meta?.date || 0));
}

/** Once a start, after the catalog loads. */
export async function tellFollowNews(mods: Mod[], openAuthor: (name: string) => void): Promise<void> {
  await refreshSocial();
  const s = social();
  if (!s.enabled) return;
  const seen = readSeen();
  writeSeen(Math.floor(Date.now() / 1000));
  const fresh = newFromFollowed(mods, s.follows, seen);
  if (!fresh.length) return;
  const first = fresh[0];
  const text = fresh.length === 1
    ? L`Новый мод от ${first.author}: ${first.mod.name}`
    : L`Новых модов от тех, на кого ты подписан: ${fresh.length}`;
  toast(text, 'ok', 12000, { label: L`Открыть`, run: () => openAuthor(first.author) });
}
