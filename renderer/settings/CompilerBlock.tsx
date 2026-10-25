/* resourcecompiler.exe in Settings: which one runs, picking another, and on Linux the Wine it runs
 * under. The program's path is picked in a dialog of the main process (src/ipc-compiler.ts); this
 * only shows what main says and asks it. */
import type { CSSProperties } from 'react';
import { Swap } from '../motion/Swap.tsx';
import type { CompilerState } from '../api/content.ts';

export interface CompilerActions {
  compilerBrowse: () => void;
  compilerForget: () => void;
  compilerPrepare: () => Promise<void>;
}

export function CompilerBlock({ i, c, actions }: { i: number; c: CompilerState; actions: CompilerActions }) {
  return (
    <div className="settings-block" style={{ '--i': i } as CSSProperties}>
      <h3>{L`Компилятор ресурсов`}</h3>
      <div className="settings-row">
        <Swap className="mono grow" value={c.exe || L`не найден`} />
        <span className={`dot ${c.exe ? 'ok' : 'bad'}`} />
      </div>
      <div className="settings-row">
        <button className="btn btn-sm" id="compilerBrowseBtn" onClick={actions.compilerBrowse}>{L`Указать вручную`}</button>
        {c.chosen && <button className="btn btn-sm" id="compilerForgetBtn" onClick={actions.compilerForget}>{L`Сбросить`}</button>}
      </div>
      {c.needsWine && (
        <div className="settings-row spaced">
          <span className="settings-label">Wine</span>
          <Swap className="mono grow" value={c.wine || L`не найден`} />
          {c.prefixReady
            ? <span className="dot ok" />
            : <button className="btn btn-sm" id="compilerPrepareBtn" disabled={!c.wine || !c.exe} onClick={(e) => {
              e.currentTarget.disabled = true;
              void actions.compilerPrepare();
            }}>{L`Подготовить Wine`}</button>}
        </div>
      )}
      <div className="settings-hint">{L`Компилятор из Dota 2 Workshop Tools собирает модели и эффекты аркан, для которых ещё нет готовой основы. Workshop Tools ставятся в Steam как бесплатное дополнение к Windows-версии игры.`}</div>
      {c.needsWine && <div className="settings-hint">{L`На Linux у игры нет этого компилятора: укажи resourcecompiler.exe из Windows-копии игры (game/bin/win64). Он запускается через Wine в отдельном префиксе приложения, твой ~/.wine не трогается.`}</div>}
    </div>
  );
}
