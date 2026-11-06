/* The motions of the 3D preview's list in words. The game's names are a file's (attack_alt_anim,
 * axe_spawn_loadout) and say nothing in another language, so the words come from what a sequence is
 * for: its activity, with the modifier that tells it from its neighbours, numbered when several are
 * the same thing (a hero has two or three swings). A modifier is an item's or an event's name
 * (ti8, whalehook): those stay as the game writes them. */

type Named = { name: string; act: string; mods: string[] };

/** An activity without its prefix, the last number split off when it is an ability's. */
export function motionAct(act: string): { act: string; ability: string | null } {
  const short = act.replace(/^ACT_DOTA_/, '');
  const ability = /^(?:CAST|OVERRIDE|CHANNEL)_ABILITY_(\d)/.exec(short)?.[1] ?? null;
  return { act: short.replace(/^ATTACK\d$/, 'ATTACK').replace(/_\d$/, ''), ability };
}

/** A sequence's own name as a label: the file's "_anim" off the end. */
const fileLabel = (name: string) => {
  const text = name.replace(/_anim$/, '').replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/**
 * A label for each motion, in their order.
 * @param word  the activity in the window's language, or null to fall back on the file's name
 */
export function motionLabels(motions: Named[], word: (act: string, ability: string | null) => string | null): string[] {
  const plain = motions.map((m) => {
    const { act, ability } = motionAct(m.act);
    const w = word(act, ability);
    return w ? (m.mods.length ? `${w} (${m.mods.join(', ')})` : w) : fileLabel(m.name);
  });
  const seen = new Map<string, number>();
  const total = new Map<string, number>();
  for (const l of plain) total.set(l, (total.get(l) || 0) + 1);
  return plain.map((l) => {
    if ((total.get(l) || 0) < 2) return l;
    const n = (seen.get(l) || 0) + 1;
    seen.set(l, n);
    return `${l} ${n}`;
  });
}
