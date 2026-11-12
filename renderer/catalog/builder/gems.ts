import type { ArcanaWindow } from '../../api/content.ts';
import { gemOf, type Rgb } from '../arcana/tint.ts';

export interface PreviewGem { set: string; slot: string; color: Rgb; rules: ArcanaWindow['preview']; stock?: boolean }

// The builder exposes the arcana base and the Workshop's four wearables as named options.
const setsByName: ReadonlyMap<string, string> = new Map([
  ['fractal horns of inner abysm', 'terrorblade-arcana'],
  ['swine of the sunken galley', 'techies-arcana'],
  ['span of sorrow', 'terrorblade-span'],
  ['scythes of sorrow', 'terrorblade-scythes'],
  ['severing crest', 'razor-crest'],
]);

export function gemSetOf(name?: string | null): string | undefined {
  return setsByName.get(name?.trim().toLowerCase() ?? '');
}

export function gemColor(set: string, arcanas: readonly ArcanaWindow[], drafts: Record<string, Rgb>, equipped: Record<string, string>) {
  const own = arcanas.find(item => item.set === set)?.installed;
  const arcana = arcanas.find(item => item.set === 'terrorblade-arcana');
  const inherits = (set === 'terrorblade-span' || set === 'terrorblade-scythes') &&
    !!equipped['terrorblade-arcana'] && !!arcana;
  const explicit = drafts[set] ?? (own?.enabled ? own.color : undefined);
  const inherited = inherits && !explicit
    ? drafts['terrorblade-arcana'] ?? (arcana?.installed?.enabled ? arcana.installed.color : gemOf('terrorblade-arcana'))
    : undefined;
  const followsArcana = inherited?.some((channel, i) => channel !== gemOf('terrorblade-arcana')[i]);
  return { color: explicit ?? (followsArcana ? inherited! : gemOf(set)), inherited: !!followsArcana, explicit: !!explicit };
}
