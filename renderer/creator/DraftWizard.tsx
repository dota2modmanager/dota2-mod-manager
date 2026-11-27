/* One draft as the catalog site's upload page walks it (h6rd/Dota2PornFxWeb upload.html): a
 * stepper over five steps, Files, Mod, Details, Credits and Review, one step on screen at a time,
 * Back and Next under it, and beside it the card as the catalog will draw it with what is still
 * missing.
 *
 * The steps only decide what is on screen. Every field still saves the draft as it did on one page
 * (actions.change on blur), so moving between steps, closing the window or jumping back from the
 * review loses nothing, and the readiness the review shows is the core's own (missing, problems in
 * crates/mm-core/src/tools/creator.rs), not this file's guess. The dots only say which steps look
 * filled in. */
import { useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { dur, ease } from '../motion/tokens.ts';
import { Dropdown } from '../ui/Dropdown.tsx';
import { nameLimit } from './naming.ts';
import type { CreatorActions, CreatorModel } from './CreatorModal.tsx';
import type { CreatorDraft, CreatorFields } from '../api/creator.ts';

const HEX = ['#ddd4ff', '#ff8f8f', '#8fd3ff', '#ffffff'];
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

type Step = 'files' | 'mod' | 'details' | 'credits' | 'review';
const STEPS: Step[] = ['files', 'mod', 'details', 'credits', 'review'];

const STEP_TEXT = (): Record<Step, { label: string; title: string; desc: string }> => ({
  files: { label: L`Файлы`, title: L`Файлы мода`, desc: L`VPK и картинка для каждого стиля. Стилей может быть до трёх: у каждого свой архив в одной карточке.` },
  mod: { label: L`Мод`, title: L`Что это за мод`, desc: L`Категория и название. Для мода героя название начинается с имени героя.` },
  details: { label: L`Детали`, title: L`Детали`, desc: L`Описание и теги помогают понять, что входит в мод.` },
  credits: { label: L`Авторы`, title: L`Кто сделал мод`, desc: L`Автор и, если нужно, соавтор, источник или кто доработал.` },
  review: { label: L`Проверка`, title: L`Проверка и отправка`, desc: L`Проверь всё ниже и отправь мод на модерацию или сохрани архив для ведущего.` },
});

/** Which steps look filled in, for the stepper's dots. */
function filled(d: CreatorDraft, m: CreatorModel): Record<Step, boolean> {
  const slots = m.slotTags[d.category] || [];
  return {
    files: d.styles.length > 0 && d.styles.every((s) => s.vpk && s.picture),
    mod: !!d.name.trim() && !!d.category && (!m.heroCats.includes(d.category) || !!d.hero),
    // tags come with the category: before one is picked there is nothing here to have filled in
    details: !!d.category && (!slots.length || slots.some((k) => d.tags[k])),
    credits: d.authorMode === 'skip' || !!d.author.trim(),
    review: !d.missing.length && !d.problems.length,
  };
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

function Stepper({ at, done, onPick }: { at: number; done: Record<Step, boolean>; onPick: (i: number) => void }) {
  const text = STEP_TEXT();
  return (
    <ol className="creator-stepper">
      {STEPS.map((s, i) => (
        <li key={s} className={`${i === at ? 'active' : ''}${done[s] ? ' done' : ''}${i < at ? ' past' : ''}`}>
          <button type="button" data-step={s} aria-current={i === at ? 'step' : undefined} onClick={() => onPick(i)}>
            <span className="creator-step-dot">{done[s] && i !== at ? <span className="ms">check</span> : i + 1}</span>
            <span className="creator-step-label">{text[s].label}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

export function DraftWizard({ d, m, actions }: { d: CreatorDraft; m: CreatorModel; actions: CreatorActions }) {
  const [at, setAt] = useState(0);
  const set = (fields: CreatorFields) => actions.change(d.id, fields);
  const styles = d.styles.map((s) => ({ label: s.label, colors: s.colors }));
  const many = d.styles.length > 1;
  const done = filled(d, m);
  const ready = done.review;
  const step = STEPS[at];
  const text = STEP_TEXT()[step];
  // a field is saved when it loses focus: going to another step first lets the blur land
  const go = (i: number) => { (document.activeElement as HTMLElement | null)?.blur?.(); setAt(Math.max(0, Math.min(STEPS.length - 1, i))); };
  return (
    <div className="creator-grid">
      <div className="creator-wizard">
        <Stepper at={at} done={done} onPick={go} />
        <motion.div key={step} className="creator-step" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}
          transition={{ duration: dur('--dur-medium'), ease: ease('--ease-out') }}>
          <div className="creator-step-head">
            <div>
              <h3 className="creator-step-title">{text.title}</h3>
              <p className="creator-step-desc">{text.desc}</p>
            </div>
            {step === 'files' && d.styles.length < 3 && (
              <button className="btn btn-ghost btn-sm" id="creatorAddStyle" onClick={() => set({ styles: [...styles, { label: '' }] })}><span className="ms">add</span>{L`Ещё стиль`}</button>
            )}
          </div>
          {step === 'files' && <FilesStep d={d} m={m} actions={actions} set={set} />}
          {step === 'mod' && <ModStep d={d} m={m} set={set} />}
          {step === 'details' && <DetailsStep d={d} m={m} set={set} />}
          {step === 'credits' && <CreditsStep d={d} m={m} set={set} />}
          {step === 'review' && <ReviewStep d={d} m={m} actions={actions} go={go} />}
        </motion.div>
        <div className="creator-nav">
          {at > 0
            ? <button type="button" className="btn btn-ghost" id="creatorPrevBtn" onClick={() => go(at - 1)}><span className="ms">arrow_back</span>{L`Назад`}</button>
            : <span />}
          {at < STEPS.length - 1 && (
            <button type="button" className="btn btn-primary creator-next" id="creatorNextBtn" onClick={() => go(at + 1)}>{L`Далее`}<span className="ms">arrow_forward</span></button>
          )}
        </div>
      </div>

      <aside className="creator-side">
        {/* the card as the catalog will draw it: its picture, its name, who made it */}
        <div className="creator-card" aria-label={L`Как в каталоге`}>
          {d.pictures[0] ? <img src={d.pictures[0]} alt="" /> : <div className="creator-card-pic"><span className="ms">image</span></div>}
          <div className="creator-card-name">{d.name || L`Название мода`}</div>
          <div className="creator-card-meta">
            <span className="text-meta">{m.categories.find((c) => c.value === d.category)?.label || L`Категория`}</span>
            <span className="creator-card-author"><span className="ms">person</span>{d.authorMode === 'skip' || !d.author ? L`Аноним` : d.author}</span>
          </div>
          {many && <div className="creator-card-styles">{d.styles.map((s, i) => (
            <span key={i} className="creator-swatch" title={s.label} style={{ background: s.colors.length > 1 ? `linear-gradient(135deg, ${s.colors[0]} 50%, ${s.colors[1]} 50%)` : s.colors[0] }} />
          ))}</div>}
        </div>

        <div className={`creator-check${ready ? ' ok' : ''}`}>
          <div className="creator-check-h"><span className="ms">checklist</span>{L`Готовность`}</div>
          {ready
            ? <div className="creator-check-row"><span className="ms">verified</span><span>{L`Готов к отправке`}</span></div>
            : (
              <>
                {d.missing.length > 0 && <div className="creator-check-row"><span className="ms">info</span><span>{L`Не хватает: ${d.missing.join(', ')}`}</span></div>}
                {d.problems.length > 0 && <div className="creator-check-row"><span className="ms">rule</span><span>{L`Для каталога нужно: ${d.problems.join(', ')}`}</span></div>}
              </>
            )}
        </div>
        <button className="btn btn-ghost btn-sm creator-delete" id="creatorDeleteBtn" disabled={m.busy} onClick={() => actions.remove(d.id)}>
          <span className="ms">delete</span>{L`Удалить черновик`}</button>
      </aside>
    </div>
  );
}

type Set = (fields: CreatorFields) => void;

function FilesStep({ d, m, actions, set }: { d: CreatorDraft; m: CreatorModel; actions: CreatorActions; set: Set }) {
  const styles = d.styles.map((s) => ({ label: s.label, colors: s.colors }));
  const many = d.styles.length > 1;
  const setStyleColors = (i: number, colors: string[]) => set({ styles: styles.map((x, j) => (j === i ? { ...x, colors } : x)) });
  return (
    <div className="creator-styles">
      {d.styles.map((s, i) => (
        <div className="creator-style" key={i}>
          {many && (
            <div className="creator-style-head">
              <span className="creator-style-n">{L`Стиль ${i + 1}`}</span>
              <input className="input" defaultValue={s.label} placeholder={L`Название стиля`} maxLength={12}
                onBlur={(e) => set({ styles: styles.map((x, j) => (j === i ? { ...x, label: e.currentTarget.value } : x)) })} />
              <span className="creator-colors">
                <input type="color" className="creator-color" aria-label={L`Цвет стиля`} defaultValue={s.colors[0] || HEX[i] || HEX[0]}
                  onBlur={(e) => setStyleColors(i, [e.currentTarget.value, ...s.colors.slice(1)])} />
                {s.colors.length > 1 && <input type="color" className="creator-color" aria-label={L`Второй цвет стиля`} defaultValue={s.colors[1]}
                  onBlur={(e) => setStyleColors(i, [s.colors[0], e.currentTarget.value])} />}
                <button type="button" className="btn btn-ghost btn-xs" title={s.colors.length > 1 ? L`Один цвет` : L`Два цвета`}
                  onClick={() => setStyleColors(i, s.colors.length > 1 ? [s.colors[0]] : [s.colors[0], HEX[3]])}>
                  <span className="ms">{s.colors.length > 1 ? 'looks_one' : 'looks_two'}</span></button>
              </span>
              <button className="btn btn-ghost btn-xs" aria-label={L`Убрать стиль`} onClick={() => set({ styles: styles.filter((_, j) => j !== i) })}><span className="ms">delete</span></button>
            </div>
          )}
          <div className="creator-drops">
            <button type="button" className={`creator-drop${s.vpk ? ' done' : ''}`} disabled={m.busy} onClick={() => actions.attach(d.id, i, 'vpk')}>
              <span className="ms creator-drop-icon">{s.vpk ? 'task' : 'upload_file'}</span>
              <span className="creator-drop-title">{s.vpk ? L`VPK выбран` : L`Выбрать VPK`}</span>
              <span className="creator-drop-sub">{s.vpk ? L`Нажми, чтобы заменить` : L`Файл .vpk собранного мода`}</span>
            </button>
            <button type="button" className={`creator-drop creator-drop-pic${s.picture ? ' done' : ''}`} disabled={m.busy} onClick={() => actions.attach(d.id, i, 'picture')}>
              {d.pictures[i] ? <img src={d.pictures[i]!} alt="" /> : <span className="ms creator-drop-icon">{s.picture ? 'image' : 'add_photo_alternate'}</span>}
              <span className="creator-drop-title">{s.picture ? L`Превью выбрано` : L`Выбрать превью`}</span>
              <span className="creator-drop-sub">{L`Картинка или видео: PNG, JPG, WebP, GIF, MP4, WebM`}</span>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ModStep({ d, m, set }: { d: CreatorDraft; m: CreatorModel; set: Set }) {
  const subcats = m.subcats[d.category] || [];
  return (
    <div className="creator-fields">
      <div className="creator-pickers">
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
      </div>
      <label className="creator-field"><span>{L`Название`}</span>
        <input className="input" id="creatorName" key={d.name} defaultValue={d.name} maxLength={nameLimit(d.hero)} placeholder={L`Латиницей, с именем героя для мода героя`} onBlur={(e) => set({ name: e.currentTarget.value })} />
        <span className="text-meta creator-count">{d.name.length}/{nameLimit(d.hero)}</span>
      </label>
    </div>
  );
}

function DetailsStep({ d, m, set }: { d: CreatorDraft; m: CreatorModel; set: Set }) {
  const tagMap = m.tags[d.category] || {};
  const slots = m.slotTags[d.category] || [];
  const toggleTag = (key: string) => {
    const next = { ...d.tags, [key]: !d.tags[key] };
    // a hero item has exactly one slot, so picking one puts the others down
    if (slots.includes(key) && next[key]) for (const other of slots) if (other !== key) next[other] = false;
    set({ tags: next });
  };
  const slotEntries = Object.entries(tagMap).filter(([k]) => slots.includes(k));
  const otherEntries = Object.entries(tagMap).filter(([k]) => !slots.includes(k));
  const chip = ([key, label]: [string, string]) => (
    <button key={key} type="button" className={`creator-tag${d.tags[key] ? ' on' : ''}`} onClick={() => toggleTag(key)}>
      {d.tags[key] && <span className="ms" aria-hidden="true">check</span>}{label}
    </button>
  );
  return (
    <div className="creator-fields">
      {slotEntries.length > 0 && (
        <div className="creator-field"><span>{L`Слот`} <span className="text-meta">({L`ровно один`})</span></span>
          <div className="creator-tags">{slotEntries.map(chip)}</div>
        </div>
      )}
      {otherEntries.length > 0 && (
        <div className="creator-field"><span>{L`Теги`}</span>
          <div className="creator-tags">{otherEntries.map(chip)}</div>
        </div>
      )}
      {!d.category && <p className="text-meta">{L`Теги появятся, когда выберешь категорию на шаге «Мод».`}</p>}
      <label className="creator-field"><span>{L`Описание`}</span>
        <textarea className="input" id="creatorDescription" defaultValue={d.description} rows={4} maxLength={2000} onBlur={(e) => set({ description: e.currentTarget.value })} />
      </label>
      {m.videoCats.includes(d.category) && (
        <label className="creator-field"><span>{L`Превью-видео`} <span className="text-meta">(YouTube)</span></span>
          <input className="input" id="creatorVideo" defaultValue={d.video} maxLength={300} placeholder="https://www.youtube.com/watch?v=…" onBlur={(e) => set({ video: e.currentTarget.value })} />
        </label>
      )}
    </div>
  );
}

function CreditsStep({ d, m, set }: { d: CreatorDraft; m: CreatorModel; set: Set }) {
  const hint = (text: string) => <span className="text-meta creator-hint"><span className="ms">info</span>{text}</span>;
  return (
    <div className="creator-fields">
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
            {d.author && m.authors.find((a) => norm(a) === norm(d.author)) && hint(L`Такой автор уже есть в каталоге — выбери «Существующий»`)}
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
                {d.extraName && (d.extraMode === 'source' ? m.sources : m.authors).find((a) => norm(a) === norm(d.extraName))
                  && hint(d.extraMode === 'source' ? L`Такой источник уже есть в каталоге — выбери «Существующий»` : L`Такой автор уже есть в каталоге — выбери «Существующий»`)}
              </>
            )}
            {d.extraName && norm(d.extraName) === norm(d.author) && hint(L`Автор не может быть указан дважды`)}
          </>
        )}
      </div>
    </div>
  );
}

function ReviewStep({ d, m, actions, go }: { d: CreatorDraft; m: CreatorModel; actions: CreatorActions; go: (i: number) => void }) {
  const ready = !d.missing.length && !d.problems.length;
  const tagMap = m.tags[d.category] || {};
  const tags = Object.keys(d.tags).filter((k) => d.tags[k]).map((k) => tagMap[k] || k);
  const extra = { none: '', author: L`Соавтор`, source: L`Источник`, modded: L`Доработано` }[d.extraMode];
  const row = (label: string, value: ReactNode, step: number) => (
    <div className="creator-summary-row">
      <dt>{label}</dt>
      <dd>{value || <span className="text-meta">—</span>}</dd>
      <button type="button" className="btn btn-ghost btn-xs" aria-label={L`Изменить`} onClick={() => go(step)}><span className="ms">edit</span></button>
    </div>
  );
  return (
    <div className="creator-fields">
      <dl className="creator-summary">
        {row(L`Название`, d.name, 1)}
        {row(L`Категория`, [m.categories.find((c) => c.value === d.category)?.label, d.hero].filter(Boolean).join(' · '), 1)}
        {row(L`Файлы`, d.styles.map((s, i) => `${s.label || L`Стиль ${i + 1}`}: ${[s.vpk ? 'VPK' : '', s.picture ? L`картинка` : ''].filter(Boolean).join(' + ') || '—'}`).join('; '), 0)}
        {row(L`Теги`, tags.join(', '), 2)}
        {row(L`Автор`, d.authorMode === 'skip' ? L`Аноним` : d.author, 3)}
        {d.extraMode !== 'none' && row(extra, d.extraName, 3)}
      </dl>
      <div className="creator-send">
        <button className="btn btn-primary" id="creatorUploadBtn" disabled={m.busy || !m.uploader || !ready} title={m.uploader ? undefined : L`Нет токена`} onClick={() => actions.upload(d.id)}>
          <span className="ms">cloud_upload</span>{L`Отправить в каталог`}</button>
        <button className="btn" id="creatorExportBtn" disabled={m.busy || !ready} onClick={() => actions.export(d.id)}>
          <span className="ms">archive</span>{L`Сохранить архив`}</button>
      </div>
      <div className="modal-note">{L`Отправка идёт через API каталога: каждый стиль уходит своим zip с одним VPK, рядом WebP-превью 854×480. Архив для ведущего собирается так же, как у PreMod.`}</div>
    </div>
  );
}
