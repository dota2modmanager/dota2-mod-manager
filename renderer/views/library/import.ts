/* What an import brought in, said once: the mods, the files glued into one, what failed. The
 * buttons over My mods and a drop onto the window (app.js) both end here. */
import { state } from '../../core/store.ts';
import { render } from '../../core/router.ts';
import { refreshInstalledIndex } from '../../core/installed.ts';
import { plural } from '../../ui/format.ts';
import { toast } from '../../ui/toast.ts';

export interface ImportResult {
  cancelled?: boolean;
  error?: string;
  errors?: { source: string; error: string }[];
  imported?: { merged?: number }[];
}

export async function handleImportResult(r: ImportResult | null): Promise<void> {
  if (!r || r.cancelled) return;
  if (r.error) { toast(r.error, 'error', 6000); return; }
  for (const e of r.errors || []) toast(`${e.source}: ${e.error}`, 'warn', 5000);
  const n = (r.imported || []).length;
  if (n) toast(L`Импортировано: ${n} ${plural(n, 'мод', 'мода', 'модов')}`);
  // multi-volume packs (Skinchanger: pak01_dir.vpk + pak01_000.vpk) arrive as one file
  const merged = (r.imported || []).filter((imp) => (imp.merged || 0) > 1);
  if (merged.length) {
    const parts = merged.reduce((s, imp) => s + (imp.merged || 0), 0);
    toast(L`${parts} ${plural(parts, 'файл склеен', 'файла склеены', 'файлов склеены')} в ${merged.length} ${plural(merged.length, 'мод', 'мода', 'модов')}`);
  }
  await refreshInstalledIndex();
  if (state.view === 'library') render();
}
