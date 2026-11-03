/* One button for when the app is in a strange state (issue #431). The fixes used to be spread
 * over three places: the patch banner put the game back, a missing pak only showed as a mod that
 * did nothing in game, and stale pictures needed the toolchain removed and installed again. This
 * runs them in order and answers a line per step, so the user sees what was wrong and what the
 * app did about it.
 *
 * Nothing here deletes a mod or a preset. The caches it clears are the ones the app fills again by
 * itself (catalog pictures, previews, icons out of the game); the download cache is the user's to
 * clear, because filling it again costs them the downloads.
 */
import fs from 'node:fs';
import { t } from './i18n.ts';
import { errorText } from './error-text.ts';
import type { PatchRepair } from './game-repair.ts';
import type { LibRecord } from './types.ts';

/** One line of the result: which step, whether it found the app healthy, what it says. */
export interface RepairStep {
  id: 'game' | 'files' | 'caches';
  ok: boolean;
  text: string;
  /** the mods a step is about, by name, when there are any to name */
  mods?: string[];
}

/** Switched-on mods with a pak the mod folder no longer has, in any of its on/off spellings. */
export function missingMods(records: Pick<LibRecord, 'name' | 'enabled' | 'files'>[], onDisk: (relPath: string) => string): string[] {
  return records
    .filter((r) => r.enabled !== false && (r.files || []).some((f) => f.root === 'lang' && !fs.existsSync(onDisk(f.relPath))))
    .map((r) => r.name);
}

/** Run the steps in order; a step that throws is a failed line, not a failed repair. */
export async function repairApp({ repairAfterPatch, patchRepair, records, onDisk, clearCaches }: {
  repairAfterPatch: (reason: unknown) => Promise<void>;
  patchRepair: () => PatchRepair;
  records: () => Pick<LibRecord, 'name' | 'enabled' | 'files'>[];
  /** where a mod-folder file is right now (Installer.langFileOnDisk) */
  onDisk: (relPath: string) => string;
  clearCaches: () => void;
}): Promise<RepairStep[]> {
  const steps: RepairStep[] = [];
  const step = async (id: RepairStep['id'], run: () => Promise<Omit<RepairStep, 'id'>> | Omit<RepairStep, 'id'>) => {
    try {
      steps.push({ id, ...(await run()) });
    } catch (err) {
      steps.push({ id, ok: false, text: errorText(err) });
    }
  };

  await step('game', async () => {
    await repairAfterPatch('manual');
    const r = patchRepair();
    if (r.state === 'waiting') return { ok: false, text: t('Dota 2 запущена: закрой игру и нажми ещё раз') };
    if (r.state === 'failed') return { ok: false, text: r.error || t('Не удалось вернуть патч игры') };
    return { ok: true, text: r.healed?.length ? t('Патч игры возвращён') : t('Патч игры на месте') };
  });

  await step('files', () => {
    const mods = missingMods(records(), onDisk);
    return mods.length
      ? { ok: false, text: t('Файлов нет в папке модов: {0}. Удали и поставь их заново', mods.length), mods }
      : { ok: true, text: t('Файлы всех модов на месте') };
  });

  await step('caches', () => {
    clearCaches();
    return { ok: true, text: t('Картинки и превью очищены, приложение соберёт их заново') };
  });

  return steps;
}
