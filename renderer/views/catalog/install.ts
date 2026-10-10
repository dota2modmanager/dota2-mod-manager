/* Putting mods from the catalog into the game: one from its window, a pack, the list the user
 * built. Whatever is on screen says it is busy while a download is in flight (state.ts installing),
 * and the badges follow once it lands. */
import { catalogName } from '../../ui/catalog-name.ts';
import { state } from '../../core/store.ts';
import { render } from '../../core/router.ts';
import { keyOf, refreshInstalledIndex } from '../../core/installed.ts';
import { toast } from '../../ui/toast.ts';
import { confirmDialog } from '../../ui/dialog.ts';
import { isQueued, dropFromQueue, useInstaller } from '../../ui/queue.ts';
import { redrawScreen } from '../../catalog/screen/root.tsx';
import type { Mod } from '../../catalog/types.ts';
import type { QueueEntry } from '../../catalog/queueing.ts';
import { findModByName } from './lists.ts';
import { installing } from './state.ts';

interface InstallResult {
  ok?: boolean;
  error?: string;
  already?: boolean;
  /** the cursors switched off, since the game shows one */
  replaced?: string[];
  cancelled?: boolean;
}

interface Entry { categoryId: string; mod: Mod; styleLabel: string | null; fileRef?: string; preview?: string }

// the mod window listens: its button says "Installing..." while its mod is in flight
const listeners = new Set<() => void>();
export const onInstalling = (fn: () => void): void => { listeners.add(fn); };
const changed = () => { for (const fn of listeners) fn(); };

export async function doInstall(categoryId: string, mod: Mod, styleLabel: string | null, fileRef: string | undefined, preview: string | undefined,
  { batch = false } = {}): Promise<InstallResult | undefined> {
  const k = keyOf(categoryId, mod.name, styleLabel);
  if (installing.has(k)) return;
  if (!state.settings?.dotaPathValid && categoryId !== 'tools') {
    toast(L`Сначала укажи путь к Dota 2 в настройках`, 'warn');
    return;
  }
  // Installing it here and now settles the question the list was holding open, so say that
  // before doing it rather than leaving a tick behind on a mod that is already in the game.
  if (!batch && isQueued(k)) {
    const go = await confirmDialog(
      L`«${catalogName(mod.name)}» уже в списке установки. Поставить сейчас? Из списка он пропадёт.`,
      // nothing is being destroyed here, so neither the word nor the red button belongs
      { okLabel: L`Установить`, danger: false },
    );
    if (!go) return { cancelled: true };
    dropFromQueue(k);
  }
  /* Dota reads one map archive, so a terrain replaces whatever is there. Ours is ordinary
   * housekeeping and passes without a word; another program's is not, and Minify puts its map
   * mods in exactly that file. Asked before the download rather than reported after it. */
  if (!batch && categoryId === 'terrains') {
    const maps = await window.api.mods.mapsOwner().catch((): { present: boolean; owner?: string } => ({ present: false }));
    if (maps.present) {
      const go = await confirmDialog(
        maps.owner === 'minify'
          ? L`В папке карт лежит мод Minify. Ландшафт займёт тот же файл и заменит его — Dota читает только один. Продолжить?`
          : L`В папке карт уже лежит ландшафт, поставленный не через приложение. Он будет заменён — Dota читает только один файл карт. Продолжить?`,
        { okLabel: L`Заменить`, danger: false },
      );
      if (!go) return { cancelled: true };
    }
  }
  installing.add(k);
  changed();
  /* A channel can reject rather than answer, and then this line used to throw: `installing`
     kept the key, the button stayed on "Installing..." for as long as the window was open, and
     the only trace was an unhandled rejection in the log. That is how a broken mods:install
     read as a hang for two releases instead of as an error. Whatever went wrong, the button
     comes back and says something. */
  let r: InstallResult;
  try {
    r = await window.api.mods.install({ categoryId, name: mod.name, styleLabel, fileRef, preview });
  } catch (err) {
    r = { error: String((err as Error)?.message || err) };
  }
  installing.delete(k);
  if (r.error && !r.already) toast(`${catalogName(mod.name)}: ${r.error}`, 'error', 6000);
  else if (r.replaced?.length) toast(L`${catalogName(mod.name)} установлен — «${r.replaced.map(n => catalogName(n)).join(', ')}» выключен: курсор в игре может быть только один`, 'warn', 7000);
  // a tool is not installed into anything: it is downloaded, unpacked and waiting in a folder
  else if (!r.error) toast(categoryId === 'tools' ? L`${catalogName(mod.name)} готов` : L`${catalogName(mod.name)} установлен`);
  await refreshInstalledIndex();
  redrawScreen(); // the "Установлен" badges follow the library, drawn again in place
  changed();
  return r;
}

/* Install a list of mods one after another and report once at the end. Two things use this:
 * a pack from the catalog, and the list the user built themselves. Sequential on purpose -
 * these are downloads into the same folder, and a mod's pak slot depends on what is already
 * there, so they cannot be raced. */
async function installMany(entries: Entry[]): Promise<{ ok: number; skip: number; fail: number }> {
  let ok = 0, fail = 0, skip = 0;
  for (const { categoryId, mod, styleLabel, fileRef, preview } of entries) {
    if (!fileRef || !/\.(vpk|zip)$/i.test(fileRef)) { skip++; continue; }
    if (state.installedIndex.has(keyOf(categoryId, mod.name, styleLabel))) { skip++; continue; }
    const r = await doInstall(categoryId, mod, styleLabel, fileRef, preview, { batch: true });
    if (r?.ok) ok++;
    else if (r?.cancelled) skip++;
    else fail++;
  }
  await refreshInstalledIndex();
  render();
  return { ok, skip, fail };
}

/** A pack's `mods` entry is usually a mod's name, but the catalog also ships { name, style }. */
export function packMemberName(entry: unknown): string {
  return (typeof entry === 'string' ? entry : (entry as { name?: string } | null)?.name || '').trim();
}

/** A pack, without the members dropped from it in its window. */
export async function installPack(pack: Mod, excluded: Set<string>): Promise<void> {
  const names = (pack.mods || []).map(packMemberName).filter((n) => n && !excluded.has(n));
  const entries: Entry[] = [];
  let missing = 0;
  for (const name of names) {
    const hit = state.modIndex.get(name.toLowerCase());
    if (!hit) { missing++; continue; }
    const { categoryId, mod } = hit as { categoryId: string; mod: Mod };
    // a mod with styles keeps everything per style: its file, its label and its picture
    const style = mod.file ? null : mod.styles?.[0];
    entries.push({ categoryId, mod, styleLabel: style?.label || null, fileRef: mod.file || style?.file, preview: style?.preview || mod.preview });
  }
  const { ok, skip, fail } = await installMany(entries);
  toast(L`Пак «${catalogName(pack.name)}»: установлено ${ok}, пропущено ${skip + missing}${fail ? L`, ошибок ${fail}` : ''}`, fail ? 'warn' : 'ok', 7000);
}

// The install list hands its contents back here, since this is where installing lives.
useInstaller(async (list: QueueEntry[]) => {
  const entries = list
    .map(({ cat, name, label, file, preview }): Entry | null => {
      const mod = findModByName(cat, name);
      return mod ? { categoryId: cat, mod, styleLabel: label, fileRef: file, preview: preview ?? undefined } : null;
    })
    .filter((e): e is Entry => e !== null);
  const { ok, skip, fail } = await installMany(entries);
  toast(
    L`Список: установлено ${ok}${skip ? L`, пропущено ${skip}` : ''}${fail ? L`, ошибок ${fail}` : ''}`,
    fail ? 'warn' : 'ok',
    7000,
  );
});
