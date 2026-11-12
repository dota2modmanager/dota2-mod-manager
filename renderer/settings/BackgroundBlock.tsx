/* "Работа в фоне" in Settings (src/tray.ts): start with Windows and hide in the tray on close, so
 * the app is there to put the game back when a Dota update lands. Read from the settings on every
 * draw; the switch writes at once, and main moves the tray and the sign-in entry with it. */
import { useState, type CSSProperties } from 'react';
import { state } from '../core/store.ts';
import { Toggle } from './Toggle.tsx';
import { setRunInBackground } from './background.ts';

export function BackgroundBlock({ i }: { i: number }) {
  const on = state.settings?.runInBackground !== false;
  const [busy, setBusy] = useState(false);
  const flip = async () => {
    if (busy) return;
    setBusy(true);
    try {
      state.settings = await setRunInBackground(!on);
    } finally {
      setBusy(false);
    }
  };
  const label = L`Запускать вместе с Windows и сворачивать в трей`;
  return (
    <div className="settings-block" id="backgroundBlock" style={{ '--i': i } as CSSProperties}>
      <h3>{L`Работа в фоне`}</h3>
      <div className="settings-row spaced">
        <span className="settings-label">{label}</span>
        <Toggle id="backgroundToggle" on={on} label={label} disabled={busy} onClick={() => { void flip(); }} />
      </div>
      <div className="settings-hint">
        {L`Когда Дота обновляется, приложение возвращает моды и таблицу предметов на место, но только пока оно запущено. Если обновление пришло при закрытом приложении, игра из Steam может выдать ошибку или запуститься без модов. С этой настройкой приложение стартует вместе с Windows без окна, а крестик прячет его в трей: оттуда оно следит за обновлениями и за вылетами после «Играть». Выйти совсем можно правым кликом по значку в трее.`}
      </div>
    </div>
  );
}
