/* What the Presets screen shows, worked out by views/presets.ts and drawn beside this file. */
import type { Thumb } from '../library/model.ts';

/** A category of mods in a preset: its glyph, its name, how many. */
interface PresetCategory {
  id: string;
  icon: string;
  name: string;
  n: number;
}

/**
 * A preset the user saved. It describes the build, not the part of it installed today: a member
 * that is not installed is still drawn, as what it is (absent), rather than dropped.
 */
export interface OwnPreset {
  kind: 'own';
  id: string;
  name: string;
  count: string;
  absent: { text: string; title: string } | null;
  /** what the share button says it can carry */
  linkTitle: string;
  /** null for an empty preset: "everything will be switched off" */
  body: {
    strip: ({ thumb: Thumb } | { icon: string; title: string })[];
    /** how many did not fit in the strip */
    rest: number;
    cats: PresetCategory[];
    groups: (PresetCategory & { names: { name: string; absent: boolean }[] })[];
  } | null;
}

/** A preset received from somebody else and not installed yet: a decision, "install" or "no thanks". */
export interface SharedPreset {
  kind: 'shared';
  id: string;
  name: string;
  tag: string;
  total: string;
  note: string | null;
  mods: string;
  warn: string | null;
}

export interface PresetsModel {
  key: number;
  presets: (OwnPreset | SharedPreset)[];
}

export interface PresetsActions {
  save: (name: string) => Promise<boolean>;
  importFile: () => void;
  apply: (id: string) => Promise<void>;
  share: (id: string) => void;
  resolve: (id: string) => Promise<void>;
  remove: (id: string) => void;
  menu: (id: string) => { label?: string; icon?: string; separator?: boolean; danger?: boolean; onPick?: () => void }[] | null;
}
