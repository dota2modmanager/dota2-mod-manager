/* A hero's window in the item builder (catalog/builder/HeroModal.tsx), laid out as the game's own
 * loadout: the hero on the left, its tabs down the middle (its sets, each slot with what is on it,
 * the looks saved for it), and what the tab offers on the right. A slot's pane is
 * views/item-builder.ts, the sets' views/item-sets.ts, the looks views/item-looks.ts. Every way
 * into the builder opens this window: a hero from the hub, a slot's card found by the catalog's
 * search, a set.
 *
 * It used to be three windows, each opening the next with a way back, and the hero's own one a
 * column of rows that ran past the bottom of the screen once the 3D view was on. */
import { gemSetOf } from '../catalog/builder/gems.ts';
import { state } from '../core/store.ts';
import { firstCosmeticSlots, pickedIn } from '../core/installed.ts';
import { showHeroModal } from '../catalog/modal/root.tsx';
import { heroesOf, setIsOn } from '../catalog/builder/logic.ts';
import { loadCosmeticIcons } from '../ui/cosmetic-icons.ts';
import { cosmeticName } from '../ui/cosmetic-name.ts';
import { confirmDialog, promptDialog } from '../ui/dialog.ts';
import { toast } from '../ui/toast.ts';
import { openPaint, type PaintPreview } from './hero-paint.ts';
import { loadSetIcons, setsPane, type SetsState } from './item-sets.ts';
import { afterPick, heroSets, isOpen, itemCosmeticSlots, openWindow, slotPane, slotState, takeOff, tryOnPick, type SlotState } from './item-builder.ts';
import { deleteLook, heroKey, lookIsOn, looksOf, renameLook, saveLook, wornPicks } from './item-looks.ts';
import { heroPortrait } from './item-hub.ts';
import { closeOverlay } from './catalog/overlay.ts';
import type { CosmeticSlot } from '../catalog/types.ts';
import type { HeroPane, HeroTab } from '../catalog/builder/model.ts';

const heroSlots = (hero: string): CosmeticSlot[] => heroesOf(itemCosmeticSlots()).find(([h]) => h === hero)?.[1] || [];

interface HeroState { heroName: string; busy: boolean; tab: HeroTab; slot: SlotState | null; sets: SetsState }

/** The tab a hero's window was left on, for the next hero: a person going through sets keeps going through sets. */
let lastTab: 'sets' | 'looks' | 'slot' = 'sets';

/**
 * @param opts.slot  open on this slot's tab, with `query` typed into its search and `select` chosen
 */
export function openItemHeroModal(heroName: string, from: Element | null, opts: { slot?: string; query?: string; select?: string; view?: 'gems' } = {}): void {
  const slots = heroSlots(heroName);
  const sets = heroSets(heroName);
  const first = slots[0]?.slot || 'looks';
  const tab = opts.slot || (lastTab === 'sets' && sets.length ? 'sets' : lastTab === 'looks' ? 'looks' : first);
  const st: HeroState = { heroName, busy: false, tab, slot: null, sets: { query: '', set: null } };
  if (tab !== 'sets' && tab !== 'looks') st.slot = slotState(tab, opts);
  if (tab === 'sets') loadSetIcons(heroName);
  openWindow(from, true, (key) => drawHero(key, st));
  loadCosmeticIcons([...slots.map((s) => pickedIn(s.slot)?.name), ...looksOf(heroKey(slots)).flatMap((l) => l.picks.map((p) => p.name))]
    .filter((n): n is string => !!n), () => {}).catch(() => {});
}

/** Open the same item the Workshop recolors, with the 3D view visible. */
export async function openBuilderGems(set: string, from: Element | null): Promise<boolean> {
  if (!itemCosmeticSlots().length) await firstCosmeticSlots();
  for (const [hero, slots] of heroesOf(itemCosmeticSlots())) {
    for (const slot of slots) {
      const item = slot.options.find(option => gemSetOf(option.name) === set);
      if (!item) continue;
      previewOpen = true;
      openItemHeroModal(hero, from, { slot: slot.slot, select: item.id, view: 'gems' });
      return true;
    }
  }
  return false;
}

/** A slot's card from the catalog's search or favourites: its hero's window, on that slot. */
export function openItemSlotModal(slot: string, from: Element | null, opts: { query?: string; select?: string } = {}): void {
  const hero = heroesOf(itemCosmeticSlots()).find(([, slots]) => slots.some((s) => s.slot === slot))?.[0];
  if (hero) openItemHeroModal(hero, from, { slot, ...opts });
}

/** The 3D view is open: the stage's default, as the game's loadout shows the hero; turned off, it stays
 *  off from one hero to the next, for a machine it is slow on. */
let previewOpen = true;

/** The hero and slot whose options were exported ahead this run, once each. */
const prefetched = new Set<string>();

/** A slot's options exported in the background while the 3D view is on, so trying one on finds its model ready. */
function prefetchSlot(slots: CosmeticSlot[], tab: string): void {
  const preview = previewOpen ? heroPreview(slots, null) : null;
  const slot = slots.find((s) => s.slot === tab);
  if (!preview || !slot?.options.length || prefetched.has(`${preview.hero}|${tab}`)) return;
  prefetched.add(`${preview.hero}|${tab}`);
  void window.api.preview3d.prefetch(preview.hero, preview.slots, tab, slot.options.map((o) => o.id).filter(Boolean)).catch(() => 0);
}

/** What the 3D preview shows for the hero: each slot's stock item and what is picked on it. */
function heroPreview(slots: CosmeticSlot[], active: SlotState | null) {
  const hero = slots.find((s) => s.heroIds?.length)?.heroIds?.[0];
  // a persona's slots too: picked, it is the body, and its slots dress it (src/hero-preview.ts); not
  // the ability effects slots, whose stock item has no model and whose picks bring none
  const dressed = slots.filter((s) => s.targetId && !s.abilityFx);
  if (!hero || !dressed.length) return null;
  const tryOn = tryOnPick(active);
  const previewSlots = dressed.map(s => ({
    slot: s.slot, stock: s.targetId as string, ...(s.slot === active?.slot && tryOn ? { tryOn } : {}),
  }));
  const pick = (slot: typeof previewSlots[number]) => slot.tryOn ?? pickedIn(slot.slot);
  return {
    hero,
    slots: previewSlots,
    sig: JSON.stringify(previewSlots.map(s => [s.slot, s.stock, pick(s)?.itemId ?? '', pick(s)?.effectId ?? ''])),
    open: previewOpen,
    gemSlots: Object.fromEntries(previewSlots.flatMap((s, i) => {
      const item = pick(s);
      const set = gemSetOf(dressed[i].options.find(o => o.id === item?.itemId)?.name);
      return set ? [[set, s.slot]] : [];
    })),
  };
}

/** What the recolour window shows the hero in: what each slot wears now, and that item's id. */
function paintPreview(slots: CosmeticSlot[]): PaintPreview | null {
  const p = heroPreview(slots, null);
  if (!p) return null;
  return { hero: p.hero, slots: p.slots, sig: p.sig, items: Object.fromEntries(p.slots.map((s) => [s.slot, String(pickedIn(s.slot)?.itemId || s.stock)])) };
}

/** The hero's npc name without its prefix (juggernaut), out of the slots' hero ids. */
const heroNpc = (slots: CosmeticSlot[]): string | null => slots.find((s) => s.heroIds?.length)?.heroIds?.[0]?.replace(/^npc_dota_hero_/, '') || null;

function drawHero(key: number, st: HeroState): void {
  const { heroName } = st;
  // read again on every draw: a persona picked or taken off changes which slots the hero has
  const slots = heroSlots(heroName);
  const sets = heroSets(heroName);
  const hero = heroKey(slots);
  const again = () => { if (isOpen(key)) drawHero(key, st); };
  // one change at a time, then the window again with what is on
  const busy = async (work: () => Promise<void>) => {
    if (st.busy) return;
    st.busy = true;
    again();
    try { await work(); } finally { st.busy = false; again(); }
  };
  const goSlot = (slot: string, select = '') => {
    st.tab = slot;
    st.slot = slotState(slot, { select });
    lastTab = 'slot';
    again();
  };
  // a slot the hero lost (a persona taken off) leaves its tab for the first one
  if (st.tab !== 'sets' && st.tab !== 'looks' && !slots.some((s) => s.slot === st.tab)) {
    st.tab = sets.length ? 'sets' : slots[0]?.slot || 'looks';
    st.slot = st.tab === 'sets' || st.tab === 'looks' ? null : slotState(st.tab);
  }
  const looks = looksOf(hero);
  let pane: HeroPane;
  if (st.tab === 'sets') pane = setsPane(heroName, st.sets, again, goSlot);
  else if (st.tab === 'looks') {
    pane = {
      kind: 'looks',
      looks: looks.map((l) => ({ id: l.id, name: l.name, pictures: l.picks.map((p) => p.name).filter(Boolean), on: lookIsOn(l, slots) })),
      canSave: slots.some((s) => pickedIn(s.slot)) && !looks.some((l) => lookIsOn(l, slots)),
    };
  } else {
    const p = st.slot && slotPane(st.slot, again);
    if (p) {
      const choose = p.actions.choose;
      p.actions.choose = id => { previewOpen = true; choose(id); };
      const view = p.actions.view;
      p.actions.view = tab => { if (tab === 'gems') previewOpen = true; view(tab); };
    }
    pane = p ? { kind: 'slot', ...p } : { kind: 'looks', looks: [], canSave: false };
  }
  const worn = sets.find((s) => setIsOn(s, pickedIn));
  prefetchSlot(slots, st.tab);
  showHeroModal(key, {
    hero: heroName,
    portrait: heroPortrait(heroName),
    attr: state.heroAttrs?.[slots[0]?.heroIds?.[0] || ''] || '',
    tab: st.tab,
    slots: slots.map((s) => ({
      slot: s.slot,
      label: s.slotLabel || s.label || '',
      icon: s.icon || 'checkroom',
      liveName: pickedIn(s.slot)?.name || null,
      options: s.options.length,
    })),
    changed: slots.filter((s) => pickedIn(s.slot)).length,
    busy: st.busy,
    sets: sets.length ? { count: sets.length, on: worn ? worn.name : null } : null,
    looks: looks.length,
    preview: heroPreview(slots, st.slot),
    paint: heroNpc(slots),
    pane,
  }, {
    close: closeOverlay,
    tab: (tab) => {
      if (tab === st.tab && tab !== 'sets') return;
      if (tab === 'sets') { st.sets.set = null; lastTab = 'sets'; loadSetIcons(heroName); }
      if (tab === 'looks') lastTab = 'looks';
      if (tab === 'sets' || tab === 'looks') { st.tab = tab; st.slot = null; again(); } else goSlot(tab);
    },
    togglePreview: () => { previewOpen = !previewOpen; again(); },
    openPaint: () => { const npc = heroNpc(slots); if (npc) void openPaint(npc, heroName, () => openItemHeroModal(heroName, null), paintPreview(slots)); },
    takeOff: (slot) => void busy(async () => {
      await takeOff(slot);
      // the slot's pane starts again from what is on now: the stock item
      if (st.slot?.slot === slot) st.slot = slotState(slot);
    }),
    resetAll: () => void busy(async () => {
      const ids = slots.map((s) => pickedIn(s.slot)?.id).filter((id): id is string => !!id);
      if (!ids.length) return;
      const r = await window.api.mods.removeMany(ids);
      if (r.error) { toast(r.error, 'error'); return; }
      toast(L`Вернули как в игре`);
      await afterPick();
      if (st.slot) st.slot = slotState(st.slot.slot);
    }),
    saveLook: () => void (async () => {
      const picks = wornPicks(slots);
      if (!picks.length) return;
      const name = await promptDialog(L`Как назвать образ?`, { value: L`Образ ${looks.length + 1}`, okLabel: L`Сохранить` });
      if (!name) return;
      await saveLook(hero, name, picks);
      toast(L`Образ сохранён: ${name}`);
      again();
    })(),
    wearLook: (id) => void busy(async () => {
      const look = looks.find((l) => l.id === id);
      if (!look) return;
      const r = await window.api.cosmetics.wearLook(hero, look.picks);
      if (r.error) { toast(r.error, 'error'); return; }
      toast(r.applied === r.picks ? L`Надето: ${look.name}` : L`Надето ${r.applied} из ${r.picks}`);
      await afterPick();
    }),
    renameLook: (id) => void (async () => {
      const look = looks.find((l) => l.id === id);
      const name = look && await promptDialog(L`Новое название образа`, { value: look.name, okLabel: L`Сохранить` });
      if (!name) return;
      await renameLook(id, name);
      again();
    })(),
    deleteLook: (id) => void (async () => {
      const look = looks.find((l) => l.id === id);
      if (!look || !await confirmDialog(L`Удалить образ «${cosmeticName(look.name)}»? Надетые предметы останутся.`)) return;
      await deleteLook(id);
      again();
    })(),
  });
}
