/* Files in the mods folder that no record owns: switched, taken in ("Принять"), split by hero or
 * deleted. A cursor or font set is a whole folder, so it is only ever taken in. */
import { toast } from '../../ui/toast.js';
import { confirmDialog } from '../../ui/dialog.js';
import { catalogPreviewFor } from '../../ui/thumb.js';
import { lib, screen } from './state.ts';

export async function external(what: 'toggle' | 'adopt' | 'split' | 'remove', key: string): Promise<void> {
  const f = lib.external.find((x) => x.key === key);
  if (!f) return;
  if (what === 'toggle') {
    await window.api.mods.externalSetEnabled(f.key, !f.enabled);
  } else if (what === 'adopt') {
    const prev = catalogPreviewFor(f.match);
    const r = f.kind === 'cursor' ? await window.api.mods.adoptCursor(prev)
      : f.kind === 'font' ? await window.api.mods.adoptFont(f.name, prev)
        : await window.api.mods.adoptExternal(f.key, prev);
    if (r.error) toast(r.error, 'error', 6000);
    else toast(r.matched === false ? L`«${r.name}» принят` : L`«${r.name}» принят из каталога`, 'ok');
  } else if (what === 'split') {
    if (!await confirmDialog(L`Разбить «${f.name}» на отдельные моды по героям? Файл заменится на отдельные управляемые моды.`, { okLabel: L`Разобрать` })) return;
    const r = await window.api.mods.splitExternal(f.key);
    if (r.error) toast(r.error, 'error', 6000);
    else toast(L`Разобрано на ${r.count}: ${r.names.join(', ')}`, 'ok', 6000);
  } else {
    if (!await confirmDialog(L`Удалить файл ${f.name}?`)) return;
    await window.api.mods.externalRemove(f.key);
  }
  await screen.reload();
}
