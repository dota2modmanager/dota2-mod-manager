/* The author's window (issue #236, step 1): drafts of mods for the catalog, kept on this computer,
 * and an archive of one in the catalog's shape to send to its maintainer. No upload yet: the
 * catalog is not ours to write to. The mod window's markup and classes (.modal-body, .map-side,
 * .style-btn), so it reads as one of them. */
import { Dropdown } from '../ui/Dropdown.tsx';
import type { CreatorDraft, CreatorFields } from '../api/creator.ts';

/** What the window draws: the drafts, the one open, and the choices its form offers. */
export interface CreatorModel {
  drafts: CreatorDraft[];
  /** the draft open in the form, or null for the list */
  open: string | null;
  categories: { value: string; label: string }[];
  /** categories whose mods belong to one hero */
  heroCats: string[];
  busy: boolean;
}

/** What the window's buttons and fields ask views/creator.ts to do. */
export interface CreatorActions {
  close: () => void;
  create: () => void;
  open: (id: string | null) => void;
  change: (id: string, fields: CreatorFields) => void;
  attach: (id: string, style: number, kind: 'vpk' | 'picture') => void;
  remove: (id: string) => void;
  export: (id: string) => void;
}

const when = (ms: number) => new Date(ms).toLocaleDateString(window.I18N_LANG === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'short' });

/** The author's window: the drafts, or the form of the one open. */
export function CreatorModal({ m, actions }: { m: CreatorModel; actions: CreatorActions }) {
  const d = m.drafts.find((x) => x.id === m.open) || null;
  return (
    <div className="modal-body creator">
      <div className="modal-title-row">
        {d && <button className="btn btn-ghost btn-sm" id="creatorBackBtn" onClick={() => actions.open(null)}><span className="ms">arrow_back</span>{L`Черновики`}</button>}
        <div className="modal-title">{d ? (d.name || L`Новый мод`) : L`Кабинет автора`}</div>
        <button className="modal-close" id="modalCloseBtn" aria-label={L`Закрыть`} onClick={actions.close}><span className="ms">close</span></button>
      </div>
      <div className="modal-sub"><span>{L`Мод для каталога: черновик хранится на этом компьютере, готовый сохраняется архивом для ведущего каталога`}</span></div>
      {d ? <DraftForm key={d.id} d={d} m={m} actions={actions} /> : <DraftList m={m} actions={actions} />}
    </div>
  );
}

function DraftList({ m, actions }: { m: CreatorModel; actions: CreatorActions }) {
  return (
    <>
      <div className="creator-list">
        {m.drafts.map((d) => (
          <button key={d.id} className="creator-row" onClick={() => actions.open(d.id)}>
            {d.pictures[0] ? <img src={d.pictures[0]} alt="" /> : <span className="creator-row-pic"><span className="ms">image</span></span>}
            <span className="creator-row-name">{d.name || L`Без названия`}</span>
            <span className="text-meta">{d.missing.length ? L`не хватает: ${d.missing.length}` : L`готов`} · {when(d.updatedAt)}</span>
          </button>
        ))}
        {!m.drafts.length && <div className="share-hint">{L`Черновиков пока нет`}</div>}
      </div>
      <div className="modal-actions">
        <button className="btn btn-primary" id="creatorNewBtn" disabled={m.busy} onClick={actions.create}><span className="ms">add</span>{L`Новый мод`}</button>
      </div>
    </>
  );
}

function DraftForm({ d, m, actions }: { d: CreatorDraft; m: CreatorModel; actions: CreatorActions }) {
  const set = (fields: CreatorFields) => actions.change(d.id, fields);
  const styles = d.styles.map((s) => ({ label: s.label }));
  const many = d.styles.length > 1;
  return (
    <>
      <div className="creator-grid">
        <div className="creator-fields">
          <label className="creator-field"><span>{L`Название`}</span>
            <input className="input" id="creatorName" defaultValue={d.name} maxLength={39} placeholder={L`Латиницей, с именем героя для мода героя`} onBlur={(e) => set({ name: e.currentTarget.value })} />
          </label>
          <Dropdown id="creatorCategory" icon="category" label={L`Категория`} value={d.category} first={L`Выбери категорию`}
            options={m.categories} onPick={(category) => set({ category })} />
          {m.heroCats.includes(d.category) && (
            <label className="creator-field"><span>{L`Герой`}</span>
              <input className="input" id="creatorHero" defaultValue={d.hero} maxLength={60} onBlur={(e) => set({ hero: e.currentTarget.value })} />
            </label>
          )}
          <label className="creator-field"><span>{L`Автор`}</span>
            <input className="input" id="creatorAuthor" defaultValue={d.author} maxLength={80} placeholder={L`Ник в Discord или ссылка`} onBlur={(e) => set({ author: e.currentTarget.value })} />
          </label>
          <label className="creator-field"><span>{L`Описание`}</span>
            <textarea className="input" id="creatorDescription" defaultValue={d.description} rows={3} maxLength={2000} onBlur={(e) => set({ description: e.currentTarget.value })} />
          </label>
        </div>
        {/* the card as the catalog will draw it: its picture, its name, who made it */}
        <div className="creator-card" aria-label={L`Как в каталоге`}>
          {d.pictures[0] ? <img src={d.pictures[0]} alt="" /> : <div className="creator-card-pic"><span className="ms">image</span></div>}
          <div className="creator-card-name">{d.name || L`Название мода`}</div>
          <div className="text-meta">{d.author || L`автор`}{many ? ` · ${L`стилей: ${d.styles.length}`}` : ''}</div>
        </div>
      </div>

      <div className="map-side">
        <div className="map-side-label">{many ? L`Стили` : L`Файлы`}</div>
        {d.styles.map((s, i) => (
          <div className="creator-style" key={i}>
            {many && <input className="input" defaultValue={s.label} placeholder={L`Название стиля`} maxLength={12}
              onBlur={(e) => set({ styles: styles.map((x, j) => (j === i ? { label: e.currentTarget.value } : x)) })} />}
            <button className={`btn btn-sm${s.vpk ? '' : ' btn-primary'}`} disabled={m.busy} onClick={() => actions.attach(d.id, i, 'vpk')}>
              <span className="ms">{s.vpk ? 'check' : 'upload_file'}</span>VPK</button>
            <button className={`btn btn-sm${s.picture ? '' : ' btn-primary'}`} disabled={m.busy} onClick={() => actions.attach(d.id, i, 'picture')}>
              <span className="ms">{s.picture ? 'check' : 'image'}</span>{L`Картинка`}</button>
            {/* the slot is kept empty too, so the rows line up */}
            {d.pictures[i] ? <img className="creator-style-pic" src={d.pictures[i]!} alt="" /> : <span className="creator-style-pic" />}
            {many && <button className="btn btn-ghost btn-xs" aria-label={L`Убрать стиль`} onClick={() => set({ styles: styles.filter((_, j) => j !== i) })}><span className="ms">delete</span></button>}
          </div>
        ))}
        {d.styles.length < 3 && (
          <button className="btn btn-ghost btn-sm" id="creatorAddStyle" onClick={() => set({ styles: [...styles, { label: '' }] })}><span className="ms">add</span>{L`Ещё стиль`}</button>
        )}
      </div>

      {d.missing.length > 0 && <div className="preset-warn"><span className="ms">info</span>{L`Не хватает: ${d.missing.join(', ')}`}</div>}
      {d.problems.length > 0 && <div className="preset-warn"><span className="ms">rule</span>{L`Для каталога нужно: ${d.problems.join(', ')}`}</div>}
      <div className="modal-actions">
        <button className="btn btn-danger" id="creatorDeleteBtn" disabled={m.busy} onClick={() => actions.remove(d.id)}>{L`Удалить черновик`}</button>
        <button className="btn btn-primary" id="creatorExportBtn" disabled={m.busy || d.missing.length > 0 || d.problems.length > 0} onClick={() => actions.export(d.id)}>
          <span className="ms">archive</span>{L`Сохранить архив для каталога`}</button>
      </div>
      <div className="modal-note">{L`Архив собран так же, как его собирает PreMod: VPK в своём zip, превью WebP 854×480, mod.json и hash.json. Ведущему каталога ничего не придётся перепаковывать.`}</div>
    </>
  );
}
