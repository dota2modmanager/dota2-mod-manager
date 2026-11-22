/* The community presets on the Presets screen: the cards worked out of what community:list
 * answers, and what the buttons on them do. They live on the catalog's account service, with the
 * likes and follows (core/social.ts), and the sign-in is the same one the title bar makes. Drawn
 * by presets/CommunitySection.tsx; the rules of the search and the orders are presets/community.ts. */
import { catName, catIcon } from '../../core/categories.ts';
import { state } from '../../core/store.ts';
import { refreshSocial } from '../../core/social.ts';
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
/** refreshed at most once a minute, the service's own edge cache */
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
  const n = p.mods.length;
  return {
    id: p.id,
    name: p.name,
    about: p.about,
    author: p.author,
    date: p.created ? fmtDate(p.created) : '',
    // zero-padded so the order of the strings is the order of the times
    created: String(p.created || 0).padStart(12, '0'),
    up: p.likes,
    down: p.dislikes,
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
    haystack: fold([p.name, p.about, p.author, ...ordered.flatMap(([id, names]) => [catName(id), ...names, ...names.map((x) => catalogName(x))])].join(' ')),
  };
}

/** The section's model; null while the catalog's account service is off. */
export function communityModel(presets: PresetRecord[]): CommunityModel | null {
  if (!list?.enabled) return null;
  const name = state.settings?.account?.username;
  return {
    user: list.signedIn ? { name: name || L`ты` } : null,
    canVote: !list.signedIn || list.canPublish !== false,
    moderator: !!list.moderator,
    presets: list.presets.map((p) => card(p, presets)),
    error: list.error || null,
    loading,
  };
}

/** The list as kept, at once; then, at most once a minute or when asked, a fresh one with `repaint` after it. */
export async function loadCommunity(repaint: () => void, force = false): Promise<void> {
  if (!list) list = await window.api.community.list(false).catch(() => null);
  if (!list?.enabled || loading || (!force && Date.now() - fetchedAt < FRESH_MS)) return;
  loading = true;
  fetchedAt = Date.now();
  window.api.community.list(true).then((fresh) => { list = fresh; }).catch(() => {}).finally(() => {
    loading = false;
    repaint();
  });
}

/** The title bar's sign-in, through the catalog's account service: the same session the likes use. */
async function signIn(): Promise<boolean> {
  toast(L`Открыл Discord в браузере — подтверди вход там`, 'ok', 6000);
  const r = await window.api.account.signIn();
  if (r.error) { toast(r.error, 'error', 7000); return false; }
  toast(L`Привет, ${r.account.username}`);
  state.settings = await window.api.settings.get();
  document.dispatchEvent(new Event('mm:account'));
  void refreshSocial();
  list = await window.api.community.list(true).catch(() => list);
  fetchedAt = Date.now();
  return !!list?.signedIn;
}

const tooNew = () => toast(L`Аккаунт Discord слишком новый: оценивать и публиковать можно с аккаунта старше двух недель`, 'warn', 7000);

/** Where a preset of yours stands with the community presets, for the share window. */
export function communityShare(p: PresetRecord): CommunityShare {
  if (!list?.enabled) return 'off';
  if (p.source?.published && list.presets.some((x) => x.id === p.source!.published)) return 'published';
  return list.signedIn ? 'ready' : 'signed-out';
}

/** Put a preset of yours up, with a few words about it: asked here unless the share window asked. */
export async function publishPreset(p: PresetRecord, repaint: () => Promise<void>, given?: string): Promise<void> {
  if (!list?.signedIn && !await signIn()) return;
  if (list?.canPublish === false) { tooNew(); return; }
  const about = given ?? await promptDialog(L`Пара слов о пресете для тех, кто его найдёт (можно пусто)`, { value: '', okLabel: L`Опубликовать` });
  if (about === null) return;
  const r = await window.api.community.publish(p.id, about);
  if (r.error) { toast(r.error, 'error', 7000); return; }
  toast(r.skipped?.length
    ? L`Опубликовано · свои моды (${r.skipped.length}) в пресет сообщества не попали — их нет в каталоге`
    : L`Опубликовано в «Пресетах сообщества»`, 'ok', 7000);
  list = await window.api.community.list(true).catch(() => list);
  fetchedAt = Date.now();
  await repaint();
}

/** Take a preset down: your own, or as a moderator somebody else's. */
export async function unpublishPreset(id: string, repaint: () => Promise<void>, theirs = false): Promise<void> {
  const ask = theirs ? L`Скрыть этот пресет из «Пресетов сообщества»?` : L`Снять пресет с публикации? Его лайки пропадут.`;
  if (!await confirmDialog(ask, { okLabel: theirs ? L`Скрыть` : L`Снять с публикации` })) return;
  const r = await window.api.community.unpublish(id);
  if (r.error) { toast(r.error, 'error', 6000); return; }
  if (list) list = { ...list, presets: list.presets.filter((p) => p.id !== id) };
  toast(theirs ? L`Пресет скрыт` : L`Пресет снят с публикации`);
  await repaint();
}

/** What the section's buttons do; `repaint` redraws the screen, `installed` refreshes what is installed first. */
export function communityActions(repaint: () => Promise<void>, installed: () => Promise<void>): PresetsActions['community'] {
  return {
    signIn: async () => { if (await signIn()) await repaint(); },
    vote: async (id, pressed) => {
      if (!list?.signedIn && !await signIn()) return;
      if (list?.canPublish === false) { tooNew(); return; }
      const p = list?.presets.find((x) => x.id === id);
      if (!p) return;
      const was = p.vote;
      const now = nextVote(was, pressed);
      const set = (patch: Partial<CommunityPresetRecord>) => {
        list = list && { ...list, presets: list.presets.map((x) => (x.id === id ? { ...x, ...patch } : x)) };
      };
      // the counts move at once, and take the service's answer when it comes
      const moved = revote({ up: p.likes, down: p.dislikes }, was, now);
      set({ likes: moved.up, dislikes: moved.down, vote: now });
      await repaint();
      const r = await window.api.community.vote(id, now);
      if (r.error) {
        set({ likes: p.likes, dislikes: p.dislikes, vote: was });
        toast(r.error, 'error', 6000);
      } else {
        set({ likes: r.likes, dislikes: r.dislikes, vote: r.vote });
      }
      await repaint();
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
    unpublish: (id) => {
      const theirs = !list?.presets.find((x) => x.id === id)?.mine;
      void unpublishPreset(id, repaint, theirs);
    },
    refresh: () => { void loadCommunity(() => { void repaint(); }, true); void repaint(); },
  };
}

// signed in or out from the title bar: whose votes and presets these are has changed
document.addEventListener('mm:account', () => {
  if (!list?.enabled) return;
  void window.api.community.list(true).then((fresh) => { list = fresh; fetchedAt = Date.now(); }).catch(() => {});
});
