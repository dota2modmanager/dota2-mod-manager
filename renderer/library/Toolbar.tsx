/* What sits over and under the list: the search, the counts and the import buttons; the "select
 * all" lines of the mods and the cosmetics; and the bar that acts on whatever is ticked. */
import { useEffect, useRef } from 'react';
import { plural } from '../ui/format.ts';
import type { LibraryActions, LibraryModel } from './model.ts';

export function LibToolbar({ m, actions }: { m: LibraryModel; actions: LibraryActions }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="lib-toolbar">
      <div className="lib-search">
        <span className="ms">search</span>
        <input id="libSearch" ref={input} placeholder={L`Поиск среди своих модов…`} value={m.search} spellCheck={false} autoComplete="off"
          onChange={(e) => actions.search(e.target.value)} />
        <button className={`lib-search-clear ${m.search ? 'show' : ''}`} id="libSearchClear" aria-label={L`Очистить`}
          onClick={() => { actions.search(''); input.current?.focus(); }}>
          <span className="ms">close</span>
        </button>
      </div>
      <span className="lib-stats">{m.stats}</span>
      <div className="lib-toolbar-actions">
        <button className="btn btn-sm" id="importVpkBtn" onClick={actions.importFiles}><span className="ms">upload_file</span>{L`Импорт VPK`}</button>
        <button className="btn btn-sm" id="importFolderBtn" title={L`Импортировать все .vpk из папки — например из распакованного пака Dota 2 Skinchanger`}
          onClick={actions.importFolder}>
          <span className="ms">drive_folder_upload</span>{L`Импорт папки`}
        </button>
      </div>
    </div>
  );
}

/** A "select all" box, with the dash for "some of them" that only a script can set. */
function AllBox({ id, state, onChange }: { id: string; state: { checked: boolean; indeterminate: boolean }; onChange: (on: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = state.indeterminate; });
  return <input type="checkbox" className="lib-check" id={id} ref={ref} checked={state.checked} onChange={(e) => onChange(e.target.checked)} />;
}

export function ListHead({ m, actions }: { m: LibraryModel; actions: LibraryActions }) {
  return (
    <div className="lib-listhead">
      <label className="lib-selectall" title={L`Выбрать всё`}><AllBox id="selAll" state={m.selectAll} onChange={actions.selectAll} />{L`Выбрать всё`}</label>
      <span className="lib-listhead-hint">{L`Отметь моды галочками — объединить в пак или массово управлять`}</span>
      <button className="btn btn-ghost btn-xs" id="enableAllBtn" disabled={m.masterOff} onClick={() => actions.enableAll(true)}>{L`Включить все`}</button>
      <button className="btn btn-ghost btn-xs" id="disableAllBtn" disabled={m.masterOff} onClick={() => actions.enableAll(false)}>{L`Выключить все`}</button>
    </div>
  );
}

/* Cosmetic picks come after the mods, with a "select all" and a switch of their own: only one look
 * per slot can be live, so "enable all" over them would be a race the last one wins. */
export function CosmeticsHead({ m, actions }: { m: LibraryModel; actions: LibraryActions }) {
  const c = m.cosmetics;
  if (!c) return null;
  return (
    <div className="lib-section-head">
      <label className="lib-selectall" title={L`Выбрать всю косметику`}>
        <AllBox id="selAllCos" state={m.selectAllCosmetics} onChange={actions.selectAllCosmetics} /><span className="ms">auto_awesome</span>{L`Косметика`}
      </label>
      <span className="lib-section-cnt">{`${c.count} ${plural(c.count, 'вид', 'вида', 'видов')} · ${c.on} ${L`вкл`}`}</span>
      <button className="btn btn-ghost btn-xs" id="disableAllCos" disabled={m.masterOff || !c.on} title={L`Вернуть все слоты к тому, что даёт игра`}
        onClick={actions.disableCosmetics}>
        {L`Выключить все`}
      </button>
    </div>
  );
}

export function BulkBar({ m, actions }: { m: LibraryModel; actions: LibraryActions }) {
  const b = m.bulk;
  useEffect(() => {
    document.body.classList.toggle('has-selection', b.count > 0);
  }, [b.count]);
  useEffect(() => () => document.body.classList.remove('has-selection'), []);
  const hidden = (off: boolean) => (off ? ' hidden' : '');
  return (
    <>
      <div className="bulk-bar-gap" />
      <div className={`bulk-bar${b.count > 0 ? ' show' : ''}`} id="bulkBar">
        <span className="bulk-count"><b id="bulkCount">{b.count}</b>{` ${L`выбрано`}`}</span>
        <div className="bulk-actions">
          <button className="btn btn-sm" id="bulkEnable" disabled={m.masterOff} onClick={() => actions.bulk('enable')}>
            <span className="ms">radio_button_checked</span>{L`Включить`}
          </button>
          <button className="btn btn-sm" id="bulkDisable" disabled={m.masterOff} onClick={() => actions.bulk('disable')}>
            <span className="ms">radio_button_unchecked</span>{L`Выключить`}
          </button>
          <button className={`btn btn-sm btn-primary${hidden(b.combinable < 2)}`} id="bulkCombine" onClick={() => actions.bulk('combine')}>
            <span className="ms">merge</span>{L`Объединить в пак`}
          </button>
          <button className={`btn btn-sm${hidden(b.members === 0)}`} id="bulkExtract" onClick={() => actions.bulk('extract')}>
            <span className="ms">unarchive</span>{L`Вытащить из пака`}
          </button>
          <button className={`btn btn-sm${hidden(b.adoptable === 0)}`} id="bulkAdopt" onClick={() => actions.bulk('adopt')}>
            <span className="ms">library_add_check</span>{L`Привязать`}
          </button>
          <button className="btn btn-sm btn-danger" id="bulkRemove" onClick={() => actions.bulk('remove')}>
            <span className="ms">delete</span>{L`Удалить`}
          </button>
        </div>
        <button className="bulk-close" id="bulkClear" aria-label={L`Сбросить выбор`} title={L`Сбросить выбор`} onClick={actions.clearSelection}>
          <span className="ms">close</span>
        </button>
      </div>
    </>
  );
}
