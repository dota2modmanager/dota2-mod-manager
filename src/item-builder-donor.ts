/* Another item's effect on the one worn (issue #383): a hat the user likes, with the particles of
 * the immortal hat they do not.
 *
 * An item's own effects are asset modifiers in its visuals: `particle_create`, a particle the game
 * creates on the item while it is worn, and `particle`, one the item puts in place of a stock
 * effect of the hero (an ability's). The pick wears the donor's modifiers of those two kinds
 * beside its own, and the game loads the particles by their own paths, as it does for the item's
 * own (src/item-builder.ts). A particle the donor hangs on a point of its own model sits where the
 * worn model has that point, or at its root where it has none.
 *
 * The donor rides in the pick's effect string as `from-<id>`, beside the effects and the style
 * (src/item-builder.ts effectKey), so a record, a preset and a link carry it with nothing new. */
import { t } from './i18n.ts';
import { blockBounds, eachChild, findItem } from './schema.ts';

/** The token of a donor in a pick's effect string. */
export const DONOR = /^from-(\d+)$/;

/** The donor's id in an effect string, null for none. */
export function donorOf(key: string): string | null {
  const token = key.split(',').find((id) => DONOR.test(id.trim()));
  return token ? DONOR.exec(token.trim())![1] : null;
}

type Modifier = { text: string; type: string; asset: string; modifier: string };

/** The `particle_create` and `particle` modifiers of a visuals block, each as its text. */
function effectModifiers(visuals: string): Modifier[] {
  const out: Modifier[] = [];
  eachChild(visuals, blockBounds(visuals, 0), (c) => {
    if (!c.isBlock || !/^asset_modifier\d*$/i.test(c.key)) return;
    const f = new Map<string, string>();
    eachChild(visuals, c.body, (x) => { if (!x.isBlock) f.set(x.key.toLowerCase(), x.value); });
    const type = (f.get('type') || '').toLowerCase();
    // one tied to a style other than the first is worn only in that style, which the pick is not in
    if ((type !== 'particle_create' && type !== 'particle') || (f.get('style') || '0') !== '0') return;
    // numbered in most blocks (asset_modifier3): unnumbered, it cannot clash with the worn item's own
    out.push({ text: visuals.slice(c.start, c.end).replace(/^"asset_modifier\d*"/i, '"asset_modifier"'), type, asset: (f.get('asset') || '').toLowerCase(), modifier: (f.get('modifier') || '').toLowerCase() });
  });
  return out;
}

/** Whether an item has an effect another item could wear: what the picker offers as a donor. The
 *  block is looked at first, so the visuals are read only for the few that create a particle. */
export const hasOwnEffect = (block: string, visuals: () => string | null): boolean =>
  /particle_create/i.test(block) && effectModifiers(visuals() || '"visuals"{}').some((m) => m.type === 'particle_create');

/**
 * The visuals with the donor's effects added: each of its particles the worn item does not create
 * already, and each stock effect it replaces that the worn item leaves alone.
 * @throws when the donor is not in the table, or has no effect to give
 */
export function withDonorEffects(baseText: string, visuals: string, donorId: string): string {
  const donor = findItem(baseText, donorId);
  if (!donor) throw new Error(t('items_game: предмет {0} не найден', donorId));
  let donorVisuals = '';
  eachChild(baseText, blockBounds(baseText, donor.start), (c) => {
    if (c.isBlock && c.key.toLowerCase() === 'visuals') donorVisuals = baseText.slice(c.start, c.end);
  });
  const given = donorVisuals ? effectModifiers(donorVisuals) : [];
  if (!given.length) throw new Error(t('У предмета {0} нет своего эффекта', donorId));
  const own = effectModifiers(visuals);
  const created = new Set(own.filter((m) => m.type === 'particle_create').map((m) => m.modifier));
  const replaced = new Set(own.filter((m) => m.type === 'particle').map((m) => m.asset));
  const add = given.filter((m) => (m.type === 'particle_create' ? !created.has(m.modifier) : !replaced.has(m.asset)));
  const close = visuals.lastIndexOf('}');
  if (close === -1 || !add.length) return visuals;
  return `${visuals.slice(0, close).replace(/[ \t\r\n]*$/, '')}\r\n\t${add.map((m) => m.text).join('\r\n\t')}\r\n${visuals.slice(close)}`;
}
