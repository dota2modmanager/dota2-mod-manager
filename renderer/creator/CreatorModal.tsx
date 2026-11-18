/* The author's window (issue #236): drafts of mods for the catalog, kept on this computer, and a
 * finished one either saved as PreMod's archive or sent to the catalog's upload API. The terms are
 * shown once, as the site shows them, and are accepted through the app's API. The mod window's
 * markup and classes (.modal-body, .map-side, .style-btn), so it reads as one of them. */
import { Dropdown } from '../ui/Dropdown.tsx';
import { HistoryPanel } from './HistoryPanel.tsx';
import { Consent } from './Consent.tsx';
import { nameLimit } from './naming.ts';
import type { CreatorDraft, CreatorFields, CreatorConsent, CreatorHistoryItem } from '../api/creator.ts';

/** What the window draws: the drafts, the one open, and the choices its form offers. */
export interface CreatorModel {
  drafts: CreatorDraft[];
  /** the draft open in the form, or null for the list */
  open: string | null;
  categories: { value: string; label: string }[];
  /** categories whose mods belong to one hero */
  heroCats: string[];
  /** the catalog's heroes, when it has been loaded */
  heroes: string[];
  /** subcategories of the categories that have them, keyed by category */
  subcats: Record<string, { value: string; label: string }[]>;
  /** the catalog's tags, keyed by category */
  tags: Record<string, Record<string, string>>;
  /** the tag keys that are a slot in the categories where one slot must be picked */
  slotTags: Record<string, string[]>;
  /** categories that take a YouTube preview */
  videoCats: string[];
  /** the catalog's known authors and sources, for the credits pickers */
  authors: string[];
  sources: string[];
  consent: CreatorConsent;
  /** the build carries an upload token, so sending to the catalog can work */
  uploader: boolean;
  /** a long operation is running: attaching a file, exporting, uploading */
  busy: boolean;
  /** the upload history panel, and what its last fetch brought back */
  historyOpen: boolean;
  historyItems: CreatorHistoryItem[];
  historyLoading: boolean;
  historyError: string;
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
  upload: (id: string) => void;
  acceptTerms: () => void;
  showHistory: () => void;
  hideHistory: () => void;
  /** ask the catalog again what became of the submissions */
  history: () => void;
}

const when = (ms: number) => new Date(ms).toLocaleDateString(window.I18N_LANG === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'short' });
const HEX = ['#ddd4ff', '#ff8f8f', '#8fd3ff', '#ffffff'];

/** The author's window: the drafts, or the form of the one open. */
export function CreatorModal({ m, actions }: { m: CreatorModel; actions: CreatorActions }) {
  const d = m.drafts.find((x) => x.id === m.open) || null;
  return (
    <div className="modal-body creator">
      <div className="modal-title-row">
        {d && <button className="btn btn-ghost btn-sm" id="creatorBackBtn" onClick={() => actions.open(null)}><span className="ms">arrow_back</span>{L`Черновики`}</button>}
        <div className="modal-title">{d ? (d.name || L`Новый мод`) : L`Кабинет автора`}</div>
        <button className="btn btn-ghost btn-sm" id="creatorHistoryBtn" onClick={() => actions.showHistory()} disabled={m.busy}><span className="ms">history</span>{L`История`}</button>
        <button className="modal-close" id="modalCloseBtn" aria-label={L`Закрыть`} onClick={actions.close}><span className="ms">close</span></button>
      </div>
      <div className="modal-sub"><span>{L`Мод для каталога: черновик хранится на этом компьютере, готовый можно отправить на модерацию`}</span></div>
      {d ? <DraftForm key={d.id} d={d} m={m} actions={actions} /> : <DraftList m={m} actions={actions} />}
      {m.historyOpen && <HistoryPanel m={m} actions={actions} />}
      {!m.consent.accepted && <Consent busy={m.busy} onAccept={actions.acceptTerms} />}
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

/** A small set of exclusive choices, drawn as the site's segmented buttons. */
function Choices<T extends string>({ value, options, onPick }: {
  value: T; options: { value: T; label: string }[]; onPick: (v: T) => void;
}) {
  return (
    <div className="creator-choices">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value}
          className={`creator-choice${value === o.value ? ' on' : ''}`} onClick={() => onPick(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function DraftForm({ d, m, actions }: { d: CreatorDraft; m: CreatorModel; actions: CreatorActions }) {
  const set = (fields: CreatorFields) => actions.change(d.id, fields);
  const styles = d.styles.map((s) => ({ label: s.label, colors: s.colors }));
  const many = d.styles.length > 1;
  const tagMap = m.tags[d.category] || {};
  const slots = m.slotTags[d.category] || [];
  const subcats = m.subcats[d.category] || [];
  const setStyleColors = (i: number, colors: string[]) => set({ styles: styles.map((x, j) => (j === i ? { ...x, colors } : x)) });
  const toggleTag = (key: string) => {
    const next = { ...d.tags, [key]: !d.tags[key] };
    // a hero item has exactly one slot, so picking one puts the others down
    if (slots.includes(key) && next[key]) for (const other of slots) if (other !== key) next[other] = false;
    set({ tags: next });
  };
  return (
    <>
      <div className="creator-grid">
        <div className="creator-fields">
          <label className="creator-field"><span>{L`Название`}</span>
            <input className="input" id="creatorName" key={d.name} defaultValue={d.name} maxLength={nameLimit(d.hero)} placeholder={L`Латиницей, с именем героя для мода героя`} onBlur={(e) => set({ name: e.currentTarget.value })} />
            <span className="text-meta">{d.name.length}/{nameLimit(d.hero)}</span>
          </label>
          <Dropdown id="creatorCategory" icon="category" label={L`Категория`} value={d.category} first={L`Выбери категорию`}
            options={m.categories} onPick={(category) => set({ category, subcategory: '', tags: {}, ...(m.heroCats.includes(category) ? {} : { hero: '' }) })} />
          {subcats.length > 0 && (
            <Dropdown id="creatorSubcategory" icon="account_tree" label={L`Подкатегория`} value={d.subcategory} first={L`Выбери подкатегорию`}
              options={subcats} onPick={(subcategory) => set({ subcategory })} />
          )}
          {m.heroCats.includes(d.category) && (m.heroes.length ? (
            <Dropdown id="creatorHero" icon="person" label={L`Герой`} value={d.hero} first={L`Выбери героя`}
              options={m.heroes.map((hero) => ({ value: hero, label: hero }))} onPick={(hero) => set({ hero })} />
          ) : (
            <label className="creator-field"><span>{L`Герой`}</span>
              <input className="input" id="creatorHero" defaultValue={d.hero} maxLength={60} onBlur={(e) => set({ hero: e.currentTarget.value })} />
            </label>
          ))}
          <div className="creator-field"><span>{L`Автор`}</span>
            <Choices value={d.authorMode} onPick={(authorMode) => set({ authorMode, author: '', authorUrl: '' })}
              options={[{ value: 'existing', label: L`Существующий` }, { value: 'new', label: L`Новый` }, { value: 'skip', label: L`Нет` }]} />
            {d.authorMode === 'existing' && (
              <Dropdown id="creatorAuthorExisting" icon="person" value={d.author} first={L`Выбери автора`}
                options={m.authors.map((a) => ({ value: a, label: a }))} onPick={(author) => set({ author })} />
            )}
            {d.authorMode === 'new' && (
              <>
                <input className="input" id="creatorAuthor" defaultValue={d.author} maxLength={80} placeholder={L`Ник`} onBlur={(e) => set({ author: e.currentTarget.value })} />
                <input className="input" id="creatorAuthorUrl" defaultValue={d.authorUrl} maxLength={2048} placeholder={L`Ссылка на профиль (необязательно, https://)`} onBlur={(e) => set({ authorUrl: e.currentTarget.value })} />
                {d.author && m.authors.find((a) => norm(a) === norm(d.author)) && (
                  <span className="text-meta">{L`Такой автор уже есть в каталоге — выбери «Существующий»`}</span>
                )}
              </>
            )}
          </div>
          <div className="creator-field"><span>{L`Дополнительная ссылка`} <span className="text-meta">({L`необязательно`})</span></span>
            <Choices value={d.extraMode} onPick={(extraMode) => set({ extraMode, extraName: '', extraUrl: '' })}
              options={[{ value: 'none', label: L`Нет` }, { value: 'author', label: L`Соавтор` }, { value: 'source', label: L`Источник` }, { value: 'modded', label: L`Доработано` }]} />
            {d.extraMode !== 'none' && (
              <>
                <Choices value={d.extraOrigin} onPick={(extraOrigin) => set({ extraOrigin, extraName: '', extraUrl: '' })}
                  options={[{ value: 'existing', label: L`Существующий` }, { value: 'new', label: L`Новый` }]} />
                {d.extraOrigin === 'existing' && (
                  <Dropdown id="creatorExtraExisting" icon="link" value={d.extraName} first={d.extraMode === 'source' ? L`Выбери источник` : L`Выбери автора`}
                    options={(d.extraMode === 'source' ? m.sources : m.authors).filter((a) => norm(a) !== norm(d.author)).map((a) => ({ value: a, label: a }))}
                    onPick={(extraName) => set({ extraName })} />
                )}
                {d.extraOrigin === 'new' && (
                  <>
                    <input className="input" id="creatorExtraName" defaultValue={d.extraName} maxLength={80} placeholder={d.extraMode === 'source' ? L`Источник` : L`Ник`} onBlur={(e) => set({ extraName: e.currentTarget.value })} />
                    <input className="input" id="creatorExtraUrl" defaultValue={d.extraUrl} maxLength={2048} placeholder={L`Ссылка (необязательно, https://)`} onBlur={(e) => set({ extraUrl: e.currentTarget.value })} />
                    {d.extraName && (d.extraMode === 'source' ? m.sources : m.authors).find((a) => norm(a) === norm(d.extraName)) && (
                      <span className="text-meta">{d.extraMode === 'source' ? L`Такой источник уже есть в каталоге — выбери «Существующий»` : L`Такой автор уже есть в каталоге — выбери «Существующий»`}</span>
                    )}
                  </>
                )}
                {d.extraName && norm(d.extraName) === norm(d.author) && (
                  <span className="text-meta">{L`Автор не может быть указан дважды`}</span>
                )}
              </>
            )}
          </div>
          <label className="creator-field"><span>{L`Описание`}</span>
            <textarea className="input" id="creatorDescription" defaultValue={d.description} rows={3} maxLength={2000} onBlur={(e) => set({ description: e.currentTarget.value })} />
          </label>
          {Object.keys(tagMap).length > 0 && (
            <div className="creator-field"><span>{L`Теги`}</span>
              <div className="creator-tags">
                {Object.entries(tagMap).map(([key, label]) => (
                  <button key={key} type="button" className={`creator-tag${d.tags[key] ? ' on' : ''}`} onClick={() => toggleTag(key)}>
                    {label}
                  </button>
                ))}
              </div>
              {slots.length > 0 && <span className="text-meta">{L`Для модов героев выбери ровно один слот`}</span>}
            </div>
          )}
          {m.videoCats.includes(d.category) && (
            <label className="creator-field"><span>{L`Превью-видео`} <span className="text-meta">(YouTube)</span></span>
              <input className="input" id="creatorVideo" defaultValue={d.video} maxLength={300} placeholder="https://www.youtube.com/watch?v=…" onBlur={(e) => set({ video: e.currentTarget.value })} />
            </label>
          )}
        </div>
        {/* the card as the catalog will draw it: its picture, its name, who made it */}
        <div className="creator-card" aria-label={L`Как в каталоге`}>
          {d.pictures[0] ? <img src={d.pictures[0]} alt="" /> : <div className="creator-card-pic"><span className="ms">image</span></div>}
          <div className="creator-card-name">{d.name || L`Название мода`}</div>
          <div className="text-meta">{d.authorMode === 'skip' || !d.author ? L`Аноним` : d.author}{many ? ` · ${L`стилей: ${d.styles.length}`}` : ''}</div>
          {many && <div className="creator-card-styles">{d.styles.map((s, i) => (
            <span key={i} className="creator-swatch" title={s.label} style={{ background: s.colors.length > 1 ? `linear-gradient(135deg, ${s.colors[0]} 50%, ${s.colors[1]} 50%)` : s.colors[0] }} />
          ))}</div>}
        </div>
      </div>

      <div className="map-side">
        <div className="map-side-label">{many ? L`Стили` : L`Файлы`}</div>
        {d.styles.map((s, i) => (
          <div className="creator-style" key={i}>
            {many && <input className="input" defaultValue={s.label} placeholder={L`Название стиля`} maxLength={12}
              onBlur={(e) => set({ styles: styles.map((x, j) => (j === i ? { ...x, label: e.currentTarget.value } : x)) })} />}
            <button className={`btn btn-sm${s.vpk ? '' : ' btn-primary'}`} disabled={m.busy} onClick={() => actions.attach(d.id, i, 'vpk')}>
              <span className="ms">{s.vpk ? 'check' : 'upload_file'}</span>VPK</button>
            <button className={`btn btn-sm${s.picture ? '' : ' btn-primary'}`} disabled={m.busy} onClick={() => actions.attach(d.id, i, 'picture')}>
              <span className="ms">{s.picture ? 'check' : 'image'}</span>{L`Картинка`}</button>
            {d.pictures[i] ? <img className="creator-style-pic" src={d.pictures[i]!} alt="" /> : <span className="creator-style-pic" />}
            <span className="creator-colors">
              <input type="color" className="creator-color" aria-label={L`Цвет стиля`} defaultValue={s.colors[0] || HEX[0]}
                onBlur={(e) => setStyleColors(i, [e.currentTarget.value, ...s.colors.slice(1)])} />
              {s.colors.length > 1 && <input type="color" className="creator-color" aria-label={L`Второй цвет стиля`} defaultValue={s.colors[1]}
                onBlur={(e) => setStyleColors(i, [s.colors[0], e.currentTarget.value])} />}
              <button type="button" className="btn btn-ghost btn-xs" title={s.colors.length > 1 ? L`Один цвет` : L`Два цвета`}
                onClick={() => setStyleColors(i, s.colors.length > 1 ? [s.colors[0]] : [s.colors[0], HEX[1]])}>
                <span className="ms">{s.colors.length > 1 ? 'looks_one' : 'looks_two'}</span></button>
            </span>
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
        <button className="btn" id="creatorExportBtn" disabled={m.busy || d.missing.length > 0 || d.problems.length > 0} onClick={() => actions.export(d.id)}>
          <span className="ms">archive</span>{L`Сохранить архив`}</button>
        <button className="btn btn-primary" id="creatorUploadBtn" disabled={m.busy || !m.uploader || d.missing.length > 0 || d.problems.length > 0} title={m.uploader ? undefined : L`Нет токена`} onClick={() => actions.upload(d.id)}>
          <span className="ms">cloud_upload</span>{L`Отправить в каталог`}</button>
      </div>
      <div className="modal-note">{L`Отправка идёт через API каталога: каждый стиль уходит своим zip с одним VPK, рядом WebP-превью 854×480. Архив для ведущего собирается так же, как у PreMod.`}</div>
    </>
  );
}
