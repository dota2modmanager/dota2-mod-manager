/* A hero's window in the item builder (catalog/builder/HeroModal.tsx): what each slot wears, one
 * piece or all of them taken off, the hero's sets, and its saved looks (views/item-looks.ts). Out
 * of views/item-builder.ts, which keeps the slot picker and the window on show. */
import { COSMETIC_PREFIX } from '../core/constants.ts';
import { catName } from '../core/categories.ts';
import { pickedIn } from '../core/installed.ts';
import { showHeroModal } from '../catalog/modal/root.tsx';
import { heroesOf, setIsOn } from '../catalog/builder/logic.ts';
import { loadCosmeticIcons } from '../ui/cosmetic-icons.ts';
import { cosmeticName } from '../ui/cosmetic-name.ts';
import { confirmDialog, promptDialog } from '../ui/dialog.ts';
import { allowItemTable } from '../ui/game-files.ts';
import { toast } from '../ui/toast.ts';
import { openPaint } from './hero-paint.ts';
import { openSets } from './item-sets.ts';
import { afterPick, heroSets, isOpen, itemCosmeticSlots, openItemSlotModal, openWindow, takeOff } from './item-builder.ts';
import { deleteLook, heroKey, lookIsOn, looksOf, renameLook, saveLook, wornPicks } from './item-looks.ts';
import { closeOverlay } from './catalog/overlay.ts';
import type { CosmeticSlot } from '../catalog/types.ts';

const HUB = COSMETIC_PREFIX + 'items';

const heroSlots = (hero: string): CosmeticSlot[] => heroesOf(itemCosmeticSlots()).find(([h]) => h === hero)?.[1] || [];

export function openItemHeroModal(heroName: string, from: Element | null): void {
  const st: HeroState = { heroName, busy: false };
  openWindow(from, false, (key) => drawHero(key, st));
  const slots = heroSlots(heroName);
  const sets = heroSets(heroName);
  loadCosmeticIcons([sets[0]?.name, ...slots.map((s) => pickedIn(s.slot)?.name), ...looksOf(heroKey(slots)).map((l) => l.picks[0]?.name)]
    .filter((n): n is string => !!n), () => {}).catch(() => {});
}

interface HeroState { heroName: string; busy: boolean }

/** The 3D preview is open: it stays so from one hero to the next, as a person who looks once looks again. */
let previewOpen = false;

/** What the 3D preview shows for the hero: each slot's stock item and what is picked on it. */
function heroPreview(slots: CosmeticSlot[]) {
  const hero = slots.find((s) => s.heroIds?.length)?.heroIds?.[0];
  const dressed = slots.filter((s) => s.targetId && !s.persona);
  if (!hero || !dressed.length) return null;
  return {
    hero,
    slots: dressed.map((s) => ({ slot: s.slot, stock: s.targetId as string })),
    sig: dressed.map((s) => { const p = pickedIn(s.slot); return p ? `${p.itemId}:${p.effectId || ''}` : '-'; }).join('|'),
    open: previewOpen,
  };
}

/** The hero's npc name without its prefix (juggernaut), out of the slots' hero ids. */
const heroNpc = (slots: CosmeticSlot[]): string | null => slots.find((s) => s.heroIds?.length)?.heroIds?.[0]?.replace(/^npc_dota_hero_/, '') || null;

function drawHero(key: number, st: HeroState): void {
  const { heroName } = st;
  // read again on every draw: a persona picked or taken off changes which slots the hero has
  const slots = heroSlots(heroName);
  const sets = heroSets(heroName);
  const shown = sets.find((s) => setIsOn(s, pickedIn)) || sets[0];
  const hero = heroKey(slots);
  const again = () => { if (isOpen(key)) drawHero(key, st); };
  // one change at a time, then the window again with what is on
  const busy = async (work: () => Promise<void>) => {
    if (st.busy) return;
    st.busy = true;
    again();
    try { await work(); } finally { st.busy = false; again(); }
  };
  showHeroModal(key, {
    hero: heroName,
    hub: catName(HUB),
    slots: slots.map((s) => ({
      slot: s.slot,
      label: s.slotLabel || s.label || '',
      icon: s.icon || 'checkroom',
      liveName: pickedIn(s.slot)?.name || null,
      options: s.options.length,
    })),
    changed: slots.filter((s) => pickedIn(s.slot)).length,
    busy: st.busy,
    sets: sets.length ? { name: shown.name, count: sets.length, on: sets.some((s) => setIsOn(s, pickedIn)) } : null,
    looks: looksOf(hero).map((l) => ({ id: l.id, name: l.name, count: l.picks.length, picture: l.picks[0]?.name || null, on: lookIsOn(l, slots) })),
    preview: heroPreview(slots),
    paint: heroNpc(slots),
  }, {
    close: closeOverlay,
    togglePreview: () => { previewOpen = !previewOpen; again(); },
    openPaint: () => { const npc = heroNpc(slots); if (npc) void openPaint(npc, heroName, () => openItemHeroModal(heroName, null)); },
    openSets: () => openSets(heroName),
    openSlot: (slot) => openItemSlotModal(slot, null,
      { back: { label: heroName, hero: true, go: () => openItemHeroModal(heroName, null) } }),
    takeOff: (slot) => void busy(() => takeOff(slot)),
    resetAll: () => void busy(async () => {
      const ids = slots.map((s) => pickedIn(s.slot)?.id).filter((id): id is string => !!id);
      if (!ids.length) return;
      const r = await window.api.mods.removeMany(ids);
      if (r.error) { toast(r.error, 'error'); return; }
      toast(L`Вернули как в игре`);
      await afterPick();
    }),
    saveLook: () => void (async () => {
      const picks = wornPicks(slots);
      if (!picks.length) return;
      const name = await promptDialog(L`Как назвать образ?`, { value: L`Образ ${looksOf(hero).length + 1}`, okLabel: L`Сохранить` });
      if (!name) return;
      await saveLook(hero, name, picks);
      toast(L`Образ сохранён: ${name}`);
      again();
    })(),
    wearLook: (id) => void busy(async () => {
      const look = looksOf(hero).find((l) => l.id === id);
      if (!look || !await allowItemTable()) return;
      const r = await window.api.cosmetics.wearLook(hero, look.picks);
      if (r.error) { toast(r.error, 'error'); return; }
      toast(r.applied === r.picks ? L`Надето: ${look.name}` : L`Надето ${r.applied} из ${r.picks}`);
      await afterPick();
    }),
    renameLook: (id) => void (async () => {
      const look = looksOf(hero).find((l) => l.id === id);
      const name = look && await promptDialog(L`Новое название образа`, { value: look.name, okLabel: L`Сохранить` });
      if (!name) return;
      await renameLook(id, name);
      again();
    })(),
    deleteLook: (id) => void (async () => {
      const look = looksOf(hero).find((l) => l.id === id);
      if (!look || !await confirmDialog(L`Удалить образ «${cosmeticName(look.name)}»? Надетые предметы останутся.`)) return;
      await deleteLook(id);
      again();
    })(),
  });
}
