/* The look on everybody playing a hero the user built (src/item-builder-everyone.ts): the switch,
 * the heroes it is for, and the ones the last build had to leave out.
 *
 * The game takes only so many of its files before it hands out wrong models (#414,
 * src/item-builder-everyone-budget.ts), so a big library cannot have it on every hero at once.
 * Every hero built is in, the one built most lately first, as far as it fits, but those the user
 * excluded; a hero that did not fit is named here rather than dropped in silence. */
import type { CSSProperties } from 'react';
import { heroName } from '../ui/hero-name.ts';
import { HeroPicker } from './HeroPicker.tsx';

export interface EveryoneActions {
  everyone: () => void;
  /** a hero excluded, or let back in */
  everyoneHero: (id: string) => void;
}

export interface EveryoneModel {
  on: boolean;
  /** the heroes the user built, picked last first */
  built: { id: string; name: string }[];
  /** the heroes left alone; every other one built is dressed */
  excluded: string[];
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
          {/* a hundred heroes built is a hundred chips: only the excluded ones are drawn, the rest are typed */}
          <div className="settings-row spaced settings-heroes-title">
            <span className="settings-label">{L`Кроме героев`}</span>
            <HeroPicker built={m.built} chosen={m.excluded} names={names} onPick={actions.everyoneHero} />
          </div>
          {m.excluded.length > 0 && (
            <div className="settings-heroes" role="group" aria-label={L`Кроме героев`}>
              {m.excluded.map((id) => (
                <button key={id} className="fchip" data-hero={id} aria-label={L`Вернуть ${names.get(id) ?? id}`} onClick={() => actions.everyoneHero(id)}>
                  {names.get(id) ?? id}<span className="ms">close</span>
                </button>
              ))}
            </div>
          )}
          <div className="settings-hint">{L`Все собранные герои, начиная с тех, что ты собирал последними, сколько выдержит игра. Исключи тех, кто не нужен.`}</div>
        </>
      )}
      {m.on && leftNames.length > 0 && (
        <div className="settings-hint settings-warn" role="status">
          {L`Не поместились, иначе игра начала бы показывать чужие модели: ${left}. Исключи тех, кто не нужен, чтобы освободить место.`}
        </div>
      )}
    </div>
  );
}
