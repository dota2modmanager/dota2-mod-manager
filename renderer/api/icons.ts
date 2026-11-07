/* window.api.icons: a hero's ability icons picked from his own cosmetics' (src/ipc-icons.ts). */
import type { Reply } from './reply.ts';
import type { LibRecord } from '../library/types.ts';

/** One icon a hero's cosmetic shows for an ability: its picture under spellicons, the item or set, its style. */
export interface AbilityIconChoice { icon: string; item: string; style: number | null }
/** An ability with the icons there are for it, its name in the app's language. */
export interface AbilityIconsEntry { ability: string; name: string; choices: AbilityIconChoice[] }

export interface IconsApi {
  /** every hero his cosmetics give a choice of icons to, by npc name */
  heroes: () => Promise<Reply<{ heroes: { hero: string; name: string }[] }>>;
  /** a hero's abilities with their icons, and the icon picked for each (ability -> icon) */
  hero: (hero: string) => Promise<Reply<{ hero: string; abilities: AbilityIconsEntry[]; picks: Record<string, string>; recId: string | null; enabled: boolean; vrf: boolean }>>;
  /** pictures out of the game by icon name (an ability's or a cosmetic's); the ones it could not read are left out */
  pictures: (icons: string[]) => Promise<Record<string, string>>;
  /** an icon on an ability, or the game's own back with null; the last one back removes the record */
  set: (hero: string, ability: string, icon: string | null) => Promise<Reply<{ record: LibRecord | null }>>;
  /** every pick of the hero taken off, and his record */
  clear: (hero: string) => Promise<Reply<{ record: LibRecord | null }>>;
}
