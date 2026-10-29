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
import { Dropdown } from '../ui/Dropdown.tsx';
import { ProxyControl } from './ProxyControl.ts';
import { CompilerBlock, type CompilerActions } from './CompilerBlock.tsx';
import type { CompilerState } from '../api/content.ts';

export interface SettingsModel {
  key: number;
  uiLang: string;
  scalePct: number;
  presence: boolean;
  /** installs of catalog mods are counted by the catalog's download counter */
  countDownloads: boolean;
  beta: { eligible: boolean; on: boolean };
  dotaPath: string;
  dotaValid: boolean;
  cache: string;
  proxy: string;
  /** the Source 2 toolchain: a size and a button, never downloaded on its own */
  vrf: { ready: boolean; size: string } | null;
  /** resourcecompiler.exe, and the Wine it runs under on Linux */
  compiler: CompilerState | null;
  catalogUpdated: string;
  adult: boolean;
  adultHint: string;
  version: string;
}

export interface SettingsActions extends CompilerActions {
  language: (lang: string) => void;
  scale: (pct: number, live: boolean) => void;
  scaleStep: (delta: number | null) => void;
  presence: () => void;
  countDownloads: () => void;
  beta: () => void;
  detect: () => void;
  browse: () => void;
  clearCache: () => void;
  proxySave: (value: string) => Promise<void>;
  proxyTest: (value: string) => Promise<void>;
  proxyClear: () => Promise<void>;
  tool: (install: boolean) => Promise<void>;
  refreshCatalog: () => void;
  adult: () => void;
  exportReport: () => void;
  whatsNew: () => void;
  /** the window asking for support (ui/support.ts) */
  support: () => void;
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
          <Dropdown
            id="uiLangSelect"
            icon="translate"
            label={L`Язык`}
            value={m.uiLang}
            options={[
              { value: 'en', label: 'English' },
              { value: 'ru', label: 'Русский' },
              { value: 'zh-CN', label: '简体中文' },
            ]}
            onPick={(lang) => actions.language(lang)}
          />
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
        <div className="settings-row spaced">
          <span className="settings-label">{L`Прокси загрузок`}</span>
          <ProxyControl value={m.proxy} onSave={actions.proxySave} onTest={actions.proxyTest} onClear={actions.proxyClear} />
        </div>
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

      {m.compiler && <CompilerBlock i={4} c={m.compiler} actions={actions} />}

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
        <div className="settings-row spaced">
          <span className="settings-label">{L`Считать мои скачивания`}</span>
          <Toggle id="countDownloadsToggle" on={m.countDownloads} label={L`Считать мои скачивания`} onClick={actions.countDownloads} />
        </div>
        <div className="settings-hint">{L`Когда ставишь мод из каталога, приложение сообщает счётчику каталога его название, и больше ничего. Из этого счётчика и цифры скачиваний на карточках.`}</div>
      </Block>

      <Block i={5} title={L`Диагностика`}>
        <div className="settings-row spaced">
          <button className="btn btn-sm" id="diagExportBtn" onClick={actions.exportReport}><span className="ms">bug_report</span>{L`Экспортировать отчёт`}</button>
        </div>
        <div className="settings-hint">{L`Путь к игре, список модов и последние записи журнала в одном файле. Пришли его, если что-то не работает.`}</div>
      </Block>

      {/* Four kinds of thing, in the order somebody looks for them: what they can do for the
          project, which build this is, who made it, and the licence. The support strip is the one
          tinted thing on the page, because it is the only row here that asks something. */}
      <Block i={6} title={L`О программе`}>
        <div className="about-support">
          <span className="ms">favorite</span>
          <div className="about-support-text">
            <div className="about-support-title">{L`Поддержи проект`}</div>
            <div className="settings-hint">{L`Звезда на GitHub и пара слов о нас в интернете. Бесплатно и занимает минуту.`}</div>
          </div>
          <button className="btn btn-primary" id="supportBtn" onClick={actions.support}>{L`Как поддержать проект`}</button>
        </div>
        <div className="about-app">
          <span className="about-name">{L`Менеджер модов`}</span>
          <span className="about-ver num">{`v${m.version}`}</span>
          <span className="about-gap" />
          <button className="btn btn-sm" id="whatsNewBtn" onClick={actions.whatsNew}><span className="ms">auto_awesome</span>{L`Что нового`}</button>
          <button className="btn btn-sm" id="repoLink" onClick={() => actions.open('https://github.com/dota2modmanager/dota2-mod-manager')}><span className="ms">code</span>{L`Исходный код`}</button>
        </div>
        {/* The people the app owes something to. Credit NOTICE requires for the item builder
            (section 7(b)): both names, here. The catalog is credited in its own block above. */}
        <div className="about-sub">{L`Авторы и благодарности`}</div>
        <div className="about-credits">
          <span className="about-role">{L`Конструктор предметов`}</span>
          <span>h6rd, TheFleece</span>
          <a className="settings-link" id="builderLink" onClick={() => actions.open('https://github.com/h6rd')}>github.com/h6rd</a>
          <span className="about-role">{L`Арканы в конструкторе`}</span>
          <span>J0nathan550</span>
          <a className="settings-link" id="arcanaCreditLink" onClick={() => actions.open('https://github.com/J0nathan550')}>github.com/J0nathan550</a>
          <span className="about-role">{L`Видео о менеджере`}</span>
          <span>hanta</span>
          <a className="settings-link" id="thanksLink" onClick={() => actions.open('https://www.youtube.com/@hqnta')}>youtube.com/@hqnta</a>
        </div>
        <div className="about-legal">
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
