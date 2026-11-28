/* Files dropped anywhere on the window. The file says what to do with it, not the tab that happens to
 * be open: a preset from Discord lands wherever the user is standing, and so do mods.
 *
 * A file dragged in from outside comes as the shell's win:fileDrag, with its full path: Tauri's drop
 * handler takes it before the webview, so the DOM's drop never fires for it on Windows
 * (src-tauri/src/page/bridge.js). The DOM's events are kept for a webview that does deliver them. */
import { state } from '../core/store.ts';
import { switchView } from '../core/router.ts';
import { toast } from '../ui/toast.ts';
import { handleImportResult } from '../views/library.ts';
import { handlePresetImport } from '../views/presets.ts';

const showDropping = (on: boolean) => document.body.classList.toggle('dropping', on);

// A dropped folder has no extension and no type: the main process walks it for .vpk files, which
// is how a whole unzipped Skinchanger pack can be dropped in at once.
const baseName = (p: string) => p.split(/[\\/]/).pop() || '';
const isModName = (name: string) => /\.(vpk|zip)$/i.test(name) || !/\.[a-z0-9]+$/i.test(name);
const isPresetName = (name: string) => /\.d2mm$/i.test(name);
const isFolder = (f: File) => !f.type && !/\.[a-z0-9]+$/i.test(f.name || '');
const isMod = (f: File) => /\.(vpk|zip)$/i.test(f.name || '') || isFolder(f);
const pathOf = (f: File): string | null => { try { return window.api.mods.pathForFile(f); } catch { return null; } };
const wrongKind = () => toast(L`Сюда можно бросить моды (.vpk, .zip, папку) или пресет .d2mm`, 'warn', 5000);

/** Mods by their paths on disk: real paths let the importer pick up sibling _NNN parts too. */
async function importModPaths(paths: string[]) {
  if (state.view !== 'library') switchView('library');
  await handleImportResult(await window.api.mods.importPaths(paths));
}

/** A received .d2mm. */
async function importPreset(p: string | null) {
  if (!p) { toast(L`Не удалось прочитать файл пресета`, 'error'); return; }
  await handlePresetImport(await window.api.presets.importFile(p)); // switches to Presets itself
}

/** Files dragged in from outside, by their paths. */
async function dropPaths(paths: string[]) {
  const preset = paths.find((p) => isPresetName(baseName(p)));
  if (preset) { await importPreset(preset); return; }
  const mods = paths.filter((p) => isModName(baseName(p)));
  if (mods.length) { await importModPaths(mods); return; }
  wrongKind();
}

// the time of the last drop the shell reported, so a webview that also fires the DOM's drop does not
// import the same files twice
let shellDropAt = 0;
window.api.win.onFileDrag((d) => {
  if (d.type === 'enter') { showDropping(true); return; }
  showDropping(false);
  if (d.type !== 'drop' || !d.paths.length) return;
  shellDropAt = Date.now();
  // a window that takes a dropped file itself (a picture into the own-cursor window) keeps it
  if (document.elementFromPoint(d.x, d.y)?.closest('[data-own-drop]')) return;
  void dropPaths(d.paths);
});

/** Mod files, an archive of them, or a folder to scan, as the DOM gave them. */
async function dropMods(dropped: File[]) {
  const wanted = dropped.filter(isMod);
  const paths = wanted.map(pathOf).filter((p): p is string => Boolean(p));
  if (paths.length === wanted.length) { await importModPaths(paths); return; }
  // some setups expose no path for a dropped file: the bytes go instead
  if (state.view !== 'library') switchView('library');
  const files = wanted.filter((f) => !isFolder(f));
  if (!files.length) { toast(L`Не удалось прочитать перетащенную папку`, 'error'); return; }
  try {
    const items = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
    await handleImportResult(await window.api.mods.importBuffers(items));
  } catch {
    toast(L`Не удалось прочитать перетащенные файлы`, 'error');
  }
}

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
    showDropping(true);
  }
});
document.addEventListener('dragleave', () => {
  if (--depth <= 0) {
    depth = 0;
    showDropping(false);
  }
});

document.addEventListener('drop', async (e) => {
  e.preventDefault();
  depth = 0;
  showDropping(false);
  if (Date.now() - shellDropAt < 2000) return;
  // a window that takes a dropped file itself (a picture into the own-cursor window) keeps it
  if (e.target instanceof Element && e.target.closest('[data-own-drop]')) return;
  const dropped = [...(e.dataTransfer?.files || [])];
  if (!dropped.length) return;
  const preset = dropped.find((f) => isPresetName(f.name || ''));
  if (preset) { await importPreset(pathOf(preset)); return; }
  if (dropped.some(isMod)) { await dropMods(dropped); return; }
  wrongKind();
});

// a d2mm:// link clicked outside the app (or the one it was launched with)
window.api.presets.onLink((res) => handlePresetImport(res as Parameters<typeof handlePresetImport>[0]));
