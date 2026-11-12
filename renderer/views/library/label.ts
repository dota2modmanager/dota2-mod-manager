/* Naming a row in My mods (issue #399): asked for in a prompt, kept in the settings, never written
 * into the file. The rules for keys and length are in library/labels.ts. */
import { state } from '../../core/store.ts';
import { toast } from '../../ui/toast.ts';
import { promptDialog } from '../../ui/dialog.ts';
import { LABEL_MAX, labelFor, labels, withLabel } from '../../library/labels.ts';
import { screen } from './state.ts';

async function save(key: string, text: string | null): Promise<void> {
  const next = withLabel(labels.map, key, text);
  try {
    state.settings = await window.api.settings.set('modLabels', next);
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), 'error', 6000);
    return;
  }
  labels.map = next;
  screen.draw();
}

/** Ask for a name for the row under this key; "what" is the name it has now, for the question. */
export async function askLabel(key: string, what: string): Promise<void> {
  // an empty answer takes the name away, so a row without a menu can lose it too
  const text = await promptDialog(L`Своё название для «${what}». Его видно только здесь: файл в игре не переименовывается. Пустое поле вернёт прежнее.`, {
    value: labelFor(key) || '', placeholder: L`напр. «Пудж, красный»`, okLabel: L`Сохранить`, allowEmpty: true,
  });
  if (text === null) return;
  await save(key, text.slice(0, LABEL_MAX));
}

/** Take the row's own name away; it shows the one it came with again. */
export const clearLabel = (key: string): Promise<void> => save(key, null);
