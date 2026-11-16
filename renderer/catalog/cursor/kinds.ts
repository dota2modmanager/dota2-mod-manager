/* The cursors of the game the own-cursor window knows (crates/mm-core/src/looks/cursor_maker.rs
 * reads which the game has): their names in the window and the group each stands in. */

export type Group = 'pointer' | 'attack' | 'spell' | 'shop' | 'menu' | 'other';

export interface CursorKind {
  name: string;
  label: string;
  group: Group;
}

export const GROUPS: { id: Group; title: () => string }[] = [
  { id: 'pointer', title: () => L`Указатель` },
  { id: 'attack', title: () => L`Атака` },
  { id: 'spell', title: () => L`Способности` },
  { id: 'shop', title: () => L`Магазин и предметы` },
  { id: 'menu', title: () => L`Меню` },
  { id: 'other', title: () => L`Остальное` },
];

const K = (name: string, label: () => string, group: Group) => ({ name, label, group });

const TABLE = [
  K('cursor_default', () => L`Обычный`, 'pointer'),
  K('cursor_default_enemy', () => L`На враге`, 'pointer'),
  K('cursor_default_team', () => L`На союзнике`, 'pointer'),
  K('cursor_move', () => L`Приказ идти`, 'pointer'),
  K('cursor_learn_ability', () => L`Изучить способность`, 'pointer'),
  K('cursor_attack_default', () => L`Атака`, 'attack'),
  K('cursor_attack_enemy', () => L`Атака по врагу`, 'attack'),
  K('cursor_attack_team', () => L`Атака по союзнику`, 'attack'),
  K('cursor_attack_illegal', () => L`Атаковать нельзя`, 'attack'),
  K('cursor_spell_default', () => L`Прицел способности`, 'spell'),
  K('cursor_spell_enemy', () => L`Прицел на враге`, 'spell'),
  K('cursor_spell_team', () => L`Прицел на союзнике`, 'spell'),
  K('cursor_spell_illegal', () => L`Применить нельзя`, 'spell'),
  K('cursor_spell_walkto', () => L`Подойти и применить`, 'spell'),
  K('cursor_buy', () => L`Купить`, 'shop'),
  K('cursor_cannot_buy', () => L`Купить нельзя`, 'shop'),
  K('cursor_item_drop', () => L`Выбросить предмет`, 'shop'),
  K('cursor_db_default', () => L`В меню`, 'menu'),
  K('cursor_db_default_highlight', () => L`В меню, на кнопке`, 'menu'),
  K('cursor_db_ibeam', () => L`Ввод текста`, 'menu'),
  K('cursor_hand_open', () => L`Рука`, 'other'),
  K('cursor_hand_closed', () => L`Рука, схватил`, 'other'),
  K('cursor_coach', () => L`Тренер`, 'other'),
];

/** The game's cursors in the window's order: the known ones as the table has them, then any the
 * table does not know, under their file name. */
export function kindsOf(names: string[]): CursorKind[] {
  const known = TABLE.filter((k) => names.includes(k.name)).map((k) => ({ ...k, label: k.label() }));
  const rest = names.filter((n) => !TABLE.some((k) => k.name === n)).sort()
    .map((name) => ({ name, label: name.replace(/^cursor_/, '').replace(/_/g, ' '), group: 'other' as const }));
  return [...known, ...rest];
}

/** A set's folder (valve/ti9, workshop/bts3_cursor_pack) as a name to read. */
export function packName(id: string): string {
  const leaf = id.split('/').pop() ?? id;
  const words = leaf.replace(/_?(cursor_pack|cursors?)$/i, '').split('_').filter(Boolean);
  return words.map((w) => (/^(ti\d+|bts\d*|pw|sltv|dc)$/i.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ') || leaf;
}
