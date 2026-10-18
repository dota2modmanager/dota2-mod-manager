/* What an arcana does in the game once the item builder puts it on, as somebody played it.
 *
 * The builder offers every arcana, and most of them work. Some do not quite: an arcana carries its
 * own animations, and a few of them need things only the real item turns on, so Razor walks facing
 * backwards and Earthshaker can sink into the ground. An arcana that is not known to work carries a
 * note to the slot window, so nobody picks Razor's and goes looking for what they did wrong.
 *
 * The table is J0nathan550's pass through every arcana on 2026-10-15 (pull request #275). A hero
 * here by its id as items_game names it (npc_dota_hero_<id>). An arcana of a hero who is in neither
 * list, one Valve adds later, is not checked yet and says so. Io was offered for the first time in
 * 2.12.0 with all its items marked as not checked; J0nathan550 played them on 2026-10-15 and its
 * arcana, Benevolent Companion, works, so Io joined the arcanas that do.
 *
 * An arcana with a base (src/arcana-bases.ts) carries no note: the base is that arcana compiled
 * again by hand to fix what the table says, and the build takes it. The table stays, for an
 * arcana whose base has not come down yet and for what each base was made to fix.
 *
 * The notes are written in Russian, the app's source language, and translated where they are shown
 * (src/i18n.ts).
 */
import { hasBase } from './arcana-bases.ts';

export type ItemNoteStatus = 'issues' | 'broken' | 'untested';
export interface ItemNote { status: ItemNoteStatus; text: string }

/** Arcanas played and found wanting, by hero. */
export const ARCANA_NOTES: Readonly<Record<string, { status: Exclude<ItemNoteStatus, 'untested'>; note: string }>> = {
  crystal_maiden: { status: 'issues', note: 'Анимации работают с багами' },
  drow_ranger: { status: 'issues', note: 'Берёт анимации бессмертного предмета Mask of Madness и из-за них дёргается' },
  earthshaker: { status: 'issues', note: 'Работает с оговорками: во втором стиле глаза красно-синие, а второй навык с Aghanim\'s зависит от предметов, отданных тотемом, и может провалить героя под землю' },
  juggernaut: { status: 'issues', note: 'Нет второй анимации бега: после покупки сапог всегда бежит с мечом в руке' },
  legion_commander: { status: 'issues', note: 'Выглядит странно, но работает' },
  razor: { status: 'issues', note: 'Ходит развёрнутым на 180°; на втором навыке поворачивается верно, но при атаке крутится не в ту сторону' },
  rubick: { status: 'issues', note: 'Не все способности подменяются верно, анимации работают' },
  skywrath_mage: { status: 'issues', note: 'Почти без ошибок, но в покое может не махать крыльями' },
  spectre: { status: 'issues', note: 'Первый стиль работает. Во втором неверные клинки, не все материалы и не те эффекты атаки; анимации верные' },
  terrorblade: { status: 'issues', note: 'Обычная форма выходит синей, а не красной, и одна анимация неверная' },
  windrunner: { status: 'issues', note: 'Сломан только ультимейт' },
  pudge: { status: 'broken', note: 'Сломана: на текстуре спины артефакты' },
};

/** Arcanas played and found to work, by hero. */
export const ARCANAS_THAT_WORK: ReadonlySet<string> = new Set([
  'faceless_void', 'lina', 'monkey_king', 'ogre_magi', 'phantom_assassin', 'queenofpain', 'nevermore',
  'techies', 'tidehunter', 'vengefulspirit', 'skeleton_king', 'zuus', 'wisp',
]);

/** Heroes none of whose items have been played through the builder yet (none now: Io was the
 *  last, checked on 2026-10-15). A hero offered for the first time goes here until it is played. */
export const HEROES_NOT_CHECKED: ReadonlySet<string> = new Set([]);

const UNTESTED = 'Не проверено в игре';

/**
 * Said of a pick whose model has no stock path to go under: the slot's stock item has no model of
 * its own (Earthshaker's head). The game wears a model after a reconnect only if the server's own
 * item table loaded it, and that table names nothing for the slot, so the pick is an ERROR model
 * from the first reconnect on (src/item-builder.ts withoutFileSwaps, 2026-10-18).
 */
export const UNTIL_RECONNECT = 'Видно только до переподключения к матчу: у стандартного предмета этого слота нет своей модели, и после переподключения игра рисует на её месте ERROR';

/** An option's note with UNTIL_RECONNECT added: on its own as one with issues, after an arcana's own. */
export function untilReconnect(noted: { status: ItemNoteStatus; note: string } | null, text: (ru: string) => string): ItemNote {
  if (!noted) return { status: 'issues', text: text(UNTIL_RECONNECT) };
  return { status: noted.status, text: `${text(noted.note)} ${text(UNTIL_RECONNECT)}` };
}

/** Whether an item's block in items_game says it is an arcana. */
export function isArcanaBlock(block: string): boolean {
  return /"item_rarity"\s+"arcana"/i.test(block);
}

/**
 * The note an item builder option carries, untranslated, or null when it has none.
 * @param heroIds  the item's heroes, as items_game names them without the npc_dota_hero_ prefix
 * @param block    the item's block in items_game
 * @param itemId   the item's id, for whether it has a base
 */
export function itemNote(heroIds: string[], block: string, itemId?: string): { status: ItemNoteStatus; note: string } | null {
  if (heroIds.some((h) => HEROES_NOT_CHECKED.has(h))) return { status: 'untested', note: UNTESTED };
  if (!isArcanaBlock(block)) return null;
  if (itemId && hasBase(itemId)) return null;
  for (const h of heroIds) {
    const known = ARCANA_NOTES[h];
    if (known) return { status: known.status, note: known.note };
  }
  if (heroIds.some((h) => ARCANAS_THAT_WORK.has(h))) return null;
  return { status: 'untested', note: UNTESTED };
}
