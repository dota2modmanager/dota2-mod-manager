/* Files dropped anywhere on the window. The file says what to do with it, not the tab that happens to
 * be open: a preset from Discord lands wherever the user is standing, and so do mods. */
import { state } from '../core/store.ts';
import { switchView } from '../core/router.ts';
import { toast } from '../ui/toast.ts';
import { handleImportResult } from '../views/library.ts';
import { handlePresetImport } from '../views/presets.ts';

let depth = 0;
// setting dropEffect=copy on every dragover is what lets Windows deliver the drop; without it some
// setups report effect "none" and the drop event never fires
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) {
    depth++;
    document.body.classList.add('dropping');
  }
});
document.addEventListener('dragleave', () => {
  if (--depth <= 0) {
    depth = 0;
    document.body.classList.remove('dropping');
  }
});

// A dropped folder has no extension and no type: the main process walks it for .vpk files, which
// is how a whole unzipped Skinchanger pack can be dropped in at once.
const isFolder = (f: File) => !f.type && !/\.[a-z0-9]+$/i.test(f.name || '');
const isMod = (f: File) => /\.(vpk|zip)$/i.test(f.name || '') || isFolder(f);
const pathOf = (f: File): string | null => { try { return window.api.mods.pathForFile(f); } catch { return null; } };

/** Mod files, an archive of them, or a folder to scan. */
async function dropMods(dropped: File[]) {
  const wanted = dropped.filter(isMod);
  if (state.view !== 'library') switchView('library');
  // real paths on disk, when there are: they let the importer pick up sibling _NNN parts too
  const paths = wanted.map(pathOf).filter((p): p is string => Boolean(p));
  if (paths.length === wanted.length) {
    await handleImportResult(await window.api.mods.importPaths(paths));
    return;
  }
  // some setups expose no path for a dropped file: the bytes go instead
  const files = wanted.filter((f) => !isFolder(f));
  if (!files.length) { toast(L`Не удалось прочитать перетащенную папку`, 'error'); return; }
  try {
    const items = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
    await handleImportResult(await window.api.mods.importBuffers(items));
  } catch {
    toast(L`Не удалось прочитать перетащенные файлы`, 'error');
  }
}

/** A received .d2mm. */
async function dropPreset(dropped: File[]) {
  const file = dropped.find((f) => /\.d2mm$/i.test(f.name || ''));
  const p = file ? pathOf(file) : null;
  if (!p) { toast(L`Не удалось прочитать файл пресета`, 'error'); return; }
  await handlePresetImport(await window.api.presets.importFile(p)); // switches to Presets itself
}

document.addEventListener('drop', async (e) => {
  e.preventDefault();
  depth = 0;
  document.body.classList.remove('dropping');
  const dropped = [...(e.dataTransfer?.files || [])];
  if (!dropped.length) return;
  if (dropped.some((f) => /\.d2mm$/i.test(f.name || ''))) { await dropPreset(dropped); return; }
  if (dropped.some(isMod)) { await dropMods(dropped); return; }
  toast(L`Сюда можно бросить моды (.vpk, .zip, папку) или пресет .d2mm`, 'warn', 5000);
});

// a d2mm:// link clicked outside the app (or the one it was launched with)
window.api.presets.onLink((res) => handlePresetImport(res as Parameters<typeof handlePresetImport>[0]));
