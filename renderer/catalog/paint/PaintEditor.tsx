/* The editor at the top of the recolour window: the colour of the layer picked (or of every layer
 * that is on), out of the system's picker, a row of ready colours or the game's prismatic gems, and
 * how a picture takes it (paint-mode.ts). The 3D hero beside it shows each change as it is made. */
import type { CSSProperties } from 'react';
import { Swatch } from './PaintTiles.tsx';
import type { PaintMode } from './paint-mode.ts';

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
}

export interface PaintEditorActions {
  color: (hex: string) => void;
  mode: (mode: PaintMode) => void;
  /** back to every layer that is on */
  all: () => void;
  toggle: () => void;
}

const READY = ['#e53935', '#ff7a1a', '#ffd23f', '#7bd64a', '#1fbf8f', '#22c3e6', '#3a7bff', '#7f5af0', '#c04bf2', '#ff4fa3', '#f5f5f5', '#2b2b2b'];

const MODES: { mode: PaintMode; icon: string; label: () => string; hint: () => string }[] = [
  { mode: 'tint', icon: 'format_paint', label: () => L`Оттенок`, hint: () => L`Цветные части берут цвет, серые и металл остаются` },
  { mode: 'keep', icon: 'texture', label: () => L`Сохранить детали`, hint: () => L`Меняется только тон: яркость и насыщенность каждой детали остаются свои` },
  { mode: 'full', icon: 'imagesearch_roller', label: () => L`Целиком`, hint: () => L`Красится всё, серое и металл тоже` },
  { mode: 'rgb', icon: 'gradient', label: () => L`Радуга`, hint: () => L`Тон бежит по кругу цветов вдоль текстуры` },
];

export function PaintEditor({ m, actions }: { m: PaintEditorModel; actions: PaintEditorActions }) {
  const gem = m.gems.find((g) => g.hex.toLowerCase() === m.color.toLowerCase());
  const lower = m.color.toLowerCase();
  return (
    <div className="paint-editor" id="paintEditor" data-layer={m.id ?? 'all'}>
      <div className="paint-editor-head">
        <Swatch color={m.color} label={m.title} onColor={actions.color} id="paintAll" cls="lg" />
        <div className="paint-editor-text">
          <div className="paint-all-title">
            <span className="paint-editor-name" title={m.title}>{m.title}</span>
            {gem && <span className="paint-gem-name">{gem.name}</span>}
          </div>
          <div className="text-meta">
            {m.id === null ? L`Цвет и режим для всех включённых. Нажми на часть героя, чтобы покрасить её отдельно.`
              : m.picture ? L`Цвет этой части; режим говорит, как текстура его берёт.` : L`Эффект берёт только цвет: его частицы окрашиваются в выбранный тон.`}
          </div>
        </div>
        {m.id !== null && (
          <span className="paint-editor-tools">
            <button className="btn btn-sm btn-ghost" role="switch" aria-checked={m.on} onClick={actions.toggle}>
              <span className="ms">{m.on ? 'toggle_on' : 'toggle_off'}</span>{m.on ? L`Включён` : L`Выключен`}
            </button>
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

      {m.picture && (
        <div className="paint-modes" role="radiogroup" aria-label={L`Как красить`}>
          {MODES.map((x) => (
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
