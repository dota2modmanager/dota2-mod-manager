/* A slot's looks as its screen lists them: all of them, narrowed by the search, then by the
 * toolbar (views/catalog/lists.ts filterCosmetics). The grid draws them a page at a time
 * (ui/growing.ts); a cut at 400 here once left 1764 of the game's 2164 loading screens out of
 * reach of the scroll. */
import { cosmeticNameMatches } from '../../ui/cosmetic-name.ts';

export function slotLooks<O extends { name: string }>(
  slot: string, options: O[], q: string, toolbar: (list: { slot: string; o: O }[]) => { slot: string; o: O }[],
): { slot: string; o: O }[] {
  const list = options.map((o) => ({ slot, o }));
  return toolbar(q ? list.filter(({ o }) => cosmeticNameMatches(o.name, q)) : list);
}
