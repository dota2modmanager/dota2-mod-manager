/* What is wrong with an installed mod, said in its window (plan item 2): the catalog card shows
 * "installed" either way, and a person who opens the window to ask why it does not work in the game
 * should not have to find the same mod in My mods and read its pills. One line each, the reason a
 * mod would not show first, with the one thing to do about it. */
import { catalogName } from '../../ui/catalog-name.ts';
import type { LibRecord } from '../../library/types.ts';

/** One thing the window says about the record: a switch to turn it on, or the way to My mods. */
export interface ModState { key: 'off' | 'covered' | 'schema' | 'prePatch'; icon: string; text: string; act: 'enable' | 'library' | null }

type Rec = Pick<LibRecord, 'enabled' | 'coveredBy' | 'schemaCount' | 'schemaLive' | 'prePatch'>;

/** What the window says about `rec`, in the order to deal with it; empty when nothing is wrong. */
export function modStates(rec: Rec | null | undefined): ModState[] {
  if (!rec) return [];
  if (rec.enabled === false) {
    return [{ key: 'off', icon: 'toggle_off', text: L`Мод установлен, но выключен в «Моих модах»: в игре его нет.`, act: 'enable' }];
  }
  const out: ModState[] = [];
  const by = rec.coveredBy ?? [];
  if (by.length) {
    const who = by.map((c) => `«${catalogName(c.name)}»`).join(', ');
    out.push({ key: 'covered', icon: 'layers', act: 'library',
      text: L`Часть его файлов игра берёт из другого мода: ${who}. Побеждает тот, что выше в «Моих модах»: подними этот мод над ним.` });
  }
  if (rec.schemaCount && !rec.schemaLive) {
    out.push({ key: 'schema', icon: 'auto_awesome', act: 'library',
      text: L`Эффекты и иконки этого мода появятся, когда включена таблица предметов: в игре сейчас стоит только модель.` });
  }
  const pre = rec.prePatch;
  if (pre && (pre.changed || pre.removed)) {
    out.push({ key: 'prePatch', icon: 'history', act: null,
      text: L`Dota обновилась и поменяла файлы, которые подменяет этот мод. Если в игре он выглядит не так, автору пора его пересобрать.` });
  }
  return out;
}
