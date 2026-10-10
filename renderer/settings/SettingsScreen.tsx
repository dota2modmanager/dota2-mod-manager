/* Settings: everything the app itself remembers, drawn from what views/settings.ts reads. The
 * page is mostly other modules' knobs (the scale is ui/chrome.ts's, the language ui/language.ts's),
 * because a setting is a thing the whole window obeys, not a thing this screen owns. */
import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MotionConfig } from 'motion/react';
import { pane } from '../core/router.ts';
import { Reveal } from '../motion/Reveal.tsx';
import { Swap } from '../motion/Swap.tsx';

export interface SettingsModel {
  key: number;
  uiLang: string;
  scalePct: number;
  presence: boolean;
  beta: { eligible: boolean; on: boolean };
  dotaPath: string;
  dotaValid: boolean;
  cache: string;
  /** the Source 2 toolchain: a size and a button, never downloaded on its own */
  vrf: { ready: boolean; size: string } | null;
  catalogUpdated: string;
  adult: boolean;
  adultHint: string;
  version: string;
}

export interface SettingsActions {
  language: (lang: string) => void;
  scale: (pct: number, live: boolean) => void;
  scaleStep: (delta: number | null) => void;
  presence: () => void;
  beta: () => void;
  detect: () => void;
  browse: () => void;
  clearCache: () => void;
  tool: (install: boolean) => Promise<void>;
  refreshCatalog: () => void;
  adult: () => void;
  exportReport: () => void;
  whatsNew: () => void;
  open: (url: string) => void;
}

const Block = ({ i, title, children }: { i?: number; title: ReactNode; children: ReactNode }) => (
  <div className="settings-block" style={i === undefined ? undefined : ({ '--i': i } as CSSProperties)}>
    <h3>{title}</h3>
    {children}
  </div>
);

function Toggle({ id, on, label, onClick }: { id: string; on: boolean; label: string; onClick: () => void }) {
  return <button className={`toggle ${on ? 'on' : ''}`} id={id} role="switch" aria-checked={on} aria-label={label} onClick={onClick} />;
}

/* The number moves while the slider is dragged and the window resizes on release: scaling on every
 * input event fights the drag, since the slider moves under the pointer. ui/chrome.ts paints the
 * slider and its number, so React leaves both to it. */
function Scale({ pct, actions }: { pct: number; actions: SettingsActions }) {
  const range = useRef<HTMLInputElement>(null);
  const val = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (range.current) range.current.value = String(pct);
    if (val.current) val.current.textContent = `${pct}%`;
  }, [pct]);
  // the native pair: React's onChange on a range fires on every step, and this waits for release
  useEffect(() => {
    const el = range.current;
    if (!el) return;
    const live = () => actions.scale(Number(el.value), true);
    const done = () => actions.scale(Number(el.value), false);
    el.addEventListener('input', live);
    el.addEventListener('change', done);
    return () => { el.removeEventListener('input', live); el.removeEventListener('change', done); };
  }, [actions]);
  return (
    <div className="scale-ctl">
      <button className="btn btn-sm scale-step" id="masterDown" aria-label={L`Мельче`} onClick={() => actions.scaleStep(-5)}><span className="ms">remove</span></button>
      <input type="range" className="scale-range" id="masterRange" min="70" max="160" step="5" ref={range} aria-label={L`Масштаб`} />
      <span className="scale-val" id="masterRangeVal" ref={val} />
      <button className="btn btn-sm scale-step" id="masterUp" aria-label={L`Крупнее`} onClick={() => actions.scaleStep(5)}><span className="ms">add</span></button>
      <button className="btn btn-sm" id="masterReset" onClick={() => actions.scaleStep(null)}>{L`Сбросить`}</button>
    </div>
  );
}

function SettingsScreen({ m, actions }: { m: SettingsModel; actions: SettingsActions }) {
  const busy = useRef(false);
  return (
    <>
      <div className="view-header"><h1 className="view-title">{L`Настройки`}</h1></div>

      <Block title={L`Интерфейс`}>
        <div className="settings-row">
          <span className="settings-label">{L`Язык`}</span>
          <div className="select-wrap">
            <span className="ms" aria-hidden="true">translate</span>
            <select className="input" id="uiLangSelect" aria-label={L`Язык`} value={m.uiLang} onChange={(e) => actions.language(e.target.value)}>
              <option value="en">English</option>
              <option value="ru">Русский</option>
            </select>
          </div>
        </div>
        <div className="settings-row spaced">
          <span className="settings-label">{L`Масштаб`}</span>
          <Scale pct={m.scalePct} actions={actions} />
        </div>
      </Block>

      <Block i={1} title="Discord">
        <div className="settings-row">
          <span className="settings-label">{L`Показывать в Discord, что ты в Mod Manager`}</span>
          <Toggle id="presenceToggle" on={m.presence} label={L`Показывать в Discord, что ты в Mod Manager`} onClick={actions.presence} />
        </div>
        <div className="settings-hint">{L`В самом Discord для этого включено «Отображать текущую активность как статус».`}</div>
        {/* offered only to an account the signed list names: a switch you cannot use is noise */}
        <Reveal show={m.beta.eligible}>
          <div className="settings-row spaced">
            <span className="settings-label">{L`Бета-версии`}</span>
            <Toggle id="betaToggle" on={m.beta.on} label={L`Бета-версии`} onClick={actions.beta} />
          </div>
          <div className="settings-hint">{L`Твой аккаунт в списке тестеров: приложение будет обновляться до сборок, которых ещё нет у остальных. Выйдешь из Discord, и оно вернётся на обычные.`}</div>
        </Reveal>
      </Block>

      <Block i={2} title={L`Путь к Dota 2`}>
        <div className="settings-row">
          <Swap className="mono grow" value={m.dotaPath || L`не найден`} />
          <span className={`dot ${m.dotaValid ? 'ok' : 'bad'}`} />
        </div>
        <div className="settings-row">
          <button className="btn btn-sm" id="detectBtn" onClick={actions.detect}>{L`Найти автоматически`}</button>
          <button className="btn btn-sm" id="browseBtn" onClick={actions.browse}>{L`Указать вручную`}</button>
        </div>
      </Block>

      <Block i={3} title={L`Кэш загрузок`}>
        <div className="settings-row">
          <span className="settings-label">{L`Размер`}</span>
          <Swap className="num" value={m.cache} />
          <button className="btn btn-sm" id="clearCacheBtn" onClick={actions.clearCache}>{L`Очистить`}</button>
        </div>
        <div className="settings-hint">{L`Скачанные архивы, чтобы не качать повторно. Удаление ничего не сломает.`}</div>
      </Block>

      {m.vrf && (
        <Block i={4} title={L`Картинки из игры и модов`}>
          <div className="settings-row">
            <Swap className="settings-label" value={m.vrf.ready}>{m.vrf.ready ? L`Инструмент установлен` : L`Инструмент не скачан`}</Swap>
            <Swap className="num" value={m.vrf.size} />
            {m.vrf.ready
              ? <button className="btn btn-sm" id="toolRemoveBtn" onClick={() => actions.tool(false)}>{L`Удалить`}</button>
              // 48 MB is a real download, so it says so and waits for the press
              : <button className="btn btn-sm btn-primary" id="toolInstallBtn" onClick={(e) => {
                if (busy.current) return;
                busy.current = true;
                e.currentTarget.disabled = true;
                actions.tool(true).finally(() => { busy.current = false; });
              }}><span className="ms">download</span>{L`Скачать`}</button>}
          </div>
          <div className="settings-hint">{L`Картинки предметов приложение берёт из самой игры: точные, без интернета и без ожидания. А моду, который приехал без превью, находит картинку в его же файлах. Без инструмента предметы грузятся из вики (медленнее и есть не для всего), а моды остаются с заглушкой. Удалить можно в любой момент.`}</div>
        </Block>
      )}

      <Block i={4} title={L`Каталог`}>
        <div className="settings-row">
          <span className="settings-label">{L`Обновлён`}</span>
          <Swap value={m.catalogUpdated} />
          <button className="btn btn-sm" id="refreshCatBtn2" onClick={actions.refreshCatalog}>{L`Обновить сейчас`}</button>
        </div>
        <div className="settings-row">
          <span className="settings-label">{L`Источник`}</span>
          <a className="settings-link" id="srcLink" onClick={() => actions.open('https://github.com/h6rd/Dota2PornFxWeb')}>github.com/h6rd/Dota2PornFxWeb</a>
        </div>
        <div className="settings-row spaced">
          <span className="settings-label">{L`Моды 18+`}</span>
          <Toggle id="adultToggle" on={m.adult} label={L`Моды 18+`} onClick={actions.adult} />
        </div>
        <div className="settings-hint">{m.adultHint}</div>
      </Block>

      <Block i={5} title={L`Диагностика`}>
        <div className="settings-row spaced">
          <button className="btn btn-sm" id="diagExportBtn" onClick={actions.exportReport}><span className="ms">bug_report</span>{L`Экспортировать отчёт`}</button>
        </div>
        <div className="settings-hint">{L`Путь к игре, список модов и последние записи журнала в одном файле. Пришли его, если что-то не работает.`}</div>
      </Block>

      <Block i={6} title={L`О программе`}>
        <div className="settings-row">
          <span className="settings-label">{L`Версия`}</span>
          <span className="num">{`v${m.version}`}</span>
          <a className="settings-link" id="repoLink" onClick={() => actions.open('https://github.com/dota2modmanager/dota2-mod-manager')}>github.com/dota2modmanager/dota2-mod-manager</a>
        </div>
        <div className="settings-row">
          <button className="btn btn-sm" id="whatsNewBtn" onClick={actions.whatsNew}><span className="ms">auto_awesome</span>{L`Что нового`}</button>
        </div>
        {/* The people the app owes something to and cannot pay. The catalog is credited in its own
            block above; this row is for whoever else did the work. */}
        <div className="settings-row spaced">
          <span className="settings-label">{L`Спасибо`}</span>
          <span>{L`hanta снял видео о менеджере`}</span>
          <a className="settings-link" id="thanksLink" onClick={() => actions.open('https://www.youtube.com/@hqnta')}>youtube.com/@hqnta</a>
        </div>
        {/* Credit NOTICE requires for the item builder (section 7(b)): both names, here. */}
        <div className="settings-row spaced">
          <span className="settings-label">{L`Конструктор предметов`}</span>
          <span>h6rd, TheFleece</span>
          <a className="settings-link" id="builderLink" onClick={() => actions.open('https://github.com/h6rd')}>github.com/h6rd</a>
        </div>
        <div className="settings-hint">
          {`© 2026 TheFleece · ${L`конструктор предметов`} © 2026 h6rd, TheFleece · GPL-3.0 · ${L`свободная программа без каких-либо гарантий`}`}
        </div>
      </Block>
    </>
  );
}

const root = createRoot(pane('settings'));

/** Drawn synchronously, inside the caller's paint(); a new key draws it fresh, entrances and all. */
export function showSettings(model: SettingsModel, actions: SettingsActions): void {
  flushSync(() => root.render(<MotionConfig reducedMotion="user"><SettingsScreen key={model.key} m={model} actions={actions} /></MotionConfig>));
}
