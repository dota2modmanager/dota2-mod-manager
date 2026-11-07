/**
 * The game's unusual and ethereal effects, read out of items_game.txt (issue #393). An owned
 * courier, ward or weapon with such an effect carries a number in its attributes, which the Game
 * Coordinator sends and a mod cannot change. The table says what each number draws: its
 * "attribute_controlled_attached_particles" section maps it to a particle system and how that
 * particle attaches ("rootbone_follow", or control points on named attachments). The names
 * players know ("Ethereal Flame") are in dota_english.txt as Attrib_Particle<number>.
 *
 * With this a file mod can draw the effect itself: the particle goes in as a child of a particle
 * the item always plays, the way an arcana's host particle works (src/arcana.ts).
 */
import { blockBounds, eachChild } from './schema-kv.ts';

/** One control point of an effect, put on a named attachment of the model. */
export interface EffectPoint { index: number; attachType: string; attachment: string | null; entity?: string }

/** One effect the table knows, with the name players know it by when it has one. */
export interface UnusualEffect {
  id: number; name: string | null; system: string; attachType: string; attachment?: string; entity?: string; points: EffectPoint[];
}

/** The section's bounds, found by its line at the table's first level, or null. */
function section(text: string): [number, number] | null {
  const at = /\n\t"attribute_controlled_attached_particles"\s*\n/.exec(text);
  return at ? blockBounds(text, at.index + at[0].length - 1) : null;
}

/** Attrib_Particle<id> names out of dota_english.txt's text, by id. */
export function effectNames(english: string): Map<number, string> {
  const names = new Map<number, string>();
  for (const m of english.matchAll(/"Attrib_Particle(\d+)"\s+"([^"\n]*)"/g)) names.set(Number(m[1]), m[2]);
  return names;
}

/** Every effect in the table, in its order; named ones carry the English name. */
export function unusualEffects(text: string, english = ''): UnusualEffect[] {
  const bounds = section(text);
  if (!bounds) return [];
  const names = effectNames(english);
  const out: UnusualEffect[] = [];
  eachChild(text, bounds, (c) => {
    if (!c.isBlock || !/^\d+$/.test(c.key)) return;
    const effect: UnusualEffect = { id: Number(c.key), name: names.get(Number(c.key)) ?? null, system: '', attachType: '', points: [] };
    eachChild(text, c.body, (f) => {
      if (f.key === 'system' && !f.isBlock) effect.system = f.value;
      else if (f.key === 'attach_type' && !f.isBlock) effect.attachType = f.value;
      else if (f.key === 'attach_entity' && !f.isBlock) effect.entity = f.value;
      else if (f.key === 'attachment' && !f.isBlock) effect.attachment = f.value;
      else if (f.key === 'control_points' && f.isBlock) {
        eachChild(text, f.body, (p) => {
          if (!p.isBlock) return;
          const point: EffectPoint = { index: Number(p.key), attachType: '', attachment: null };
          eachChild(text, p.body, (v) => {
            if (v.isBlock) return;
            if (v.key === 'control_point_index') point.index = Number(v.value);
            if (v.key === 'attach_type') point.attachType = v.value;
            if (v.key === 'attachment') point.attachment = v.value;
            if (v.key === 'attach_entity') point.entity = v.value;
          });
          effect.points.push(point);
        });
      }
    });
    if (effect.system) out.push(effect);
  });
  return out;
}
