/* "Game files" in Settings (3.0): the two ways the app puts mods into Dota, and the one switch that
 * replaced safe mode. On means the game reads the item table (the looks from the game, the builder,
 * mods' effects); off puts gameinfo and dota.signatures back byte for byte. Turning it on asks the
 * same question the first look picked asks (ui/game-files.ts), so there is one place it is
 * explained and one place it is undone.
 *
 * Under it, the look on everybody (crates/mm-core/src/item_builder/item_builder_everyone.rs): every hero the user
 * built, the one built most lately first, but those excluded here. The game takes only so many of
 * its files before it hands out wrong models (#414, item_builder_everyone_budget.rs), so a hero
 * that did not fit is named here rather than dropped in silence. */
import { useState } from 'react';
import { state } from '../core/store.ts';
import { allowItemTable, setItemTable } from '../ui/game-files.ts';
import { confirmDialog } from '../ui/dialog.ts';
import { Swap } from '../motion/Swap.tsx';
import { Toggle } from './Toggle.tsx';
import { ModFolderRow } from './ModFolderRow.tsx';
import { Row } from './parts.tsx';
import { HeroPicker } from './HeroPicker.tsx';
import { heroName } from '../ui/hero-name.ts';

export interface EveryoneModel {
  on: boolean;
  /** the heroes the user built, picked last first */
  built: { id: string; name: string }[];
  /** the heroes left alone; every other one built is dressed */
  excluded: string[];
  /** who the last build left out */
  leftOut: string[];
}

/** The edit fell off or half-landed: a Dota update, Steam's file check, another patcher. */
function trouble(): boolean {
  const st = state.patchState;
  if (!st || !state.settings?.schemaPatch) return false;
  // `signable` is false where the game ships no signature list (Linux): unsigned is finished there
  return Boolean(st.stale || !st.patched || (st.signable && !st.signed) || st.foreign);
}

export function GameFilesRows({ everyone, onEveryone, onHero }: { everyone: EveryoneModel; onEveryone: () => void; onHero: (id: string) => void }) {
  // read from the settings on every draw, not kept here: a screen drawn again (a language change
  // remounts it) from a copy taken mid-switch showed the table off while it was on (2026-11-04)
  const on = Boolean(state.settings?.schemaPatch);
  const [, redraw] = useState(0);
  const [busy, setBusy] = useState(false);

  const flip = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!on) await allowItemTable();
      else if (await confirmDialog(L`Вернуть файлы игры к оригиналу? Виды из игры и эффекты модов перестанут работать, VPK-моды останутся.`, { okLabel: L`Вернуть`, danger: false })) {
        await setItemTable(false);
      }
    } finally {
      setBusy(false); // draws again, with what setItemTable left in the settings
    }
  };

  const everyoneLabel = L`Мой вид на всех, кто играет этим героем`;
  return (
    <>
      <Row label={L`Таблица предметов`}
        hint={<Swap className="settings-state" value={on}>{on ? L`работает` : L`выключена, файлы игры как у Valve`}</Swap>}
        more={<>
          <p>{L`Приложение ставит моды двумя способами. VPK-моды кладёт в папку, которую Dota читает сама, и файлы игры не трогает. Предметы героев идут туда же. Остальные виды из игры и эффекты модов работают через таблицу предметов: ради неё приложение вписывает свою папку в gameinfo_branchspecific.gi и подписывает его в dota.signatures.`}</p>
          <p>{L`Это и есть «небезопасный режим» прошлых версий. Выключишь его, и приложение вернёт gameinfo и dota.signatures как у Valve, а VPK-моды продолжат работать.`}</p>
        </>}>
        <Toggle id="itemTableSwitch" on={on} label={L`Таблица предметов`} disabled={busy} onClick={() => { void flip(); }} />
      </Row>
      {trouble() && <div className="settings-hint warn set-warn">{L`Правку в файлах игры стёрло обновление Dota или проверка файлов Steam. Приложение впишет её заново при запуске игры кнопкой «Играть» или по кнопке «Починить приложение» ниже.`}</div>}
      <Row label={everyoneLabel}
        hint={L`Кто бы ни играл героем, которого ты собрал в конструкторе, союзник или враг, у тебя на экране он будет в твоих предметах. Видишь это только ты.`}>
        <Toggle id="everyoneToggle" on={everyone.on} label={everyoneLabel} disabled={!on} onClick={onEveryone} />
      </Row>
      {on && everyone.on && everyone.built.length > 0 && <EveryoneHeroes m={everyone} onHero={onHero} />}
      <ModFolderRow redraw={() => redraw((n) => n + 1)} />
    </>
  );
}

/** Which heroes the look on everybody leaves alone, and who the last build could not fit. */
function EveryoneHeroes({ m, onHero }: { m: EveryoneModel; onHero: (id: string) => void }) {
  const names = new Map(m.built.map((h) => [h.id, heroName(h.name)]));
  const leftNames = m.leftOut.map((id) => names.get(id) ?? id);
  // a library of a hundred heroes leaves out dozens: the first few, and how many more
  const left = leftNames.length > 10 ? `${leftNames.slice(0, 10).join(', ')} ${L`и ещё ${leftNames.length - 10}`}` : leftNames.join(', ');
  return (
    <>
      {/* a hundred heroes built is a hundred chips: only the excluded ones are drawn, the rest are typed */}
      <Row sub label={L`Кроме героев`}
        hint={L`Все собранные герои, начиная с тех, что ты собирал последними, сколько выдержит игра. Исключи тех, кто не нужен.`}>
        <HeroPicker built={m.built} chosen={m.excluded} names={names} onPick={onHero} />
      </Row>
      {m.excluded.length > 0 && (
        <div className="settings-heroes" role="group" aria-label={L`Кроме героев`}>
          {m.excluded.map((id) => (
            <button key={id} className="fchip" data-hero={id} aria-label={L`Вернуть ${names.get(id) ?? id}`} onClick={() => onHero(id)}>
              {names.get(id) ?? id}<span className="ms">close</span>
            </button>
          ))}
        </div>
      )}
      {leftNames.length > 0 && (
        <div className="settings-hint warn set-warn" role="status">
          {L`Не поместились, иначе игра начала бы показывать чужие модели: ${left}. Исключи тех, кто не нужен, чтобы освободить место.`}
        </div>
      )}
    </>
  );
}
