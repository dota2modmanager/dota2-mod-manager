/* "Game files" in Settings (3.0): the two ways the app puts mods into Dota, and the one switch that
 * replaced safe mode. On means the game reads the item table (the looks from the game, the builder,
 * mods' effects); off puts gameinfo and dota.signatures back byte for byte. Turning it on asks the
 * same question the first look picked asks (ui/game-files.ts), so there is one place it is
 * explained and one place it is undone. */
import { useState, type CSSProperties } from 'react';
import { state } from '../core/store.ts';
import { allowItemTable, setItemTable } from '../ui/game-files.ts';
import { confirmDialog } from '../ui/dialog.ts';
import { Swap } from '../motion/Swap.tsx';
import { Toggle } from './Toggle.tsx';
import { ModFolderRow } from './ModFolderRow.tsx';

/** The edit fell off or half-landed: a Dota update, Steam's file check, another patcher. */
function trouble(): boolean {
  const st = state.patchState;
  if (!st || !state.settings?.schemaPatch) return false;
  // `signable` is false where the game ships no signature list (Linux): unsigned is finished there
  return Boolean(st.stale || !st.patched || (st.signable && !st.signed) || st.foreign);
}

export function GameFilesBlock({ i, everyone, onEveryone }: { i: number; everyone: boolean; onEveryone: () => void }) {
  // read from the settings on every draw, not kept here: a screen drawn again (a language change
  // remounts it) from a copy taken mid-switch showed the table off while it was on (2026-11-04)
  const on = Boolean(state.settings?.schemaPatch);
  const [, redraw] = useState(0);
  const [busy, setBusy] = useState(false);

  const flip = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!on) await allowItemTable();
      else if (await confirmDialog(L`Вернуть файлы игры к оригиналу? Виды из игры и эффекты модов перестанут работать, VPK-моды останутся.`, { okLabel: L`Вернуть`, danger: false })) {
        await setItemTable(false);
      }
    } finally {
      setBusy(false); // draws again, with what setItemTable left in the settings
    }
  };

  return (
    <div className="settings-block" style={{ '--i': i } as CSSProperties}>
      <h3>{L`Файлы игры`}</h3>
      <div className="settings-hint">{L`Приложение ставит моды двумя способами. VPK-моды кладёт в папку, которую Dota читает сама, и файлы игры не трогает. Предметы героев идут туда же. Остальные виды из игры и эффекты модов работают через таблицу предметов: ради неё приложение вписывает свою папку в gameinfo_branchspecific.gi и подписывает его в dota.signatures.`}</div>
      <div className="settings-row spaced">
        <span className="settings-label">{L`Таблица предметов`}</span>
        <Swap className="settings-state" value={on}>{on ? L`работает` : L`выключена, файлы игры как у Valve`}</Swap>
        <Toggle id="itemTableSwitch" on={on} label={L`Таблица предметов`} disabled={busy} onClick={() => { void flip(); }} />
      </div>
      <div className="settings-hint">{L`Это и есть «небезопасный режим» прошлых версий. Выключишь его, и приложение вернёт gameinfo и dota.signatures как у Valve, а VPK-моды продолжат работать.`}</div>
      {trouble() && <div className="settings-hint warn">{L`Правку в файлах игры стёрло обновление Dota или проверка файлов Steam. Приложение впишет её заново при запуске игры кнопкой «Играть» или по кнопке «Починить приложение» ниже.`}</div>}
      <div className="settings-row spaced">
        <span className="settings-label">{L`Мой вид на всех, кто играет этим героем`}</span>
        <Toggle id="everyoneToggle" on={everyone} label={L`Мой вид на всех, кто играет этим героем`} disabled={!on} onClick={onEveryone} />
      </div>
      <div className="settings-hint">{L`Кто бы ни играл героем, которого ты собрал в конструкторе, союзник или враг, у тебя на экране он будет в твоих предметах. Видишь это только ты.`}</div>
      <ModFolderRow redraw={() => redraw((n) => n + 1)} />
    </div>
  );
}
