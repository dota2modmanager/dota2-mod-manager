/* The author's window (issue #236): drafts of mods for the catalog, kept on this computer, and a
 * finished one either saved as PreMod's archive or sent to the catalog's upload API. The terms are
 * shown once, as the site shows them, and are accepted through the app's API.
 *
 * Laid out as the catalog site's upload page: a head with who is signed in and how many drafts are
 * ready, the drafts as picture tiles, and a draft as the site's five-step wizard (DraftWizard.tsx).
 * Only the look changed: every field and button calls the same action as before. */
import { HistoryPanel } from './HistoryPanel.tsx';
import { Consent } from './Consent.tsx';
import { DraftWizard } from './DraftWizard.tsx';
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

/** The author's window: the drafts, or the form of the one open. */
export function CreatorModal({ m, actions }: { m: CreatorModel; actions: CreatorActions }) {
  const d = m.drafts.find((x) => x.id === m.open) || null;
  return (
    <div className="modal-body creator">
      <div className="modal-title-row creator-top">
        {d && <button className="btn btn-ghost btn-sm" id="creatorBackBtn" onClick={() => actions.open(null)}><span className="ms">arrow_back</span>{L`Черновики`}</button>}
        <div className="modal-title">{d ? (d.name || L`Новый мод`) : L`Кабинет автора`}</div>
        <button className="btn btn-ghost btn-sm" id="creatorHistoryBtn" onClick={() => actions.showHistory()} disabled={m.busy}><span className="ms">history</span>{L`История`}</button>
        <button className="modal-close" id="modalCloseBtn" aria-label={L`Закрыть`} onClick={actions.close}><span className="ms">close</span></button>
      </div>
      {d ? <DraftWizard key={d.id} d={d} m={m} actions={actions} /> : <DraftList m={m} actions={actions} />}
      {m.historyOpen && <HistoryPanel m={m} actions={actions} />}
      {!m.consent.accepted && <Consent busy={m.busy} onAccept={actions.acceptTerms} />}
    </div>
  );
}

/** Where the drafts stand: the window's first line, before the tiles. */
function Studio({ m }: { m: CreatorModel }) {
  const ready = m.drafts.filter((d) => !d.missing.length && !d.problems.length).length;
  return (
    <div className="creator-studio">
      <span className="creator-avatar"><span className="ms" aria-hidden="true">cloud_upload</span></span>
      <div className="creator-studio-who">
        <div className="creator-studio-name">{L`Загрузка в каталог`}</div>
        <div className="creator-studio-sub">{L`Мод для каталога: черновик хранится на этом компьютере, готовый можно отправить на модерацию`}</div>
      </div>
      <div className="creator-studio-stats">
        <span className="creator-stat"><b>{m.drafts.length}</b>{L`черновиков`}</span>
        <span className="creator-stat ok"><b>{ready}</b>{L`готово к отправке`}</span>
      </div>
    </div>
  );
}

function DraftList({ m, actions }: { m: CreatorModel; actions: CreatorActions }) {
  return (
    <>
      <Studio m={m} />
      <div className="creator-list">
        <button className="creator-tile creator-tile-new" id="creatorNewBtn" disabled={m.busy} onClick={actions.create}>
          <span className="ms" aria-hidden="true">add</span>
          <span className="creator-tile-name">{L`Новый мод`}</span>
          <span className="text-meta">{L`Черновик сохраняется сам, пока ты пишешь`}</span>
        </button>
        {m.drafts.map((d) => {
          const ready = !d.missing.length && !d.problems.length;
          return (
            <button key={d.id} className="creator-tile creator-row" onClick={() => actions.open(d.id)}>
              {d.pictures[0] ? <img src={d.pictures[0]} alt="" /> : <span className="creator-row-pic"><span className="ms">image</span></span>}
              <span className={`creator-tile-state${ready ? ' ok' : ''}`}>
                <span className="ms" aria-hidden="true">{ready ? 'check_circle' : 'pending'}</span>
                {ready ? L`готов` : L`не хватает: ${d.missing.length + d.problems.length}`}
              </span>
              <span className="creator-tile-body">
                <span className="creator-row-name">{d.name || L`Без названия`}</span>
                <span className="text-meta">{d.category ? `${m.categories.find((c) => c.value === d.category)?.label || d.category} · ` : ''}{when(d.updatedAt)}</span>
              </span>
            </button>
          );
        })}
      </div>
      {!m.drafts.length && <div className="share-hint creator-empty">{L`Черновиков пока нет`}</div>}
    </>
  );
}
