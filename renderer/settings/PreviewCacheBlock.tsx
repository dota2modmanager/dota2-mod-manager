import { useEffect, useRef, useState } from 'react';
import type { PreviewSlot } from '../api/preview3d.ts';
import { Row } from './parts.tsx';

type Progress = { done: number; total: number; failed: number; partial: number };

export function PreviewCacheRow({ ready, game }: { ready: boolean; game: boolean }) {
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState('');
  const stop = useRef(false);
  const active = useRef(false);
  useEffect(() => () => { stop.current = true; }, []);

  async function prepare() {
    if (active.current || !ready || !game) return;
    active.current = true;
    stop.current = false;
    setRunning(true);
    setProgress(null);
    setError('');
    try {
      const { slots } = await window.api.cosmetics.slots();
      const heroes = new Map<string, PreviewSlot[]>();
      for (const slot of slots ?? []) {
        if (!slot.targetId || slot.abilityFx) continue;
        for (const hero of slot.heroIds ?? []) {
          const list = heroes.get(hero) ?? [];
          list.push({ slot: slot.slot, stock: String(slot.targetId) });
          heroes.set(hero, list);
        }
      }
      if (!heroes.size) { setError(L`Список героев пока недоступен.`); return; }
      const next = { done: 0, total: heroes.size, failed: 0, partial: 0 };
      setProgress({ ...next });
      for (const [hero, picks] of heroes) {
        if (stop.current) break;
        const result = await window.api.preview3d.warm(hero, picks);
        if (result.error) { setError(result.error); break; }
        next.done++;
        if (!result.ok) next.failed++;
        else if (result.missing) next.partial++;
        setProgress({ ...next });
      }
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      active.current = false;
      setRunning(false);
      setStopping(false);
    }
  }

  const notes = [
    (!ready || !game) && <span key="need">{L`Для выгрузки нужны установленная Dota 2 и инструмент Source 2.`}</span>,
    progress && <span key="progress" role="status">
      {L`Обработано героев: ${progress.done} из ${progress.total}`}
      {progress.failed > 0 && <span> · {L`Ошибки: ${progress.failed}`}</span>}
      {progress.partial > 0 && <span> · {L`Частично: ${progress.partial}`}</span>}
    </span>,
    error && <span key="error" role="alert">{error}</span>,
  ].filter(Boolean);
  return (
    <Row label={L`Кэш 3D-превью`} hint={notes.length ? <>{notes}</> : undefined}
      more={L`По желанию: заранее выгружает GLB и ресурсы частиц для текущего набора каждого героя. При следующем открытии 3D-превью готовые файлы берутся из локального кэша. Выгрузка может занять время и место на диске. Картинки каталога не выгружаются.`}>
      {running && <button className="btn btn-sm" disabled={stopping} onClick={() => { stop.current = true; setStopping(true); }}>
        {stopping ? L`Завершаем текущего героя…` : L`Остановить`}
      </button>}
      <button className="btn btn-sm" disabled={running || !ready || !game} onClick={() => void prepare()}>
        {L`Выгрузить модели и эффекты`}
      </button>
    </Row>
  );
}
