/* My mods' own state: the ticked rows, the open packs, the search and what was last read from main.
 * It lives here rather than in the shared store because no other screen has ever read it. */
import type { Place } from '../../library/order.ts';
import type { ExternalFile, LibRecord, RepairState } from '../../library/types.ts';

export const lib = {
  /** record ids ticked for the bulk bar, and "m:<pack>:<member>" for mods inside packs */
  sel: new Set<string>(),
  /** packs folded open */
  open: new Set<string>(),
  search: '',
  /** as of the last read, without the tools: a tool is not a mod, and its card says everything */
  records: [] as LibRecord[],
  order: new Map<string, Place>(),
  /** files in the mods folder that no record owns */
  external: [] as ExternalFile[],
  /** fonts and cursors Steam took back, which need downloading again */
  stuck: [] as { id: string; name: string }[],
  repair: { state: 'idle' } as RepairState,
  slots: 0,
  slotCeil: 98,
  /** bumped for a fresh draw */
  key: 0,
};

export const recById = (id: string): LibRecord | undefined => lib.records.find((r) => r.id === id);

/* The screen's two ways to redraw, filled in by views/library.ts: again from what is held (a tick,
 * the search, a pack folded open), or after reading main again (anything that changed the folder). */
export const screen = {
  draw: (): void => undefined,
  reload: async (): Promise<void> => undefined,
};
