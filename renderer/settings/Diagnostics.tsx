/* Settings → Diagnostics: mend the app, send a report, and take everything out of the game. The
 * three answers to "something is wrong", from the gentlest to the one that leaves no mod behind. */
import { RepairSteps } from './RepairSteps.tsx';
import type { SettingsActions, SettingsModel } from './SettingsScreen.tsx';

export function Diagnostics({ repair, actions }: { repair: SettingsModel['repair']; actions: Pick<SettingsActions, 'repair' | 'exportReport' | 'removeEverything'> }) {
  return (
    <>
      <div className="settings-row spaced">
      <button className="btn btn-sm" id="repairAppBtn" disabled={repair?.busy} onClick={actions.repair}><span className="ms">build</span>{repair?.busy ? L`Чиню…` : L`Починить приложение`}</button>
      <button className="btn btn-sm" id="diagExportBtn" onClick={actions.exportReport}><span className="ms">bug_report</span>{L`Экспортировать отчёт`}</button>
      </div>
      <div className="settings-hint">{L`Починка возвращает патч игры, ищет пропавшие файлы модов и очищает картинки. Моды и пресеты не трогает.`}</div>
      <RepairSteps run={repair} />
      <div className="settings-hint">{L`Путь к игре, список модов и последние записи журнала в одном файле. Пришли его, если что-то не работает.`}</div>
      <div className="settings-row spaced">
      <button className="btn btn-sm btn-danger" id="removeEverythingBtn" onClick={actions.removeEverything}><span className="ms">delete_sweep</span>{L`Удалить всё, что поставило приложение`}</button>
      </div>
      <div className="settings-hint">{L`Все моды и правки файлов игры уходят, приложение остаётся. Так проверяют, виноваты ли моды.`}</div>
      </>
  );
}
