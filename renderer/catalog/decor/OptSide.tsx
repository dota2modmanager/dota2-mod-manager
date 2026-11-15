/* The Optimization window's side: the level of detail for everything at once, then a slider for
 * each kind of thing in its section, its steps from the game as it is to the most taken out
 * (levels.ts), with how many of the game's files the slider's steps take and an effect with a
 * picture of one of its effects. The map of one's own (MapSide.tsx) has the dark look's slider. */
import { useEffect, useState } from 'react';
import type { DecorModalActions, DecorModalModel } from './DecorModal.tsx';
import { LEVELS, SLIDER_GROUPS, levelOf, stepOf, type LevelId, type SliderId } from './levels.ts';

export interface SliderText { id: SliderId; name: () => string; steps: (() => string)[] }

/** The dark look: a slider of the map of one's own, its steps written into the map. */
export const DARK: SliderText = { id: 'dark', name: () => L`Тёмная карта`, steps: [() => L`Как в игре`, () => L`Сумерки: земля темнее`, () => L`Тёмная: как ночью, но не ночь`] };

/** Optimization's sliders in their sections, each step's words from the game as it is on. */
export const SECTIONS: { title: () => string; sliders: SliderText[] }[] = [
  { title: () => L`Карта`, sliders: [
    { id: 'plants', name: () => L`Растения`, steps: [() => L`Как в игре`, () => L`Без цветов, зверей и птиц`, () => L`Без травы и кустов`] },
    { id: 'debris', name: () => L`Камни и мусор`, steps: [() => L`Как в игре`, () => L`Без пятен крови и лепестков`, () => L`Без камней, костей и обломков`] },
    { id: 'water', name: () => L`Вода`, steps: [() => L`Как в игре`, () => L`Без водопадов`, () => L`Без течения реки, кромки воды и лавы`] },
  ] },
  { title: () => L`Свет`, sliders: [
    { id: 'lights', name: () => L`Освещение`, steps: [() => L`Как в игре`, () => L`Без лучей света и светлячков`, () => L`Без огней фонарей, факелов и свечей`] },
  ] },
  { title: () => L`Эффекты`, sliders: [
    { id: 'mapFx', name: () => L`Эффекты карты и зданий`, steps: [() => L`Как в игре`, () => L`Без свечения трона, зданий, колонн и фонтанов`] },
    { id: 'courierFx', name: () => L`Эффекты курьеров`, steps: [() => L`Как в игре`, () => L`Без огня, искр и следов у курьеров`] },
    { id: 'eventFx', name: () => L`Эффекты событий`, steps: [() => L`Как в игре`, () => L`Без эффектов ивентов и боевых пропусков`] },
  ] },
  { title: () => L`Погода`, sliders: [
    { id: 'weather', name: () => L`Погода`, steps: [() => L`Как в игре`, () => L`Без дождя, снега и прочей погоды`] },
  ] },
];

const LEVEL_NAMES: Record<LevelId, () => string> = {
  original: () => L`Оригинал`,
  high: () => L`Высокая`,
  medium: () => L`Средняя`,
  low: () => L`Низкая`,
  minimal: () => L`Минимум`,
};

/** Sliders the whole map shows by hiding or swapping parts; the rest are effects, shown by a picture. */
const ON_MAP = new Set<SliderId>(['plants', 'debris', 'water', 'lights', 'dark']);

function EffectPicture({ path, off }: { path: string | undefined; off: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    if (path) void import('../preview3d/effect-thumb.ts').then(({ effectThumb }) => effectThumb(path)).then((uri) => { if (!gone) setSrc(uri); }, () => {});
    return () => { gone = true; };
  }, [path]);
  if (!src) return null;
  return <span className={`opt-fx ${off ? 'off' : ''}`}><img src={src} alt="" /></span>;
}

export function Slider({ s, m, actions }: { s: SliderText; m: DecorModalModel; actions: DecorModalActions }) {
  const step = stepOf(s.id, m.groups);
  const groups = SLIDER_GROUPS[s.id];
  // the dark's steps are the same files done more: count the step, not the sum
  const same = s.id === 'dark';
  const files = same ? m.counts?.[groups[Math.max(step, 1) - 1]] ?? 0 : groups.slice(0, Math.max(step, 1)).reduce((n, g) => n + (m.counts?.[g] ?? 0), 0);
  const empty = m.counts !== null && groups.every((g) => !m.counts?.[g]);
  return (
    <div className={`opt-slider ${step ? 'active' : ''} ${empty ? 'empty' : ''}`}>
      <div className="opt-slider-head">
        <b>{s.name()}</b>
        {m.counts && <span className="decor-count">{step ? L`Файлов: ${files}` : ''}</span>}
        {!ON_MAP.has(s.id) && <EffectPicture path={m.samples?.[groups[0]]?.particles[0]} off={step > 0} />}
      </div>
      <input type="range" min={0} max={s.steps.length - 1} step={1} value={step} disabled={empty}
        aria-label={s.name()} aria-valuetext={s.steps[step]()} onChange={(e) => actions.step(s.id, Number(e.currentTarget.value))} />
      <div className="opt-slider-ticks" aria-hidden="true">
        {s.steps.map((_, i) => <span key={i} className={i === step ? 'on' : ''} onClick={() => !empty && actions.step(s.id, i)} />)}
      </div>
      <span className="opt-slider-step">{s.steps[step]()}</span>
    </div>
  );
}

export function OptSide({ m, actions }: { m: DecorModalModel; actions: DecorModalActions }) {
  const level = levelOf(m.groups);
  return (
    <>
      <div className="opt-base">{m.mapName ? L`Строится на карте, которая стоит: ${m.mapName}` : L`Строится на карте, которая стоит: стандартная`}</div>
      <div className="decor-section-title">{L`Детализация`}</div>
      <div className="opt-levels" role="radiogroup" aria-label={L`Детализация`}>
        {LEVELS.map((l) => (
          <button key={l} role="radio" aria-checked={level === l} className={`opt-level ${level === l ? 'active' : ''}`} onClick={() => actions.level(l)}>
            {LEVEL_NAMES[l]()}
          </button>
        ))}
      </div>
      {level === 'custom' && <div className="opt-custom">{L`Свой набор`}</div>}
      <div className="decor-groups" id="decorGroups">
        {SECTIONS.map((sec) => (
          <div key={sec.title()} className="decor-section">
            <div className="decor-section-title">{sec.title()}</div>
            {sec.sliders.map((s) => <Slider key={s.id} s={s} m={m} actions={actions} />)}
          </div>
        ))}
      </div>
    </>
  );
}
