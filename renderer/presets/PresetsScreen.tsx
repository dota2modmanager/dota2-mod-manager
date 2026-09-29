/* Presets: a named set of "these mods on, everything else off", and the file or link that carries
 * it to somebody else. Drawn by root.tsx from what views/presets.ts works out. */
import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { AnimatePresence, MotionConfig } from 'motion/react';
import { pane } from '../core/router.ts';
import { bindContextMenu } from '../ui/menu.ts';
import type { PresetsActions, PresetsModel } from './model.ts';
import { OwnPresetCard, SharedPresetCard } from './PresetCard.tsx';

function PresetsScreen({ m, actions }: { m: PresetsModel; actions: PresetsActions }) {
  const name = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // the rest of what a preset can do is one right-click away, as everywhere else
  const menu = useRef(actions.menu);
  menu.current = actions.menu;
  useEffect(() => {
    if (list.current) {
      bindContextMenu(list.current, '.preset-card:not(.shared)',
        (card: HTMLElement) => menu.current((card.querySelector('[data-apply]') as HTMLElement | null)?.dataset.apply || ''));
    }
  }, []);
  const save = async () => {
    if (name.current && await actions.save(name.current.value.trim())) name.current.value = '';
  };
  return (
    <>
      <div className="view-header"><h1 className="view-title">{L`Пресеты`}</h1></div>
      <div className="view-intro">{L`Пресет хранит моды. Виды для стандартных предметов в него не входят: они живут своей жизнью в «Моих модах» и не выключаются вместе с пресетом.`}</div>
      <div className="preset-new">
        <input className="input" id="presetName" ref={name} placeholder={L`Название пресета (напр. «Анимешный», «Минимал»)`} />
        <button className="btn btn-primary" id="savePresetBtn" onClick={save}><span className="ms">save</span>{L`Сохранить текущее состояние`}</button>
        <button className="btn" id="importPresetBtn" onClick={actions.importFile}><span className="ms">upload_file</span>{L`Открыть .d2mm`}</button>
      </div>
      <div id="presetList" ref={list}>
        <AnimatePresence initial={false}>
          {m.presets.map((p, i) => (p.kind === 'shared'
            ? <SharedPresetCard key={p.id} p={p} index={i} actions={actions} />
            : <OwnPresetCard key={p.id} p={p} index={i} actions={actions} />))}
        </AnimatePresence>
        {!m.presets.length && (
          <div className="empty-state">
            <span className="ms">bookmarks</span>
            <div className="empty-title">{L`Пресетов пока нет`}</div>
            <div className="empty-body">{L`Пресет запоминает, какие моды включены: применил — эти включились, остальные выключились. Готовым можно поделиться ссылкой или файлом, а полученный .d2mm достаточно перетащить сюда.`}</div>
          </div>
        )}
      </div>
    </>
  );
}

const root = createRoot(pane('presets'));

/** Drawn synchronously, inside the caller's paint(); a new key draws it fresh, entrances and all. */
export function showPresets(model: PresetsModel, actions: PresetsActions): void {
  flushSync(() => root.render(<MotionConfig reducedMotion="user"><PresetsScreen key={model.key} m={model} actions={actions} /></MotionConfig>));
}
