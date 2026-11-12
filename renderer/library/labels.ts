/* The user's own names for rows in My mods (issue #399). A pak someone dropped in by hand is
 * "pak33_dir.vpk" to the game and must stay that, so the name lives in the settings (modLabels),
 * never in the file: a label only changes what this screen prints and what its search finds.
 *
 * A record is labelled by its id; a file no record owns by its name in the folder, without the
 * ".off" a switched-off file carries, so switching it does not lose the label. */

/** Longest label kept: a row has room for a name, not a note. */
export const LABEL_MAX = 80;

/** The key a record's label is kept under. */
export const recLabelKey = (id: string): string => `rec:${id}`;

/** The key a foreign file's label is kept under. */
export const fileLabelKey = (fileName: string): string => `file:${fileName.replace(/\.off$/i, '').toLowerCase()}`;

/** The labels as last read from the settings; views/library.ts fills it on every read. */
export const labels: { map: Record<string, string> } = { map: {} };

/** The label under a key, or null. */
export function labelFor(key: string): string | null {
  const v = Object.hasOwn(labels.map, key) ? labels.map[key] : null;
  return typeof v === 'string' && v ? v : null;
}

/** The map with one label set, or taken away by an empty one. The map passed in is not changed. */
export function withLabel(map: Record<string, string>, key: string, text: string | null): Record<string, string> {
  const next = { ...map };
  const clean = (text || '').replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX);
  if (clean) next[key] = clean;
  else delete next[key];
  return next;
}

