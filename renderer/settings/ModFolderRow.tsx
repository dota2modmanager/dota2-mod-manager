/* Which dota_<lang> folder the mods live in (src/settings.ts langFolderLock). By default they
 * follow the game, and a `-language` in Steam's launch options moves them into its folder at the
 * next start. Somebody who sets English there for the Workshop Tools and plays in Russian had every
 * mod moved and renumbered each time; kept here, they stay where they are. */
import { useState } from 'react';
import { state } from '../core/store.ts';
import { toast } from '../ui/toast.ts';
import { Dropdown } from '../ui/Dropdown.tsx';
import { keepModsIn } from './mod-folder.ts';

const AUTO = 'auto';

export function ModFolderRow({ redraw }: { redraw: () => void }) {
  const [busy, setBusy] = useState(false);
  const lock = state.settings?.langFolderLock ?? null;
  const now = state.settings?.langSuffix || 'russian';
  const pick = async (value: string) => {
    if (busy || (value === AUTO ? null : value) === lock) return;
    setBusy(true);
    try {
      await keepModsIn(value === AUTO ? null : value);
      toast(value === AUTO ? L`Моды снова следуют за языком игры` : L`Моды остаются в dota_${value}`);
    } catch (error) { toast(String(error), 'error'); }
    finally { setBusy(false); redraw(); }
  };
  return <>
    <div className="settings-row spaced">
      <span className="settings-label">{L`Папка модов`}</span>
      <Dropdown id="modFolderSelect" icon="folder" label={L`Папка модов`} value={lock ?? AUTO} disabled={busy}
        options={[
          { value: AUTO, label: L`Как у игры (сейчас dota_${now})` },
          { value: 'russian', label: 'dota_russian' },
          { value: 'schinese', label: 'dota_schinese' },
          { value: 'koreana', label: 'dota_koreana' },
        ]}
        onPick={(v) => { void pick(v); }} />
    </div>
    <div className="settings-hint">{L`По умолчанию моды идут в папку языка, которую читает игра, и «-language» в параметрах запуска Steam переносит их туда при запуске приложения. Выбери папку, чтобы моды оставались в ней: пока в параметрах стоит другой язык, игра их не увидит, а когда уберёшь его, они на месте.`}</div>
  </>;
}
