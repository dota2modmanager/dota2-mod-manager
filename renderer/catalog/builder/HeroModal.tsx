/* A hero's window in the item builder, its changing room: a row per slot with what is on it, which
 * opens the slot's items and comes off with one click; the hero's sets; putting everything back as
 * the game has it; and the looks saved for the hero (views/item-looks.ts). */
import { plural } from '../../ui/format.ts';
import { heroName } from '../../ui/hero-name.ts';
import { cosmeticName } from '../../ui/cosmetic-name.ts';
import type { HeroModalActions, HeroModalModel } from './model.ts';
import { CosThumb } from './parts.tsx';
import { Preview3d } from '../preview3d/Preview3d.tsx';

export function HeroModal({ m, actions }: { m: HeroModalModel; actions: HeroModalActions }) {
  return (
    <div className="modal-body dress">
      <div className="modal-title-row">
        <div className="modal-title">{heroName(m.hero)}</div>
        {m.preview && (
          <button className={`btn btn-sm preview3d-toggle ${m.preview.open ? 'on' : ''}`} id="preview3dBtn" aria-pressed={m.preview.open}
            title={L`Посмотреть героя в 3D в том, что надето`} onClick={actions.togglePreview}>
            <span className="ms">view_in_ar</span>3D
          </button>
        )}
        {m.paint && (
          <button className="btn btn-sm hero-paint-btn" id="heroPaintBtn" title={L`Свой цвет для способностей, иконок и предметов`} onClick={actions.openPaint}>
            <span className="ms">format_paint</span>{L`Перекрасить`}
          </button>
        )}
        <button className="modal-close" id="modalCloseBtn" aria-label={L`Закрыть`} onClick={actions.close}><span className="ms">close</span></button>
      </div>
      <div className="modal-sub">
        <span>{m.hub}</span>
        <span>{m.changed ? `· ${L`Изменено ${m.changed} из ${m.slots.length}`}` : `· ${L`Всё стандартное`}`}</span>
      </div>
      {m.preview?.open && <Preview3d hero={m.preview.hero} slots={m.preview.slots} sig={m.preview.sig} />}
      <div className="dress-slots">
        {m.slots.map((s) => (
          <div key={s.slot} className={`dress-row ${s.liveName ? 'on' : ''}`}>
            <button className="dress-open" data-item-slot={s.slot} onClick={() => actions.openSlot(s.slot)}>
              {s.liveName
                ? <CosThumb name={s.liveName} fallback={s.icon} cls="dress-thumb" />
                : <span className="dress-thumb"><div className="noimg"><span className="ms">{s.icon}</span></div></span>}
              <span className="dress-text">
                <span className="dress-slot">{s.label}</span>
                <span className="dress-item">{s.liveName ? cosmeticName(s.liveName) : L`Стандартный`}</span>
              </span>
              <span className="dress-more">{s.liveName ? '' : `${s.options} ${plural(s.options, 'вариант', 'варианта', 'вариантов')}`}</span>
              <span className="ms dress-chev">chevron_right</span>
            </button>
            {s.liveName && (
              <button className="btn btn-sm btn-ghost dress-off" data-take-off={s.slot} disabled={m.busy}
                title={L`Снять и вернуть стандартный`} onClick={() => actions.takeOff(s.slot)}>
                <span className="ms">close</span>{L`Снять`}
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="dress-actions">
        {m.sets && (
          <button className={`btn ${m.sets.on ? 'on' : ''}`} data-item-sets="true" onClick={actions.openSets}>
            <span className="ms">inventory_2</span>{L`Наборы`}<span className="dress-count">{m.sets.count}</span>
          </button>
        )}
        <button className="btn btn-ghost" id="dressReset" disabled={!m.changed || m.busy} onClick={actions.resetAll}>
          <span className="ms">restart_alt</span>{L`Вернуть всё стандартное`}
        </button>
      </div>
      <section className="dress-looks" aria-label={L`Мои образы`}>
        <div className="dress-looks-head">
          <h3>{L`Мои образы`}</h3>
          <button className="btn btn-sm" id="lookSave" disabled={!m.changed || m.busy || m.looks.some((l) => l.on)} onClick={actions.saveLook}
            title={m.changed ? L`Запомнить то, что надето сейчас` : L`Сначала надень что-нибудь`}>
            <span className="ms">bookmark_add</span>{L`Сохранить надетое`}
          </button>
        </div>
        {m.looks.length ? (
          <div className="dress-look-list">
            {m.looks.map((l) => (
              <div key={l.id} className={`dress-look ${l.on ? 'on' : ''}`} data-look={l.id}>
                <CosThumb name={l.picture} fallback="checkroom" cls="dress-thumb" />
                <span className="dress-text">
                  <span className="dress-item">{l.name}</span>
                  <span className="dress-slot">{`${l.count} ${plural(l.count, 'предмет', 'предмета', 'предметов')}`}</span>
                </span>
                {l.on
                  ? <span className="dress-worn"><span className="ms">check</span>{L`Надет`}</span>
                  : <button className="btn btn-sm btn-primary" disabled={m.busy} onClick={() => actions.wearLook(l.id)}>{L`Надеть`}</button>}
                <button className="btn btn-sm btn-ghost btn-icon" title={L`Переименовать`} aria-label={L`Переименовать`} onClick={() => actions.renameLook(l.id)}>
                  <span className="ms">edit</span>
                </button>
                <button className="btn btn-sm btn-ghost btn-icon" title={L`Удалить образ`} aria-label={L`Удалить образ`} onClick={() => actions.deleteLook(l.id)}>
                  <span className="ms">delete</span>
                </button>
              </div>
            ))}
          </div>
        ) : <div className="dress-note">{L`Собери героя и сохрани: потом образ надевается одним нажатием, а остальное снимается.`}</div>}
      </section>
    </div>
  );
}
