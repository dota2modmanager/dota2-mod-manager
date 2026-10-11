/* A pack's members, each one dropped or kept for this install, and the row that saves what is left
 * as a pack of the user's own. */
import { useRef } from 'react';
import type { ModModalActions, ModModalModel } from './model.ts';
import { catalogName } from '../../ui/catalog-name.ts';
import { Thumb } from './Thumb.tsx';

export function PackList({ m, actions }: { m: ModModalModel; actions: ModModalActions }) {
  const name = useRef<HTMLInputElement>(null);
  if (!m.pack) return null;
  return (
    <>
      <div className="pack-list">
        {m.pack.members.map((x) => (
          <div key={x.name} className={`pack-row ${x.excluded ? 'excluded' : ''} ${x.catName ? '' : 'missing'}`} data-member={x.name}>
            <Thumb url={x.thumb} />
            <div className="pack-info">
              <div className="pack-mod-name" title={x.name}>{catalogName(x.name)}</div>
              <div className="pack-mod-cat">{x.catName ?? L`не найден в каталоге`}{x.installed ? L` · установлен` : ''}</div>
            </div>
            <button className="pack-x" data-toggle={x.name} aria-label={x.excluded ? L`Вернуть` : L`Убрать`}
              onClick={() => actions.togglePackMember(x.name)}>
              <span className="ms">{x.excluded ? 'add' : 'close'}</span>
            </button>
          </div>
        ))}
      </div>
      <div className="pack-save-row">
        <input className="input" id="packSaveName" ref={name} placeholder={L`Название своего пака…`}
          defaultValue={m.pack.custom ? m.mod.name : ''} />
        <button className="btn btn-sm" id="packSaveBtn" onClick={() => actions.savePack(name.current?.value.trim() || '')}>
          <span className="ms">bookmark_add</span>{L`Сохранить пак`}
        </button>
        {m.pack.custom && <button className="btn btn-sm btn-danger" id="packDeleteBtn" onClick={actions.deletePack}>{L`Удалить пак`}</button>}
      </div>
    </>
  );
}
