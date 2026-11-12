/* The mascot's right-click menu: a theme of the user's own loaded from a JSON file, saved to one,
 * or dropped (ui/custom-theme.ts has the format and the checks, issue #432). Saving with no theme of
 * their own gives the palette the window wears now, as a file to start one from. */
import { bindContextMenu } from './menu.ts';
import { toast } from './toast.ts';
import { currentColors, parseTheme, storeTheme, storedTheme, themeCss, themeFile, type CustomTheme } from './custom-theme.ts';

let mine: CustomTheme | null | undefined;
const theme = () => (mine === undefined ? (mine = storedTheme()) : mine);

/** Whether there is a theme of the user's own to wear. */
export const hasCustom = (): boolean => theme() !== null;

/** The user's theme's colours on the window (under [data-theme='custom']), or taken off. */
export function customCss(on: boolean): void {
  const id = 'customThemeCss';
  let el = document.getElementById(id);
  const t = on ? theme() : null;
  if (!t) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    document.head.append(el);
  }
  el.textContent = themeCss(t);
}

function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

async function load(wear: (on: boolean) => void): Promise<void> {
  const file = await pickFile();
  if (!file) return;
  // a theme with its picture inside is a few MB; anything far past that is not one
  if (file.size > 5 * 1024 * 1024) { toast(L`Файл больше 5 МБ: это не тема`, 'error'); return; }
  const r = parseTheme(await file.text());
  if ('error' in r) { toast(L`Тема не подходит: ${r.error}`, 'error', 8000); return; }
  mine = r.theme;
  storeTheme(r.theme);
  wear(true);
  toast(L`Тема «${r.theme.name}» надета`);
}

function save(isCustom: boolean): void {
  const t: CustomTheme = isCustom && theme() ? theme()! : { name: L`Моя тема`, colors: currentColors(getComputedStyle(document.documentElement)) };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([themeFile(t)], { type: 'application/json' }));
  a.download = `${t.name.replace(/[\\/:*?"<>|]+/g, '_')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** The menu on the mascot. */
export function bindThemeMenu(mascot: HTMLElement, isCustom: () => boolean, wear: (on: boolean) => void): void {
  bindContextMenu(mascot.parentElement || document.body, '#themeMascot', () => [
    { label: L`Загрузить тему из файла…`, icon: 'upload_file', onPick: () => void load(wear) },
    { label: isCustom() ? L`Сохранить тему в файл…` : L`Сохранить эти цвета как тему…`, icon: 'download', onPick: () => save(isCustom()) },
    hasCustom() && { separator: true },
    hasCustom() && { label: L`Убрать свою тему`, icon: 'delete', danger: true, onPick: () => { const was = isCustom(); mine = null; storeTheme(null); if (was) wear(false); } },
  ]);
}
