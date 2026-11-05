/* The 3D preview in the item builder's hero window (issue #417): the hero turning slowly in what
 * each slot wears now. It asks the main process for the models when it is shown and again when a
 * pick changes (`sig`), and draws them with the scene beside this file, loaded only then. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Preview3dApi } from '../../api/content.ts';

type Status = { kind: 'loading' } | { kind: 'shown'; missing: string[] } | { kind: 'no-tool' } | { kind: 'failed'; text: string };

/** @param fallback  what the stage shows when the models cannot be had (the hero window's portrait), the reason under it */
export function Preview3d({ hero, slots, sig, still = false, fallback }: {
  hero: string; slots: { slot: string; stock: string }[]; sig: string; still?: boolean; fallback?: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let gone = false;
    let dispose: (() => void) | null = null;
    setStatus({ kind: 'loading' });
    void (async () => {
      const r: Awaited<ReturnType<Preview3dApi['models']>> = await window.api.preview3d.models(hero, slots);
      if (gone) return;
      if (!r.ok) {
        setStatus(r.reason === 'no-tool' ? { kind: 'no-tool' }
          : { kind: 'failed', text: r.reason === 'no-game' ? L`Не найдена папка игры` : L`Не удалось достать модель героя из игры` });
        return;
      }
      try {
        const { mountScene } = await import('./scene.ts');
        if (gone || !host.current) return;
        const off = await mountScene(host.current, r.body, r.parts.map((p) => p.glb), { still });
        if (gone) { off(); return; }
        dispose = off;
        setStatus({ kind: 'shown', missing: r.missing });
      } catch (err) {
        if (!gone) setStatus({ kind: 'failed', text: String((err as Error)?.message || err) });
      }
    })();
    return () => { gone = true; dispose?.(); };
    // the slots are what `sig` says; a new array each draw is not a new look
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hero, sig, attempt]);

  const getTool = async () => {
    setStatus({ kind: 'loading' });
    const r = await window.api.tools.install('vrf');
    if ('error' in r && r.error) setStatus({ kind: 'failed', text: r.error });
    else setAttempt((n) => n + 1);
  };

  return (
    <div className="preview3d" id="preview3d" data-status={status.kind}>
      <div className="preview3d-stage" ref={host} />
      {status.kind === 'loading' && (
        <div className="preview3d-note"><span className="ms">progress_activity</span>{L`Достаю модели из игры…`}</div>
      )}
      {status.kind === 'no-tool' && (
        <div className="preview3d-note">
          <span>{L`Модели из игры достаёт ValveResourceFormat, его нужно один раз скачать.`}</span>
          <button className="btn btn-sm" id="preview3dTool" onClick={() => void getTool()}><span className="ms">download</span>{L`Скачать`}</button>
        </div>
      )}
      {status.kind === 'failed' && (fallback
        ? <>{fallback}<div className="preview3d-missing" title={status.text}>{status.text}</div></>
        : <div className="preview3d-note"><span className="ms">error</span>{status.text}</div>)}
      {status.kind === 'shown' && status.missing.length > 0 && (
        <div className="preview3d-missing" title={status.missing.join(', ')}>{L`Без модели: ${status.missing.length}`}</div>
      )}
    </div>
  );
}
