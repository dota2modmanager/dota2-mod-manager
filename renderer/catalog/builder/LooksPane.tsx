/* The looks saved for a hero (views/item-looks.ts), a tab of its window: what it wore, under a name,
 * put on again in one click while everything else the hero wears comes off. A look's card shows its
 * first four items, the way a set's picture shows what it is made of. */
import { plural } from '../../ui/format.ts';
import { cosmeticName } from '../../ui/cosmetic-name.ts';
import type { HeroModalActions, HeroPane } from './model.ts';
import { CosThumb } from './parts.tsx';

type Looks = Extract<HeroPane, { kind: 'looks' }>['looks'];

export function LooksPane({ looks, canSave, busy, actions }: { looks: Looks; canSave: boolean; busy: boolean; actions: HeroModalActions }) {
  return (
    <div className="ward-slot">
      <div className="ward-pane-head">
        <h3 className="ward-pane-title">{L`Мои образы`}</h3>
        <button className="btn btn-sm" id="lookSave" disabled={!canSave || busy} onClick={actions.saveLook}
          title={canSave ? L`Запомнить то, что надето сейчас` : L`Сначала надень что-нибудь`}>
          <span className="ms">bookmark_add</span>{L`Сохранить надетое`}
        </button>
      </div>
      <div className="ward-scroll">
        {looks.length ? (
          <div className="item-pick-grid ward-grid look-grid">
            {looks.map((l) => (
              <div key={l.id} className={`card look-card ${l.on ? 'installed' : ''}`} data-look={l.id}>
                <div className="look-mosaic" data-count={Math.min(l.pictures.length, 4)}>
                  {l.pictures.slice(0, 4).map((p) => <CosThumb key={p} name={p} fallback="checkroom" />)}
                </div>
                <div className="card-body">
                  <div className="card-name" title={l.name}>{cosmeticName(l.name)}</div>
                  <div className="card-meta"><span>{`${l.pictures.length} ${plural(l.pictures.length, 'предмет', 'предмета', 'предметов')}`}</span></div>
                  <div className="look-actions">
                    {l.on
                      ? <span className="ward-on"><span className="ms">check</span>{L`Надет`}</span>
                      : <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => actions.wearLook(l.id)}>{L`Надеть`}</button>}
                    <button className="btn btn-sm btn-ghost btn-icon" title={L`Переименовать`} aria-label={L`Переименовать`} onClick={() => actions.renameLook(l.id)}>
                      <span className="ms">edit</span>
                    </button>
                    <button className="btn btn-sm btn-ghost btn-icon" title={L`Удалить образ`} aria-label={L`Удалить образ`} onClick={() => actions.deleteLook(l.id)}>
                      <span className="ms">delete</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : <div className="ward-empty"><span className="ms">bookmarks</span>{L`Собери героя и сохрани: потом образ надевается одним нажатием, а остальное снимается.`}</div>}
      </div>
    </div>
  );
}
