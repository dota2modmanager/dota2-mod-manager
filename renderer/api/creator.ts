/* The author's desk (src/ipc-creator.ts): drafts of mods for the catalog. */
import type { Reply } from './reply.ts';

/** An author's draft of a mod for the catalog (src/creator.ts), as the form shows it. */
export interface CreatorDraft {
  id: string;
  name: string;
  category: string;
  hero: string;
  description: string;
  author: string;
  styles: { label: string; vpk: string | null; picture: string | null }[];
  replaces: { category: string; name: string } | null;
  updatedAt: number;
  /** each style's picture as a data URL, or null for none, a clip or one too big to show */
  pictures: (string | null)[];
  /** what is still missing before it can be sent, in words */
  missing: string[];
  /** what the catalog's upload rules refuse in it (src/creator-premod.ts), in words */
  problems: string[];
}

/** What the form may change in a draft. */
export type CreatorFields = Partial<Pick<CreatorDraft, 'name' | 'category' | 'hero' | 'description' | 'author' | 'replaces'>> & { styles?: { label: string }[] };

/** The author's drafts (src/ipc-creator.ts). */
export interface CreatorApi {
  list: () => Promise<Reply<{ drafts: CreatorDraft[] }>>;
  /** a new draft (id null), or one's fields changed */
  save: (id: string | null, fields: CreatorFields) => Promise<Reply<{ draft: CreatorDraft }>>;
  /** a style's VPK or picture, picked in a dialog */
  attach: (id: string, style: number, kind: 'vpk' | 'picture') => Promise<Reply<{ draft?: CreatorDraft; cancelled?: true }>>;
  remove: (id: string) => Promise<Reply<object>>;
  /** the draft as PreMod's archive, saved where the user says; previews are each style's picture as 854x480 WebP */
  export: (id: string, previews: (Uint8Array | null)[]) => Promise<Reply<{ path?: string; size?: number; cancelled?: true }>>;
}
