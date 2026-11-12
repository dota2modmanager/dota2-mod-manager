/* The 3D preview in the item builder's hero window (issue #417): the hero turning slowly in what
 * each slot wears now. It asks the main process for the models when it is shown and again when a
 * pick changes (`sig`), and draws them with the scene beside this file, loaded only then. Over the
 * stage, what the hero is doing: the loadout, or any other clip of its body, which stays through a
 * change of items, or plays once and hands back if it is a motion with an end; the clips come in
 * one file the first time one is asked for. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Motion, Preview3dApi, PreviewSlot } from '../../api/preview3d.ts';
import type { HeroScene, SceneOptions, SceneViewport } from './scene.ts';
import { Dropdown } from '../../ui/Dropdown.tsx';
import { motionLabels } from './motion-label.ts';
import type { StudioView } from './studio-settings.ts';

import type { PreviewGem } from '../builder/gems.ts';
import { NO_PAINT, type PreviewPaint } from '../paint/preview-paint.ts';

const noGems: readonly PreviewGem[] = [];

type Status = { kind: 'loading' } | { kind: 'shown'; missing: string[] } | { kind: 'no-tool' } | { kind: 'failed'; text: string };

const MOTION_ICON: Record<Motion['group'], string> = {
  stance: 'accessibility_new', idle: 'self_improvement', run: 'directions_run', attack: 'swords', ability: 'auto_awesome', emote: 'celebration', other: 'more_horiz',
};

/** What the game calls an activity, in this window's language; null for one with no plain word. */
function motionWord(act: string, ability: string | null): string | null {
  if (ability) return L`Способность ${ability}`;
  switch (act) {
    case 'LOADOUT': return L`Стойка`;
    case 'LOADOUT_RARE': return L`Редкая стойка`;
    case 'SPAWN': return L`Появление`;
    case 'IDLE': return L`Покой`;
    case 'IDLE_RARE': return L`Редкий покой`;
    case 'RUN': return L`Бег`;
    case 'ATTACK': return L`Атака`;
    case 'TAUNT': return L`Насмешка`;
    case 'VICTORY': return L`Победа`;
    case 'DEFEAT': return L`Поражение`;
    case 'DIE': return L`Смерть`;
    case 'FLAIL': return L`В воздухе`;
    case 'DISABLED': return L`Оглушение`;
    case 'TELEPORT': return L`Телепорт`;
    case 'TELEPORT_END': return L`Конец телепорта`;
    case 'GENERIC_CHANNEL': return L`Каст с удержанием`;
    case 'CAPTURE': return L`Портрет`;
    case 'VERSUS': return L`Перед боем`;
    default: return null;
  }
}

/**
 * @param fallback  what the stage shows when the models cannot be had (the hero window's portrait), the reason under it
 * @param paint     the recolour window's colours (catalog/paint/preview-paint.ts), drawn as they change
 */
export function Preview3d({ hero, slots, sig, gems = noGems, paint = NO_PAINT, still = false, fallback, onSettled }: {
  hero: string; slots: PreviewSlot[]; sig: string; gems?: readonly PreviewGem[]; paint?: PreviewPaint; still?: boolean; fallback?: ReactNode; onSettled?: (result: { sig: string; ok: boolean }) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const savedView = useRef<{ hero: string; view: StudioView } | null>(null);
  const motionRequest = useRef(0);
  const scene = useRef<HeroScene | null>(null);
  const latestGems = useRef(gems);
  useEffect(() => {
    latestGems.current = gems;
    const timer = setTimeout(() => {
      void scene.current?.gems(gems).catch(error => {
        if (error?.name !== 'AbortError') console.warn('3D gem preview:', error);
      });
    }, 100);
    return () => clearTimeout(timer);
  }, [gems]);
  const latestPaint = useRef(paint);
  useEffect(() => {
    latestPaint.current = paint;
    scene.current?.paint(paint);
  }, [paint]);
  const viewport = useRef<SceneViewport | null>(null);
  const mountQueue = useRef(Promise.resolve());
  const lifetime = useRef<AbortController | null>(null);

  useEffect(() => {
    const session = new AbortController();
    lifetime.current = session;
    return () => {
      session.abort();
      scene.current?.dispose();
      scene.current = null;
      viewport.current?.dispose();
      viewport.current = null;
    };
  }, []);

  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [motions, setMotions] = useState<Motion[]>([]);
  const [motion, setMotion] = useState('');
  const [busy, setBusy] = useState(false);
  const [noMotions, setNoMotions] = useState(false);
  const wanted = useRef('');
  const body = useRef('');
  // a body's clips, kept for the next time a pick changes the scene and not the body
  const clips = useRef(new Map<string, Promise<Uint8Array | null>>());
  const motionFile = () => {
    const model = body.current;
    if (!clips.current.has(model)) clips.current.set(model, window.api.preview3d.motions(model));
    return clips.current.get(model)!;
  };

  useEffect(() => {
    let gone = false;
    const session = lifetime.current!;
    motionRequest.current++;
    setBusy(false);
    setStatus(current => current.kind === 'shown' ? current : { kind: 'loading' });
    void (async () => {
      try {
        const r: Awaited<ReturnType<Preview3dApi['models']>> = await window.api.preview3d.models(hero, slots);
        if (gone) return;
        if (!r.ok) {
          onSettled?.({ sig, ok: false });
          setStatus(r.reason === 'no-tool' ? { kind: 'no-tool' }
            : { kind: 'failed', text: r.reason === 'no-game' ? L`Не найдена папка игры` : L`Не удалось достать модель героя из игры` });
          return;
        }
        const { mountScene, createSceneViewport } = await import('./scene.ts');
        if (gone || !host.current) return;
        const update = mountQueue.current.catch(() => {}).then(async () => {
          if (gone || session.signal.aborted || !host.current) return;
          const previous = scene.current;
          const initialGems = latestGems.current;
          const options: SceneOptions = {
            signal: session.signal, gems: initialGems, paint: latestPaint.current, partSlots: r.parts.map(p => p.slot),
            viewState: savedView.current?.hero === hero ? previous?.view() ?? savedView.current.view : undefined,
            still, label: L`Герой в 3D`, clip: r.clip, heroModel: r.model, stage: r.stage, pedestal: r.pedestal, hidden: { body: r.hidden, parts: r.parts.map((p) => p.hidden) },
            attachments: { body: r.attachments, parts: r.parts.map((p) => p.attachments) }, particles: r.particles, sprites: r.sprites, resources: r.resources,
          };
          const parts = r.parts.map(p => p.glb);
          const current = () => !gone && !session.signal.aborted;
          const reused = savedView.current?.hero === hero && await previous?.replace(r.body, parts, options, current);
          if (!current()) return;
          let shown = previous!;
          if (!reused) {
            await previous?.suspend();
            if (!current() || !host.current) return;
            const shared = viewport.current ??= createSceneViewport(host.current, L`Герой в 3D`);
            shown = await mountScene(host.current, r.body, parts, options, shared);
            if (session.signal.aborted) { shown.dispose(); return; }
            previous?.dispose();
            scene.current = shown;
          }
          if (initialGems !== latestGems.current) await shown.gems(latestGems.current);
          shown.paint(latestPaint.current);
          savedView.current = { hero, view: shown.view() };
          if (gone) return;
          body.current = r.model;
          setMotions(r.motions);
          // an item that swaps the body takes the clips of the old one with it
          if (wanted.current && !r.motions.some((m) => m.name === wanted.current)) { wanted.current = ''; setMotion(''); }
          if (wanted.current && !reused) {
            void shown.play(wanted.current, motionFile, handBack(r.motions, wanted.current)).catch(() => {
              if (!gone) setNoMotions(true);
            });
          }
          setStatus({ kind: 'shown', missing: r.missing });
          onSettled?.({ sig, ok: r.missing.length === 0 });
        });
        mountQueue.current = update;
        await update;
      } catch (err) {
        if (!gone) {
          setStatus({ kind: 'failed', text: String((err as Error)?.message || err) });
          onSettled?.({ sig, ok: false });
        }
      }
    })();
    return () => { gone = true; };
    // the slots are what `sig` says; a new array each draw is not a new look
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hero, sig, attempt, still]);

  const getTool = async () => {
    setStatus({ kind: 'loading' });
    const r = await window.api.tools.install('vrf');
    if ('error' in r && r.error) setStatus({ kind: 'failed', text: r.error });
    else setAttempt((n) => n + 1);
  };

  /** The end of a motion that has one: the list goes back to the hero's own. */
  const handBack = (list: Motion[], name: string) => (list.find((m) => m.name === name)?.once ? () => {
    if (wanted.current !== name) return;
    wanted.current = '';
    setMotion('');
  } : undefined);

  const pickMotion = async (name: string) => {
    wanted.current = name;
    setMotion(name);
    setNoMotions(false);
    setBusy(true);
    const request = ++motionRequest.current;
    const played = await scene.current?.play(name || null, motionFile, handBack(motions, name)).catch(() => false);
    if (request !== motionRequest.current) return;
    setBusy(false);
    if (played === false && wanted.current === name) {
      clips.current.delete(body.current);
      wanted.current = '';
      setMotion('');
      setNoMotions(true);
    }
  };

  return (
    <div className="preview3d preview3d-studio" id="preview3d" data-status={status.kind}>
      <div className="preview3d-stage" ref={host} />
      {status.kind === 'shown' && (
        <div className="preview3d-tools" data-busy={busy}>
          {motions.length > 0 && (
            <Dropdown id="preview3dMotion" icon={busy ? 'progress_activity' : 'animation'} label={L`Анимация`} value={motion} first={L`Как в игре`}
              options={motionLabels(motions, motionWord).map((label, i) => ({ value: motions[i].name, label, icon: MOTION_ICON[motions[i].group] }))}
              onPick={(name) => void pickMotion(name)} />
          )}
          <button className="btn btn-sm btn-ghost preview3d-home" id="preview3dHome" title={L`Вернуть вид`} aria-label={L`Вернуть вид`}
            onClick={() => scene.current?.resetView()}>
            <span className="ms">center_focus_strong</span>
          </button>
        </div>
      )}
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
      {status.kind === 'shown' && (noMotions || status.missing.length > 0) && (
        <div className="preview3d-missing" title={status.missing.join(', ')}>
          {noMotions ? L`Не удалось достать анимации` : L`Без модели: ${status.missing.length}`}
        </div>
      )}
      {status.kind === 'shown' && (
        <div className="preview3d-hint" aria-hidden="true">
          <span><b>{L`Левая кнопка`}</b> {L`вращать`}</span>
          <span><b>{L`Правая`}</b> {L`двигать`}</span>
          <span><b>{L`Колесо`}</b> {L`ближе`}</span>
          <span><b>WASD, Q, E</b> {L`лететь`}</span>
          <span><b>Shift</b> {L`быстрее`}</span>
        </div>
      )}
    </div>
  );
}
