/* What the mod window shows, worked out by views/catalog/mod-window.ts and drawn by ModModal.tsx. */
import type { Mod, ModStyle } from '../types.ts';

export interface PackMember {
  name: string;
  thumb: string | null;
  /** the member's category, or null when the catalog no longer has it */
  catName: string | null;
  installed: boolean;
  excluded: boolean;
}

export interface ModModalModel {
  categoryId: string;
  catName: string;
  mod: Mod;
  styles: ModStyle[] | null;
  styleIdx: number;
  mediaUrl: string | null;
  fallbackIcon: string;
  /** a clip or sound the built-in player can show */
  playable: string | null;
  fav: boolean;
  date: string | null;
  /** everybody the catalog credits, as core/credits.ts draws them */
  creditsHtml: string;
  kind: 'tool' | 'pack' | 'mod';
  /** the archive an install downloads, or null for a link */
  target: string | null;
  /** the library record, when this look is installed */
  installedId: string | null;
  toolRelPath: string;
  busy: boolean;
  pack: { members: PackMember[]; activeCount: number; custom: boolean } | null;
  /** what the catalog wrote about the mod (ui/guide.js) */
  guidesHtml: string;
  links: { index: number; label: string }[];
  note: string | null;
}

export interface ModModalActions {
  close: () => void;
  toggleFav: () => void;
  playPreview: () => void;
  pickStyle: (index: number) => void;
  togglePackMember: (name: string) => void;
  savePack: (name: string) => void;
  deletePack: () => void;
  install: () => void;
  uninstall: () => void;
  runTool: () => void;
  openToolFolder: () => void;
  openLink: () => void;
  openExtraLink: (index: number) => void;
  bindCredits: (el: HTMLElement) => void;
  bindGuides: (el: HTMLElement) => void;
}
