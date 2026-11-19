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
import { isNetworkDownloadError } from '../../catalog/download-error.ts';
import { refreshDownloadCounts } from '../../core/download-counts.ts';

interface InstallResult {
  ok?: boolean;
  error?: string;
  already?: boolean;
  /** the cursors switched off, since the game shows one */
  replaced?: string[];
  cancelled?: boolean;
  /** the mods the shared pack took in to make room for this one */
  folded?: string[];
}

/** What the shared pack took in, said once: for one install, or for a whole list at its end. */
function foldedToast(names: string[]): void {
  if (!names.length) return;
  toast(names.length === 1
    ? L`Слоты pakNN почти кончились, поэтому «${catalogName(names[0])}» теперь лежит в «Общем паке». В игре он работает как раньше, включать и выключать его можно в «Моих модах».`
    : L`Слоты pakNN почти кончились, поэтому ${names.length} модов теперь лежат в «Общем паке». В игре они работают как раньше, включать и выключать их можно в «Моих модах».`, 'ok', 9000);
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
  // a list reports once at its end, so forty failures are one line and not forty toasts
  if (batch) {
    await refreshInstalledIndex();
    redrawScreen();
    changed();
    return r;
  }
  foldedToast(r.folded ?? []);
  if (r.error && !r.already) {
    const hint = isNetworkDownloadError(r.error) ? ` — ${L`Возможно, нужно настроить прокси или включить VPN`}` : '';
    toast(`${catalogName(mod.name)}: ${r.error}${hint}`, 'error', 7000);
  }
  else if (r.replaced?.length) toast(L`${catalogName(mod.name)} установлен — «${r.replaced.map(n => catalogName(n)).join(', ')}» выключен: курсор в игре может быть только один`, 'warn', 7000);
  // a tool is not installed into anything: it is downloaded, unpacked and waiting in a folder
  else if (!r.error) toast(categoryId === 'tools' ? L`${catalogName(mod.name)} готов` : L`${catalogName(mod.name)} установлен`);
  await refreshInstalledIndex();
  if (r.ok) refreshDownloadCounts(); // this install shows in the mod's number
  redrawScreen(); // the "Установлен" badges follow the library, drawn again in place
  changed();
  return r;
}

/* Install a list of mods one after another and report once at the end. Two things use this:
 * a pack from the catalog, and the list the user built themselves. Sequential on purpose -
 * these are downloads into the same folder, and a mod's pak slot depends on what is already
 * there, so they cannot be raced. */
interface ManyResult { ok: number; skip: number; fail: number; failed: { key: string; error: string }[] }

async function installMany(entries: Entry[]): Promise<ManyResult> {
  let ok = 0, skip = 0;
  const failed: { key: string; error: string }[] = [];
  const folded: string[] = [];
  for (const { categoryId, mod, styleLabel, fileRef, preview } of entries) {
    if (!fileRef || !/\.(vpk|zip)$/i.test(fileRef)) { skip++; continue; }
    const key = keyOf(categoryId, mod.name, styleLabel);
    if (state.installedIndex.has(key)) { skip++; continue; }
    const r = await doInstall(categoryId, mod, styleLabel, fileRef, preview, { batch: true });
    folded.push(...(r?.folded ?? []));
    if (r?.ok) ok++;
    else if (r?.cancelled || r?.already) skip++;
    else failed.push({ key, error: r?.error || L`Не удалось установить` });
  }
  await refreshInstalledIndex();
  render();
  foldedToast(folded);
  return { ok, skip, fail: failed.length, failed };
}

/** The reasons a run failed for, each once: forty mods out of room are one reason, not forty. */
function reasons(failed: { error: string }[]): string {
  const counts = new Map<string, number>();
  for (const f of failed) counts.set(f.error, (counts.get(f.error) ?? 0) + 1);
  return [...counts].slice(0, 2).map(([e, n]) => (n > 1 ? `${e} (×${n})` : e)).join('; ');
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
  const { ok, skip, fail, failed } = await installMany(entries);
  toast(L`Пак «${catalogName(pack.name)}»: установлено ${ok}, пропущено ${skip + missing}${fail ? L`, ошибок ${fail}` : ''}${fail ? `. ${reasons(failed)}` : ''}`, fail ? 'warn' : 'ok', fail ? 12000 : 7000);
}

// The install list hands its contents back here, since this is where installing lives.
useInstaller(async (list: QueueEntry[]): Promise<Map<string, string>> => {
  const entries = list
    .map(({ cat, name, label, file, preview }): Entry | null => {
      const mod = findModByName(cat, name);
      return mod ? { categoryId: cat, mod, styleLabel: label, fileRef: file, preview: preview ?? undefined } : null;
    })
    .filter((e): e is Entry => e !== null);
  const { ok, skip, fail, failed } = await installMany(entries);
  toast(
    fail
      ? L`Список: установлено ${ok}, не установились ${fail}: они остались в списке. ${reasons(failed)}`
      : L`Список: установлено ${ok}${skip ? L`, пропущено ${skip}` : ''}`,
    fail ? 'warn' : 'ok',
    fail ? 12000 : 7000,
  );
  // what did not go in stays in the list, with why, for another try
  return new Map(failed.map((f) => [f.key, f.error]));
});
