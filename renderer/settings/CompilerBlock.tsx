/* resourcecompiler.exe in Settings: which one runs, picking another, and on Linux the Wine it runs
 * under. The program's path is picked in a dialog of the main process (src/ipc-compiler.ts); this
 * only shows what main says and asks it. */
import { useState, type CSSProperties } from 'react';
import { Swap } from '../motion/Swap.tsx';
import type { CompilerState } from '../api/content.ts';

export interface CompilerActions {
  compilerBrowse: () => void;
  compilerForget: () => void;
  compilerPrepare: () => Promise<void>;
  compilerCheck: () => Promise<void>;
  compilerKeep: () => Promise<void>;
  compilerRemoveKept: () => void;
}

/** How the last check went, in words. */
function checkText(check: CompilerState['check']): string {
  if (!check) return L`Не проверен`;
  const secs = check.seconds.toFixed(1);
  return check.ok ? L`Работает: пустая модель собрана за ${secs} с` : L`Не собирает: ${check.message || ''}`;
}

export function CompilerBlock({ i, c, actions }: { i: number; c: CompilerState; actions: CompilerActions }) {
  const [checking, setChecking] = useState(false);
  const [keeping, setKeeping] = useState(false);
  const keepNow = () => { setKeeping(true); void actions.compilerKeep().finally(() => setKeeping(false)); };
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
      {/* on Linux: the copy kept for when Steam takes the game's tools away with the Proton build */}
      {c.needsWine && c.keptOutdated && !c.kept && !c.keepable && (
        <div className="settings-hint">{L`Копию Workshop Tools нужно сделать заново: прежняя не взяла файлы Windows-версии самой Dota. Переключи Dota на Proton один раз, приложение скопирует всё само.`}</div>
      )}
      {c.needsWine && (c.kept || c.keepable) && (
        <div className="settings-row spaced">
          <span className="settings-label grow">{c.kept ? L`Копия Workshop Tools: ${Math.round(c.kept.bytes / 1048576)} MB` : L`Копии Workshop Tools нет`}</span>
          {c.keepable && <button className="btn btn-sm" id="compilerKeepBtn" disabled={keeping} onClick={keepNow}>{c.kept ? L`Обновить копию` : L`Сохранить копию`}</button>}
          {c.kept && <button className="btn btn-sm" id="compilerRemoveKeptBtn" disabled={keeping || checking} onClick={actions.compilerRemoveKept}>{L`Удалить копию`}</button>}
        </div>
      )}
      <div className="settings-row spaced">
        <Swap className="settings-label grow" value={checking ? 'busy' : checkText(c.check)}>{checking ? L`Проверяю…` : checkText(c.check)}</Swap>
        <span className={`dot ${c.check?.ok ? 'ok' : c.check ? 'bad' : ''}`} />
        <button className="btn btn-sm" id="compilerCheckBtn" disabled={!c.exe || checking} onClick={() => {
          setChecking(true);
          void actions.compilerCheck().finally(() => setChecking(false));
        }}>{L`Проверить`}</button>
      </div>
      <div className="settings-hint">{L`Проверка собирает пустую модель во временном аддоне и сразу его удаляет: игра не меняется.`}</div>
      <div className="settings-hint">{L`Компилятор из Dota 2 Workshop Tools собирает модели и эффекты аркан, для которых ещё нет готовой основы. Workshop Tools ставятся в Steam как бесплатное дополнение к Windows-версии игры.`}</div>
      {c.needsWine && <div className="settings-hint">{L`Steam удаляет Workshop Tools, когда Dota переключают обратно на Linux-версию, поэтому приложение хранит их копию вместе с Windows-файлами самой Dota и работает с ней. Остальная игра не копируется.`}</div>}
      {c.needsWine && <div className="settings-hint">{L`На Linux Workshop Tools ставятся, только когда Dota запущена через Proton (Свойства → Совместимость). Компилятор запускается через Wine в отдельном префиксе приложения, твой ~/.wine не трогается.`}</div>}
    </div>
  );
}
