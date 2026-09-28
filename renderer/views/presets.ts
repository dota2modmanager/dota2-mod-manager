/* Presets: a named set of "these mods on, everything else off", and the file or link that carries
 * it to somebody else. This reads the presets and the installed mods from main and hands the
 * screen to React (presets/); sharing's two windows are views/presets/share.ts.
 *
 * A card describes the build, not the part of it that happens to be installed today. Deleting mods
 * used to empty every preset on screen, because the card counted only the records it could
 * resolve; a build outliving its installations is the point of storing identities, so a member
 * that is not installed is drawn as absent instead of dropped. */
import { state } from '../core/store.ts';
import { registerView, switchView } from '../core/router.ts';
import { refreshInstalledIndex } from '../core/installed.ts';
import { catName, catIcon } from '../core/categories.ts';
import { fmtMB, plural } from '../ui/format.js';
import { toast } from '../ui/toast.js';
import { confirmDialog, promptDialog } from '../ui/dialog.js';
import { paint } from '../ui/transitions.js';
import { recThumb } from '../library/thumbs.ts';
import type { LibRecord } from '../library/types.ts';
import { showPresets } from '../presets/PresetsScreen.tsx';
import type { OwnPreset, PresetsActions, SharedPreset } from '../presets/model.ts';
import type { PresetRecord } from '../api/content.ts';
import { shareDialog, shareSheet } from './presets/share.ts';

type Preset = PresetRecord;

let presets: Preset[] = [];
let key = 0;

registerView('presets', () => renderPresets(true));

const STRIP = 12;
const mods = (n: number) => `${n} ${plural(n, 'мод', 'мода', 'модов')}`;

function ownCard(p: Preset, byId: Map<string, LibRecord>): OwnPreset {
  const recs = p.modIds.map((id) => byId.get(id)).filter((r): r is LibRecord => Boolean(r));
  const absent = p.absent || [];
  const link = p.link || { count: 0, skipped: [] };
  const groups = new Map<string, { name: string; absent: boolean }[]>();
  const add = (id: string | undefined, entry: { name: string; absent: boolean }) => {
    const k = id || 'other';
    groups.set(k, [...(groups.get(k) || []), entry]);
  };
  for (const r of recs) add(r.categoryId, { name: r.name, absent: false });
  for (const a of absent) add(a.categoryId, { name: a.name, absent: true });
  // biggest group first: it is what the preset is mostly made of
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  // installed first in the strip, so the pictures still lead
  const all = [...recs.map((rec) => ({ thumb: recThumb(rec) })), ...absent.map((a) => ({
    icon: catIcon(a.categoryId || 'other'), title: `${a.name} — ${L`не установлен`}`,
  }))];
  const cat = (id: string, n: number) => ({ id, icon: catIcon(id), name: catName(id), n });
  return {
    kind: 'own',
    id: p.id,
    name: p.name,
    count: mods(recs.length + absent.length),
    absent: absent.length ? { text: L`${absent.length} не установлено`, title: absent.map((a) => a.name).join(', ') } : null,
    linkTitle: !link.count ? L`В пресете только свои моды — ссылка их не донесёт, отправь файлом`
      : link.skipped.length ? L`Ссылка донесёт ${link.count} из каталога; свои моды (${link.skipped.length}) в неё не влезут — для них нужен файл`
        : L`Скопировать короткую ссылку на пресет`,
    body: !recs.length && !absent.length ? null : {
      strip: all.slice(0, STRIP),
      rest: all.length - Math.min(all.length, STRIP),
      cats: ordered.map(([id, list]) => cat(id, list.length)),
      groups: ordered.map(([id, list]) => ({ ...cat(id, list.length), names: list })),
    },
  };
}

function sharedCard(p: Preset): SharedPreset {
  const s = p.status || { installed: 0, download: 0, embedded: 0, free: 0, unavailable: [] };
  const total = s.installed + s.download + s.embedded + (s.free || 0) + s.unavailable.length;
  const bits = [];
  if (s.installed) bits.push(L`${s.installed} уже стоят`);
  if (s.download) bits.push(L`${s.download} скачать из каталога`);
  if (s.embedded) bits.push(L`${s.embedded} внутри файла`);
  if (s.free) bits.push(L`виды из игры: ${s.free}`);
  return {
    kind: 'shared',
    id: p.id,
    name: p.name,
    tag: `${L`получен`}${p.source?.author ? ` · ${p.source.author}` : ''}`,
    total: mods(total),
    note: p.source?.note || null,
    mods: bits.join(' · ') || L`нечего устанавливать`,
    warn: s.unavailable.length
      ? `${L`Не найдены ни у тебя, ни в файле:`} ${s.unavailable.slice(0, 5).join(', ')}${s.unavailable.length > 5 ? '…' : ''}` : null,
  };
}

export async function renderPresets(fresh = false): Promise<void> {
  presets = await window.api.presets.list();
  const { installed } = await window.api.mods.list();
  const byId = new Map<string, LibRecord>((installed as LibRecord[]).map((m) => [m.id, m]));
  if (fresh) key++;
  await paint(() => showPresets({ key, presets: presets.map((p) => (p.wanted ? sharedCard(p) : ownCard(p, byId))) }, actions));
}

async function share(id: string) {
  const preset = presets.find((p) => p.id === id);
  if (!preset) return;
  // the link is made up front: it is a local encode, and offering it already written beats a
  // button that might turn out to have nothing to copy
  const link = await window.api.presets.shareLink(id);
  if (await shareSheet(preset, link.error ? null : link) !== 'file') return;
  const plan = await window.api.presets.exportPlan(id);
  if (plan.error) { toast(plan.error, 'error', 6000); return; }
  if (!plan.entries.length) { toast(L`В пресете нет модов`, 'warn'); return; }
  const opts = await shareDialog(plan);
  if (!opts) return;
  const r = await window.api.presets.exportFile(id, opts);
  if (r.cancelled) return;
  if (r.error) toast(r.error, 'error', 6000);
  else toast(L`Пресет сохранён · ${fmtMB(r.size)} МБ`);
}

async function remove(p: Preset | undefined) {
  if (!p || !await confirmDialog(L`Удалить пресет «${p.name || ''}»?`)) return;
  await window.api.presets.delete(p.id);
  await renderPresets();
}

const actions: PresetsActions = {
  save: async (name) => {
    if (!name) { toast(L`Введи название пресета`, 'warn'); return false; }
    await window.api.presets.save(name);
    toast(L`Пресет «${name}» сохранён`);
    await renderPresets();
    return true;
  },
  importFile: async () => handlePresetImport(await window.api.presets.importDialog()),
  apply: async (id) => {
    // a channel that rejects must not leave the button lying about it: that is the shape of the
    // bug that made Install look like a hang for two releases
    let r;
    try {
      r = await window.api.presets.apply(id);
    } catch (err) {
      r = { error: String((err as Error)?.message || err) };
    }
    if (r.error) toast(r.error, 'error', 6000);
    else {
      toast(r.installed ? L`Пресет применён · доустановлено ${r.installed} ${plural(r.installed, 'мод', 'мода', 'модов')}` : L`Пресет применён`);
      if (r.missing?.length) toast(L`Своих модов нет на этом компьютере, из каталога их не вернуть: ${r.missing.join(', ')}`, 'warn', 8000);
      for (const err of (r.errors || []).slice(0, 3)) toast(err, 'warn', 7000);
    }
    await refreshInstalledIndex();
    await renderPresets();
  },
  share: (id) => { share(id); },
  resolve: async (id) => {
    const r = await window.api.presets.resolve(id);
    if (r.error) toast(r.error, 'error', 7000);
    else {
      toast(L`Установлено и применено: ${r.installed} ${plural(r.installed, 'мод', 'мода', 'модов')}`);
      for (const err of (r.errors || []).slice(0, 3)) toast(err, 'warn', 7000);
    }
    await refreshInstalledIndex();
    await renderPresets();
  },
  remove: (id) => { remove(presets.find((x) => x.id === id)); },
  menu: (id) => {
    const p = presets.find((x) => x.id === id);
    if (!p) return null;
    return [
      { label: L`Обновить по текущему состоянию`, icon: 'save', onPick: async () => {
        const r = await window.api.presets.update(p.id);
        if (r.error) { toast(r.error, 'error', 6000); return; }
        toast(L`Пресет обновлён: ${r.count} ${plural(r.count, 'мод', 'мода', 'модов')}`, 'ok');
        await renderPresets();
      } },
      { label: L`Переименовать`, icon: 'edit', onPick: async () => {
        const name = await promptDialog(L`Новое название пресета`, { value: p.name || '', okLabel: L`Переименовать` });
        if (!name) return;
        const r = await window.api.presets.rename(p.id, name);
        if (r.error) { toast(r.error, 'error', 6000); return; }
        await renderPresets();
      } },
      { separator: true },
      { label: L`Удалить`, icon: 'delete', danger: true, onPick: () => remove(p) },
    ];
  },
};

export async function handlePresetImport(r: { cancelled?: boolean; error?: string; preset?: { name: string } } | null): Promise<void> {
  if (!r || r.cancelled) return;
  if (r.error) { toast(r.error, 'error', 6000); return; }
  toast(L`Пресет «${r.preset?.name}» добавлен — нажми «Установить»`);
  if (state.view !== 'presets') switchView('presets');
  else await renderPresets();
}
