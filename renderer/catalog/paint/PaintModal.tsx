/* The window for a hero recoloured part by part (issue #422): a row per layer the hero has, each
 * with its switch and its colour, grouped as his abilities (the effect and the icon side by side),
 * the rest of him, and the items picked for him. A colour at the top goes to every layer that is
 * on. Reached from the hero's window in the item builder, and back to it. */
import type { CSSProperties, ReactNode } from 'react';
import { plural } from '../../ui/format.ts';
import { BuilderFoot, BuilderHead } from '../builder/parts.tsx';
import type { BuilderAction } from '../builder/model.ts';

/** One switch and colour, for one layer. */
export interface PaintCell { id: string; on: boolean; color: string }

export interface PaintModalModel {
  hero: string;
  /** the colour the top swatch gives every layer that is on */
  all: string;
  abilities: { name: string; effect: PaintCell | null; icon: PaintCell | null }[];
  /** the rest of the hero: his other effects, his icon and portrait, his body's textures */
  own: { effects: PaintCell | null; portrait: PaintCell | null; body: PaintCell | null };
  items: { name: string; cell: PaintCell }[];
  /** the layers on, by name, for the line at the foot */
  summary: string;
  action: BuilderAction;
  busy: boolean;
  /** ValveResourceFormat is there to read the compressed icons; false: a button to download it */
  vrf: boolean;
  /** downloading it */
  gettingTool: boolean;
}

export interface PaintModalActions {
  back: () => void;
  close: () => void;
  toggle: (id: string) => void;
  color: (id: string, hex: string) => void;
  all: (hex: string) => void;
  apply: () => void;
  getTool: () => void;
}

function Swatch({ color, label, onColor, id }: { color: string; label: string; onColor: (hex: string) => void; id?: string }) {
  return (
    <label className="paint-swatch" style={{ '--c': color } as CSSProperties} title={label} id={id}>
      <input type="color" value={color} aria-label={label} onInput={(e) => onColor(e.currentTarget.value)} />
    </label>
  );
}

function Cell({ cell, label, actions }: { cell: PaintCell; label: string; actions: PaintModalActions }) {
  return (
    <div className={`paint-cell ${cell.on ? 'on' : ''}`} data-layer={cell.id}>
      <button className={`toggle sm ${cell.on ? 'on' : ''}`} role="switch" aria-checked={cell.on} aria-label={label} onClick={() => actions.toggle(cell.id)} />
      <span className="paint-cell-label">{label}</span>
      <Swatch color={cell.color} label={label} onColor={(hex) => actions.color(cell.id, hex)} />
    </div>
  );
}

function Group({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <>
      <div className="section-h item-fx-head"><span className="ms">{icon}</span>{title}</div>
      <div className="paint-rows">{children}</div>
    </>
  );
}

export function PaintModal({ m, actions }: { m: PaintModalModel; actions: PaintModalActions }) {
  const count = m.abilities.reduce((n, a) => n + (a.effect ? 1 : 0) + (a.icon ? 1 : 0), 0) + (m.own.effects ? 1 : 0) + (m.own.portrait ? 1 : 0) + (m.own.body ? 1 : 0) + m.items.length;
  return (
    <div className="modal-body item-picker-body paint-body">
      <BuilderHead back={m.hero} onBack={actions.back} title={L`Перекраска`} onClose={actions.close}
        sub={<><span>{L`свой цвет для каждой части героя`}</span><span>{`· ${count} ${plural(count, 'слой', 'слоя', 'слоёв')}`}</span></>} />

      <div className="paint-all">
        <Swatch color={m.all} label={L`Цвет для всех включённых`} onColor={actions.all} id="paintAll" />
        <div>
          <div className="paint-all-title">{L`Цвет для всех включённых`}</div>
          <div className="text-meta">{L`Потом любой слой можно перекрасить отдельно.`}</div>
        </div>
      </div>

      {m.abilities.length > 0 && (
        <Group icon="bolt" title={L`Способности`}>
          {m.abilities.map((a) => (
            <div className="paint-row" key={a.name}>
              <div className="paint-row-name" title={a.name}>{a.name}</div>
              <div className="paint-row-cells">
                {a.effect ? <Cell cell={a.effect} label={L`Эффект`} actions={actions} /> : <span className="paint-cell none">{L`Эффекта нет`}</span>}
                {a.icon ? <Cell cell={a.icon} label={L`Иконка`} actions={actions} /> : <span className="paint-cell none">{L`Иконки нет`}</span>}
              </div>
            </div>
          ))}
        </Group>
      )}

      {(m.own.effects || m.own.portrait || m.own.body) && (
        <Group icon="person" title={L`Герой`}>
          <div className="paint-row">
            <div className="paint-row-name">{m.hero}</div>
            <div className="paint-row-cells">
              {m.own.effects && <Cell cell={m.own.effects} label={L`Атака и прочее`} actions={actions} />}
              {m.own.portrait && <Cell cell={m.own.portrait} label={L`Иконка и портрет`} actions={actions} />}
              {m.own.body && <Cell cell={m.own.body} label={L`Тело`} actions={actions} />}
            </div>
          </div>
        </Group>
      )}

      {m.items.length > 0 && (
        <Group icon="checkroom" title={L`Предметы`}>
          {m.items.map((it) => (
            <div className="paint-row" key={it.cell.id}>
              <div className="paint-row-name" title={it.name}>{it.name}</div>
              <div className="paint-row-cells"><Cell cell={it.cell} label={L`Эффект`} actions={actions} /></div>
            </div>
          ))}
        </Group>
      )}

      {!m.vrf && (
        <div className="paint-tool">
          <span className="text-meta">{L`Иконки и тело почти все сжаты: их читает ValveResourceFormat, его нужно один раз скачать. Собирает их компилятор Valve из Dota 2 Workshop Tools. Без него они останутся как в игре.`}</span>
          <button className="btn btn-sm" id="paintToolBtn" disabled={m.gettingTool} onClick={actions.getTool}>
            <span className="ms">{m.gettingTool ? 'progress_activity' : 'download'}</span>{L`Скачать ValveResourceFormat`}
          </button>
        </div>
      )}
      <div className="modal-note">
        {L`Цвет берут частицы, где он записан числом. Часть эффектов красит текстура: они останутся как в игре. Тело красится целиком, кожа тоже.`}
      </div>
      <div className="item-picker-foot" id="paintFoot">
        <BuilderFoot action={m.busy ? { label: L`Собираю…`, icon: 'progress_activity', off: true } : m.action} onApply={actions.apply}
          summary={m.summary || L`Ни один слой не включён`} />
      </div>
    </div>
  );
}
