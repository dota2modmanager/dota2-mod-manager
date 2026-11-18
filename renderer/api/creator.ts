/* The author's desk (src/ipc-creator.ts): drafts of mods for the catalog, and the hand-off to the
 * catalog's upload API. */
import type { Reply } from './reply.ts';

/** An author's draft of a mod for the catalog (src/creator.ts), as the form shows it. */
export interface CreatorDraft {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  hero: string;
  description: string;
  authorMode: 'existing' | 'new' | 'skip';
  author: string;
  authorUrl: string;
  /** an optional second credit: a co-author, a source, or who reworked the mod */
  extraMode: 'none' | 'author' | 'source' | 'modded';
  extraOrigin: 'existing' | 'new';
  extraName: string;
  extraUrl: string;
  /** a YouTube preview, for the categories the catalog takes one for */
  video: string;
  tags: Record<string, boolean>;
  styles: { label: string; vpk: string | null; picture: string | null; colors: string[] }[];
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
export type CreatorFields = Partial<Pick<CreatorDraft,
  'name' | 'category' | 'subcategory' | 'hero' | 'description' | 'authorMode' | 'author' | 'authorUrl'
  | 'extraMode' | 'extraOrigin' | 'extraName' | 'extraUrl' | 'video' | 'tags' | 'replaces'>>
  & { styles?: { label: string; colors?: string[] }[] };

/** The upload terms, as the app records them (src/creator.ts). */
export interface CreatorConsent { accepted: boolean; version: string; at: string | null }

/** One submission in the catalog's history for the upload key's owner. */
export interface CreatorHistoryItem {
  name?: string;
  /** what the catalog says became of it; anything unknown is still on moderation */
  status?: 'moderation' | 'accepted' | 'rejected' | string;
  /** 'update' for a new version of a mod already in the catalog */
  kind?: string;
  createdAt?: string;
  reason?: string;
  url?: string;
}

/** The author's drafts (src/ipc-creator.ts). */
export interface CreatorApi {
  list: () => Promise<Reply<{ drafts: CreatorDraft[]; consent: CreatorConsent; uploader: boolean }>>;
  /** a new draft (id null), or one's fields changed */
  save: (id: string | null, fields: CreatorFields) => Promise<Reply<{ draft: CreatorDraft }>>;
  /** a style's VPK or picture, picked in a dialog */
  attach: (id: string, style: number, kind: 'vpk' | 'picture') => Promise<Reply<{ draft?: CreatorDraft; cancelled?: true }>>;
  remove: (id: string) => Promise<Reply<object>>;
  /** the draft as PreMod's archive, saved where the user says; previews are each style's picture as 854x480 WebP */
  export: (id: string, previews: (Uint8Array | null)[]) => Promise<Reply<{ path?: string; size?: number; cancelled?: true }>>;
  /** record the upload terms; formal, and the app's own record of the agreement */
  accept: () => Promise<Reply<{ consent: CreatorConsent }>>;
  /** send the draft to the catalog's upload API; previews are each style's picture as 854x480 WebP */
  upload: (id: string, previews: (Uint8Array | null)[]) => Promise<Reply<{ url?: string; id?: string }>>;
  /** the upload history from the catalog's API, for the key the app is configured with */
  history: () => Promise<Reply<{ items: CreatorHistoryItem[] }>>;
}
