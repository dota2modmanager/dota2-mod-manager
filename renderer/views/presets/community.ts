/* The community presets on the Presets screen: the cards worked out of what community:list
 * answers, and what the buttons on them do. Drawn by presets/CommunitySection.tsx; the rules of
 * the search and the orders are presets/community.ts. */
import { catName, catIcon } from '../../core/categories.ts';
import { cosmeticName } from '../../ui/cosmetic-name.ts';
import { catalogName } from '../../ui/catalog-name.ts';
import { fmtDate, plural } from '../../ui/format.ts';
import { toast } from '../../ui/toast.ts';
import { confirmDialog, promptDialog } from '../../ui/dialog.ts';
import { recThumb } from '../../library/thumbs.ts';
import type { LibRecord } from '../../library/types.ts';
import type { Thumb } from '../../library/model.ts';
import { insideModel, lookEntry, lookGroup } from './inside.ts';
import { fold, needsTable, nextVote, revote } from '../../presets/community.ts';
import type { CommunityModel, CommunityPreset, PresetsActions } from '../../presets/model.ts';
import type { CommunityShare } from './share.ts';
import type { CommunityList, CommunityPresetRecord, PresetRecord } from '../../api/content.ts';

const STRIP = 12;

let list: CommunityList | null = null;
let loading = false;
/** refreshed once per visit to the screen, not at every repaint */
let fetchedAt = 0;
const FRESH_MS = 60 * 1000;


function card(p: CommunityPresetRecord, presets: PresetRecord[]): CommunityPreset {
  const groups = new Map<string, string[]>();
  const thumbs: Thumb[] = [];
  for (const m of p.mods) {
    const id = m.kind === 'cosmetic' ? lookGroup(m.slot) : m.categoryId;
    const name = m.kind === 'cosmetic' ? cosmeticName(m.name) : m.name;
    groups.set(id, [...(groups.get(id) || []), name]);
    thumbs.push(m.kind === 'cosmetic' ? { key: m.name, icon: catIcon(id) } as Thumb : recThumb({ ...m, id: '', files: [] } as unknown as LibRecord));
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const cat = (id: string, n: number) => ({ id, icon: catIcon(id), name: catName(id), n });
  const own = p.taken ? presets.find((x) => x.id === p.taken!.id) : null;
  const taken = !own ? null : own.wanted ? 'wanted' : own.on === 'active' ? 'on' : 'own';
  const created = Date.parse(p.created);
  const n = p.mods.length;
  return {
    id: p.id,
    name: p.name,
    about: p.about,
    author: p.author.name,
    date: Number.isFinite(created) ? fmtDate(created / 1000) : '',
    created: p.created,
    up: p.up,
    down: p.down,
    vote: p.vote,
    mine: p.mine,
    count: `${n} ${plural(n, 'мод', 'мода', 'модов')}`,
    strip: thumbs.slice(0, STRIP),
    rest: Math.max(0, thumbs.length - STRIP),
    cats: ordered.map(([id, names]) => cat(id, names.length)),
    inside: insideModel(p.mods.map((m) => (m.kind === 'cosmetic'
      ? lookEntry(m.slot, m.name)
      : { kind: 'mod' as const, categoryId: m.categoryId, data: { name: m.name, thumb: recThumb({ ...m, id: '', files: [] } as unknown as LibRecord) } }))),
    taken,
    table: needsTable(p.mods.flatMap((m) => (m.kind === 'cosmetic' ? [m.slot] : []))),
    // the names as the catalog shows them in this language and as they are, so both find it
    haystack: fold([p.name, p.about, p.author.name, ...ordered.flatMap(([id, names]) => [catName(id), ...names, ...names.map((n) => catalogName(n))])].join(' ')),
  };
}

/** The section's model; null when this build shows no community presets. */
export function communityModel(presets: PresetRecord[]): CommunityModel | null {
  if (list && !list.configured) return null;
  return {
    user: list?.user ? { name: list.user.name } : null,
    presets: (list?.presets || []).map((p) => card(p, presets)),
    error: list?.error || null,
    loading,
  };
}

/** The list as kept, at once; then, at most once a minute or when asked, a fresh one with `repaint` after it. */
export async function loadCommunity(repaint: () => void, force = false): Promise<void> {
  if (!list) list = await window.api.community.list(false).catch(() => null);
  if (!list?.configured || loading || (!force && Date.now() - fetchedAt < FRESH_MS)) return;
  loading = true;
  fetchedAt = Date.now();
  window.api.community.list(true).then((fresh) => { list = fresh; }).catch(() => {}).finally(() => {
    loading = false;
    repaint();
  });
}

/** Where a preset of yours stands with the community presets, for the share window. */
export function communityShare(p: PresetRecord): CommunityShare {
  if (!list?.configured) return 'off';
  if (p.source?.published) return 'published';
  return list.user ? 'ready' : 'signed-out';
}

/** Put a preset of yours up, with a few words about it: asked here unless the share window asked. */
export async function publishPreset(p: PresetRecord, repaint: () => Promise<void>, given?: string): Promise<void> {
  if (!list?.user) {
    // signing in is a browser trip; the publish it was for carries on after it
    toast(L`Открываю Discord в браузере…`);
    const r = await window.api.community.signIn();
    if (r.error) { toast(r.error, 'error', 7000); return; }
    list = await window.api.community.list(false).catch(() => list);
    if (!list?.user) return;
  }
  const about = given ?? await promptDialog(L`Пара слов о пресете для тех, кто его найдёт (можно пусто)`, { value: '', okLabel: L`Опубликовать` });
  if (about === null) return;
  const r = await window.api.community.publish(p.id, about);
  if (r.error) { toast(r.error, 'error', 7000); return; }
  toast(r.skipped?.length
    ? L`Опубликовано · свои моды (${r.skipped.length}) в пресет сообщества не попали. Появится в списке через минуту-две`
    : L`Опубликовано — появится в списке через минуту-две`, 'ok', 7000);
  fetchedAt = 0;
  await repaint();
}

export async function unpublishPreset(id: string, repaint: () => Promise<void>): Promise<void> {
  if (!await confirmDialog(L`Снять пресет с публикации? Его лайки пропадут.`, { okLabel: L`Снять с публикации` })) return;
  const r = await window.api.community.unpublish(id);
  if (r.error) { toast(r.error, 'error', 6000); return; }
  if (list) list = { ...list, presets: list.presets.filter((p) => p.id !== id) };
  toast(L`Пресет снят с публикации`);
  await repaint();
}

/** What the section's buttons do; `after` repaints the screen, `installed` refreshes what is installed first. */
export function communityActions(repaint: () => Promise<void>, installed: () => Promise<void>): PresetsActions['community'] {
  return {
    signIn: async () => {
      toast(L`Открываю Discord в браузере…`);
      const r = await window.api.community.signIn();
      if (r.error) { toast(r.error, 'error', 7000); return; }
      toast(L`Вошёл как ${r.user?.name || ''}`, 'ok');
      list = null;
      fetchedAt = 0;
      await repaint();
    },
    signOut: async () => {
      await window.api.community.signOut();
      if (list) list = { ...list, user: null, votes: {}, presets: list.presets.map((p) => ({ ...p, vote: 0, mine: false })) };
      await repaint();
    },
    vote: async (id, pressed) => {
      if (!list?.user) { toast(L`Войди через Discord, чтобы оценивать`, 'warn'); return; }
      const p = list.presets.find((x) => x.id === id);
      if (!p) return;
      const was = p.vote;
      const now = nextVote(was, pressed);
      // the counts move at once; the index catches up within a minute or two
      const apply = (from: number, to: number) => {
        list = list && { ...list, presets: list.presets.map((x) => (x.id === id ? { ...x, ...revote(x, from, to), vote: to } : x)) };
      };
      apply(was, now);
      await repaint();
      const r = await window.api.community.vote(id, now);
      if (r.error) {
        apply(now, was);
        toast(r.error, 'error', 6000);
        await repaint();
      }
    },
    take: async (id) => {
      const r = await window.api.community.take(id);
      if (r.error) toast(r.error, 'error', 7000);
      else {
        toast(r.installed ? L`Пресет применён · установлено ${r.installed} ${plural(r.installed, 'мод', 'мода', 'модов')}` : L`Пресет применён`);
        for (const err of (r.errors || []).slice(0, 3)) toast(err, 'warn', 7000);
      }
      list = await window.api.community.list(false).catch(() => list);
      await installed();
      await repaint();
    },
    unpublish: (id) => { unpublishPreset(id, repaint); },
    refresh: () => { loadCommunity(() => { repaint(); }, true); repaint(); },
  };
}
