/* The editor at the top of the recolour window: the colour of the layer picked (or of every layer
 * that is on), out of the system's picker, a row of ready colours or the game's prismatic gems, and
 * how a picture takes it (paint-mode.ts). A model (the body, an item's colour) has more: its parts,
 * each a texture to paint on its own, the colour zones of the texture, and the material: metalness,
 * gloss, shine and rim light (paint-recipe.ts). The 3D hero beside it shows each change as it is made. */
import type { CSSProperties } from 'react';
import { Swatch } from './PaintTiles.tsx';
import type { PaintMode } from './paint-mode.ts';
import { MATERIAL_PRESETS, type Mats, type Zone } from './paint-recipe.ts';

/** A model layer's parts, its texture's zones and the material, as the editor shows them. */
export interface PaintModelEditor {
  /** the part and zone picked; null: the whole */
  part: string | null;
  zone: Zone | null;
  parts: { id: string; name: string; picture: string | null; painted: boolean }[];
  /** the zones the texture in view has: their own mean colour and how much of it they cover */
  zones: { zone: Zone; name: string; hex: string; share: number; painted: boolean }[];
  /** pictures and zones still coming */
  loading: boolean;
  mats: Mats;
  /** the materials have masks, so the material can change in the game */
  masks: boolean;
}

export interface PaintEditorModel {
  /** the layer worked on; null: every layer that is on */
  id: string | null;
  title: string;
  color: string;
  mode: PaintMode;
  /** a picture or texture: the modes apply. An effect takes the colour alone */
  picture: boolean;
  on: boolean;
  gems: { key: string; name: string; hex: string }[];
  /** the other items drawn from the same texture, which take this colour too */
  shared?: string;
  /** no colour of its own: the texture keeps the game's, only the material changes */
  keep: boolean;
  /** the light end of a gradient map (mode grad), and where its colours meet, 0-100 */
  to?: string;
  at?: number;
  /** a part or a zone, not a whole layer */
  sub?: boolean;
  model?: PaintModelEditor;
}

export interface PaintEditorActions {
  color: (hex: string) => void;
  mode: (mode: PaintMode) => void;
  /** back to every layer that is on */
  all: () => void;
  toggle: () => void;
  /** the game's own colour: the material alone changes */
  keep: () => void;
  /** the light end of a gradient map */
  to: (hex: string) => void;
  /** where the gradient's two colours meet, 0-100 */
  at: (n: number) => void;
  /** a material channel, 0-100; null: the game's own */
  mat: (i: number, n: number | null) => void;
  preset: (key: string) => void;
  part: (part: string | null) => void;
  zone: (zone: Zone | null) => void;
}

const READY = ['#e53935', '#ff7a1a', '#ffd23f', '#7bd64a', '#1fbf8f', '#22c3e6', '#3a7bff', '#7f5af0', '#c04bf2', '#ff4fa3', '#f5f5f5', '#2b2b2b'];

const MAT_NAMES = (): { name: string; hint: string }[] => [
  { name: L`Металл`, hint: L`Отражение мира вместо своего цвета: серебро и хром. Для цветного блеска — Глянец и Блеск` },
  { name: L`Глянец`, hint: L`Насколько резкий блик` },
  { name: L`Блеск`, hint: L`Насколько яркий блик` },
  { name: L`Обводка`, hint: L`Свет по краям силуэта` },
  { name: L`Узор`, hint: L`Детальная текстура поверх цвета: светящийся узор арканы, бегущий огонь. 0 — только свой цвет` },
];

const PRESET_NAMES: Record<string, () => string> = {
  game: () => L`Как в игре`, matte: () => L`Матовый`, gloss: () => L`Глянец`, metal: () => L`Металл`, chrome: () => L`Хром`,
};

/** The parts of a model, its texture's zones and its material. */
function ModelEditor({ m, actions }: { m: PaintModelEditor; actions: PaintEditorActions }) {
  const names = MAT_NAMES();
  const preset = MATERIAL_PRESETS.find((p) => p.mats.every((x, i) => x === m.mats[i]))?.key ?? null;
  return (
    <div className="paint-model">
      {m.parts.length > 1 && (
        <div className="paint-model-row" role="radiogroup" aria-label={L`Часть модели`}>
          <span className="paint-model-h">{L`Часть`}</span>
          <button role="radio" aria-checked={m.part === null} className={`paint-part ${m.part === null ? 'active' : ''}`} onClick={() => actions.part(null)}>
            <span className="ms">select_all</span><span>{L`Вся модель`}</span>
          </button>
          {m.parts.map((p) => (
            <button key={p.id} role="radio" aria-checked={m.part === p.id} className={`paint-part ${m.part === p.id ? 'active' : ''} ${p.painted ? 'painted' : ''}`}
              data-part={p.id} title={p.name} onClick={() => actions.part(p.id)}>
              {p.picture ? <img src={p.picture} alt="" draggable={false} /> : <span className="ms">deployed_code</span>}
              <span>{p.name}</span>
            </button>
          ))}
        </div>
      )}
      <div className="paint-model-row" role="radiogroup" aria-label={L`Цвета текстуры`}>
        <span className="paint-model-h">{L`Цвета`}</span>
        <button role="radio" aria-checked={m.zone === null} className={`paint-zone ${m.zone === null ? 'active' : ''}`} onClick={() => actions.zone(null)}>{L`Все`}</button>
        {m.zones.map((z) => (
          <button key={z.zone} role="radio" aria-checked={m.zone === z.zone} className={`paint-zone ${m.zone === z.zone ? 'active' : ''} ${z.painted ? 'painted' : ''}`}
            data-zone={z.zone} style={{ '--z': z.hex } as CSSProperties} title={`${z.name}: ${Math.round(z.share * 100)}%`} onClick={() => actions.zone(z.zone)}>
            <i aria-hidden="true" />{z.name}
          </button>
        ))}
        {m.loading && <span className="ms paint-model-wait" aria-label={L`Читаю текстуры`}>progress_activity</span>}
      </div>
      <div className="paint-model-row paint-mats" role="group" aria-label={L`Материал`}>
        <span className="paint-model-h">{L`Материал`}</span>
        {MATERIAL_PRESETS.map((p) => (
          <button key={p.key} className={`paint-preset ${preset === p.key ? 'active' : ''}`} data-preset={p.key} onClick={() => actions.preset(p.key)}>
            <span className="ms">{p.icon}</span>{PRESET_NAMES[p.key]?.() ?? p.key}
          </button>
        ))}
      </div>
      <div className="paint-sliders">
        {names.map((n, i) => {
          const v = m.mats[i];
          return (
            <label key={n.name} className={`paint-slider ${v === null ? 'own' : ''}`} title={n.hint} data-mat={i}>
              <span className="paint-slider-name">{n.name}</span>
              <input type="range" min={0} max={100} step={5} value={v ?? 50} aria-label={n.name}
                onChange={(e) => actions.mat(i, Number(e.currentTarget.value))} />
              <span className="paint-slider-value">{v === null ? L`как в игре` : `${v}%`}</span>
              {v !== null && <button className="btn btn-xs btn-ghost" aria-label={L`Как в игре`} onClick={(e) => { e.preventDefault(); actions.mat(i, null); }}><span className="ms">close</span></button>}
            </label>
          );
        })}
      </div>
      {!m.masks && <div className="text-meta paint-shared"><span className="ms">info</span>{L`У материала этой части нет масок: в игре изменится только цвет, металл и блеск останутся как были.`}</div>}
    </div>
  );
}

const MODES: { mode: PaintMode; icon: string; label: () => string; hint: () => string }[] = [
  { mode: 'tint', icon: 'format_paint', label: () => L`Оттенок`, hint: () => L`Цветные части берут цвет, серые и металл остаются` },
  { mode: 'keep', icon: 'texture', label: () => L`Сохранить детали`, hint: () => L`Меняется только тон: яркость и насыщенность каждой детали остаются свои` },
  { mode: 'full', icon: 'imagesearch_roller', label: () => L`Целиком`, hint: () => L`Красится всё, серое и металл тоже` },
  { mode: 'rgb', icon: 'gradient', label: () => L`Радуга`, hint: () => L`Тон бежит по кругу цветов вдоль текстуры` },
  { mode: 'grad', icon: 'contrast', label: () => L`Градиент`, hint: () => L`Тёмное — в первый цвет, светлое и блики — во второй: рисунок текстуры остаётся` },
];

export function PaintEditor({ m, actions }: { m: PaintEditorModel; actions: PaintEditorActions }) {
  const gem = m.gems.find((g) => g.hex.toLowerCase() === m.color.toLowerCase());
  const lower = m.color.toLowerCase();
  return (
    <div className="paint-editor" id="paintEditor" data-layer={m.id ?? 'all'}>
      <div className="paint-editor-head">
        <Swatch color={m.color} label={m.title} onColor={actions.color} id="paintAll" cls={`lg ${m.keep && m.id !== null ? 'keep' : ''}`} />
        {m.mode === 'grad' && m.model && (
          <span className="paint-grad" title={L`Цвет светлого`}>
            <span className="ms" aria-hidden="true">arrow_forward</span>
            <Swatch color={m.to ?? '#ffb020'} label={L`Цвет светлого`} onColor={actions.to} id="paintTo" cls="lg" />
          </span>
        )}
        <div className="paint-editor-text">
          <div className="paint-all-title">
            <span className="paint-editor-name" title={m.title}>{m.title}</span>
            {gem && <span className="paint-gem-name">{gem.name}</span>}
          </div>
          <div className="text-meta">
            {m.id === null ? L`Цвет и режим для всех включённых. Нажми на часть героя, чтобы покрасить её отдельно.`
              : m.picture ? L`Цвет этой части; режим говорит, как текстура его берёт.` : L`Эффект берёт только цвет: его частицы окрашиваются в выбранный тон.`}
          </div>
          {m.sub && <div className="text-meta">{L`Красится только эта часть или эти цвета текстуры; остальное — как у всего слоя.`}</div>}
          {m.shared && <div className="text-meta paint-shared"><span className="ms">link</span>{L`Общая текстура с: ${m.shared}. В игре у них один цвет, поэтому они красятся вместе.`}</div>}
        </div>
        {m.id !== null && (
          <span className="paint-editor-tools">
            <button className="btn btn-sm btn-ghost" role="switch" aria-checked={m.on} onClick={actions.toggle}>
              <span className="ms">{m.on ? 'toggle_on' : 'toggle_off'}</span>{m.on ? L`Включён` : L`Выключен`}
            </button>
            {m.picture && (
              <button className="btn btn-sm btn-ghost" aria-pressed={m.keep} onClick={actions.keep} title={L`Оставить цвет из игры и менять только материал`}>
                <span className="ms">format_color_reset</span>{L`Цвет игры`}
              </button>
            )}
            <button className="btn btn-sm btn-ghost" id="paintEditorAll" onClick={actions.all}><span className="ms">select_all</span>{L`Для всех`}</button>
          </span>
        )}
      </div>

      <div className="paint-palette" role="group" aria-label={L`Готовые цвета`}>
        {READY.map((hex) => (
          <button key={hex} className={`paint-ready ${lower === hex ? 'active' : ''}`} style={{ '--c': hex } as CSSProperties} title={hex} aria-label={hex} onClick={() => actions.color(hex)} />
        ))}
        {m.gems.length > 0 && <span className="paint-palette-sep" aria-hidden="true" />}
        {m.gems.map((g) => (
          <button key={g.key} className={`arcana-gem ${g === gem ? 'active' : ''}`} style={{ '--c': g.hex } as CSSProperties} title={g.name} aria-label={g.name} onClick={() => actions.color(g.hex)} />
        ))}
      </div>

      {m.mode === 'grad' && m.model && (
        <label className="paint-slider paint-grad-at" title={L`Где тёмный цвет переходит в светлый: правее — больше первого цвета`}>
          <span className="paint-slider-name">{L`Порог`}</span>
          <input type="range" min={0} max={100} step={1} value={m.at ?? 50} aria-label={L`Порог`} onChange={(e) => actions.at(Number(e.currentTarget.value))} />
          <span className="paint-slider-value">{m.at ?? 50}</span>
        </label>
      )}

      {m.model && <ModelEditor m={m.model} actions={actions} />}

      {m.picture && (
        <div className="paint-modes" role="radiogroup" aria-label={L`Как красить`}>
          {MODES.filter((x) => x.mode !== 'grad' || m.model).map((x) => (
            <button key={x.mode} role="radio" aria-checked={m.mode === x.mode} className={`paint-mode ${m.mode === x.mode ? 'active' : ''}`} data-mode={x.mode}
              title={x.hint()} onClick={() => actions.mode(x.mode)}>
              <span className="ms">{x.icon}</span>
              <span className="paint-mode-text"><b>{x.label()}</b><span>{x.hint()}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
