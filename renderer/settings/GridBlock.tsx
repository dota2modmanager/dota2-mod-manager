/* Hero grids in Settings (src/hero-grid.ts, issue #428): a switch per grid, on when the grid is in
 * the account's file. A switch writes at once, so the state is always the file's. The numbers are
 * OpenDota's, and the line under the switches says from when. */
import { useEffect, useState, type CSSProperties } from 'react';
import { toast } from '../ui/toast.ts';
import { Toggle } from './Toggle.tsx';
import type { GridKind, GridState } from '../api/app.ts';

const KINDS: Array<{ kind: GridKind; label: () => string }> = [
  { kind: 'winrate', label: () => L`По проценту побед` },
  { kind: 'attribute', label: () => L`По атрибутам, лучшие первыми` },
  { kind: 'popular', label: () => L`Чаще всего берут` },
];

export function GridBlock({ i }: { i: number }) {
  const [st, setSt] = useState<GridState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void window.api.grids.state().then(setSt).catch(() => setSt(null)); }, []);
  if (!st) return null;

  const flip = async (kind: GridKind) => {
    if (busy) return;
    const next = st.kinds.includes(kind) ? st.kinds.filter((k) => k !== kind) : [...st.kinds, kind];
    setBusy(true);
    try {
      const r = next.length ? await window.api.grids.apply(next) : await window.api.grids.remove();
      if (r.error) toast(r.error, 'error', 7000);
      else setSt(await window.api.grids.state());
    } finally {
      setBusy(false);
    }
  };

  const date = st.statsAt ? new Date(st.statsAt).toLocaleDateString(window.i18nLocale()) : null;
  return (
    <div className="settings-block" style={{ '--i': i } as CSSProperties}>
      <h3>{L`Сетки героев`}</h3>
      {KINDS.map(({ kind, label }) => (
        <div className="settings-row spaced" key={kind}>
          <span className="settings-label">{label()}</span>
          <Toggle id={`grid-${kind}`} on={st.kinds.includes(kind)} label={label()} disabled={busy || !st.account} onClick={() => { void flip(kind); }} />
        </div>
      ))}
      <div className="settings-hint">
        {st.account
          ? L`Сетки появятся в выборе героя рядом с твоими, твои остаются как были. Цифры берутся с OpenDota по всем рангам за последние дни.`
          : L`Не нашёл аккаунт Steam, в который заходила Dota 2.`}
        {date && ` ${L`Цифры от ${date}.`}`}
      </div>
    </div>
  );
}
