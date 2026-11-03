/* The look on everybody playing a hero the user built (src/item-builder-everyone.ts): the switch,
 * the heroes it is for, and the ones the last build had to leave out.
 *
 * The game takes only so many of its files before it hands out wrong models (#414,
 * src/item-builder-everyone-budget.ts), so a big library cannot have it on every hero at once.
 * Nothing picked means every hero built, the one picked most lately first, as far as it fits; a
 * hero that did not fit is named here rather than dropped in silence. */
import type { CSSProperties } from 'react';
import { heroName } from '../ui/hero-name.ts';

export interface EveryoneActions {
  everyone: () => void;
  /** a hero ticked or unticked in the list */
  everyoneHero: (id: string) => void;
}

export interface EveryoneModel {
  on: boolean;
  /** the heroes the user built, picked last first */
  built: { id: string; name: string }[];
  /** the heroes ticked; none: all of them */
  chosen: string[];
  /** who the last build left out */
  leftOut: string[];
}

export function EveryoneBlock({ i, m, actions }: { i: number; m: EveryoneModel; actions: EveryoneActions }) {
  const label = L`Мой вид на всех, кто играет этим героем`;
  const names = new Map(m.built.map((h) => [h.id, heroName(h.name)]));
  const leftNames = m.leftOut.map((id) => names.get(id) ?? id);
  // a library of a hundred heroes leaves out dozens: the first few, and how many more
  const left = leftNames.length > 10 ? `${leftNames.slice(0, 10).join(', ')} ${L`и ещё ${leftNames.length - 10}`}` : leftNames.join(', ');
  return (
    <div className="settings-block" style={{ '--i': i } as CSSProperties}>
      <h3>{L`Конструктор предметов`}</h3>
      <div className="settings-row spaced">
        <span className="settings-label">{label}</span>
        <button className={`toggle ${m.on ? 'on' : ''}`} id="everyoneToggle" role="switch" aria-checked={m.on} aria-label={label} onClick={actions.everyone} />
      </div>
      <div className="settings-hint">{L`Кто бы ни играл героем, которого ты собрал, союзник или враг, у тебя на экране он будет в твоих предметах, а не в своих. Видишь это только ты. Работает с выключенным безопасным режимом.`}</div>
      {m.on && m.built.length > 0 && (
        <>
          <div className="settings-label settings-heroes-title">{L`Для каких героев`}</div>
          <div className="settings-heroes" role="group" aria-label={L`Для каких героев`}>
            {m.built.map((h) => {
              const on = m.chosen.includes(h.id);
              return (
                <button key={h.id} className={`fchip ${on ? 'active' : ''}`} aria-pressed={on} data-hero={h.id} onClick={() => actions.everyoneHero(h.id)}>
                  {names.get(h.id)}
                </button>
              );
            })}
          </div>
          <div className="settings-hint">
            {m.chosen.length
              ? L`Только для отмеченных героев.`
              : L`Ничего не отмечено: для всех собранных героев, начиная с тех, что ты собирал последними, сколько выдержит игра.`}
          </div>
        </>
      )}
      {m.on && leftNames.length > 0 && (
        <div className="settings-hint settings-warn" role="status">
          {L`Не поместились, иначе игра начала бы показывать чужие модели: ${left}. Отметь меньше героев, если нужен кто-то из них.`}
        </div>
      )}
    </div>
  );
}
