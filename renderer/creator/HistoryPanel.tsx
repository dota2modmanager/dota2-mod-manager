/* What became of the mods sent from the author's window: the catalog's own record for the upload
 * key, asked for when the panel opens and again on Refresh. Drawn above the author's window so it
 * works from the drafts list as well as from a draft. */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { CreatorActions, CreatorModel } from './CreatorModal.tsx';
import type { CreatorHistoryItem } from '../api/creator.ts';

function stamped(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString(window.I18N_LANG === 'ru' ? 'ru-RU' : 'en-GB');
}

function Row({ item }: { item: CreatorHistoryItem }) {
  const status = (item.status || 'moderation').toLowerCase();
  const label = status === 'accepted' ? L`Принято` : status === 'rejected' ? L`Отклонено` : L`На модерации`;
  const icon = status === 'accepted' ? 'check_circle' : status === 'rejected' ? 'cancel' : 'hourglass_top';
  return (
    <div className={`creator-history-item ${status}`}>
      <div className="creator-history-text">
        <div className="creator-history-name">{item.name || L`Без имени`}</div>
        <div className="text-meta">
          {item.kind === 'update' && <>{L`Обновление`} · </>}
          {stamped(item.createdAt)}
        </div>
        {status === 'rejected' && item.reason && <div className="creator-history-reason">{item.reason}</div>}
      </div>
      <span className="creator-history-status"><span className="ms">{icon}</span>{label}</span>
    </div>
  );
}

export function HistoryPanel({ m, actions }: { m: CreatorModel; actions: CreatorActions }) {
  // the author's window already closes on Escape; while this panel is up, it closes first
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      actions.hideHistory();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [actions]);

  return createPortal(
    <div className="creator-history-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) actions.hideHistory(); }}>
      <div className="creator-history" role="dialog" aria-modal="true" aria-labelledby="creatorHistoryTitle">
        <div className="modal-title-row">
          <div className="modal-title" id="creatorHistoryTitle"><span className="ms">history</span>{L`История загрузок`}</div>
          <button className="btn btn-ghost btn-sm" id="creatorHistoryRefresh" disabled={m.historyLoading} onClick={actions.history}>
            <span className="ms">refresh</span>{L`Обновить историю`}</button>
          <button className="modal-close" id="creatorHistoryClose" aria-label={L`Закрыть`} onClick={actions.hideHistory}><span className="ms">close</span></button>
        </div>
        {m.historyError ? (
          <div className="preset-warn"><span className="ms">error</span>{L`Не удалось загрузить историю`}: {m.historyError}</div>
        ) : m.historyLoading ? (
          <div className="creator-history-empty"><span className="ms">progress_activity</span>{L`Загрузка…`}</div>
        ) : m.historyItems.length ? (
          <div className="creator-history-list">
            {m.historyItems.map((item, i) => <Row key={`${item.url || item.name || 'upload'}-${i}`} item={item} />)}
          </div>
        ) : (
          <div className="creator-history-empty"><span className="ms">inbox</span>{L`Загрузок еще нет`}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
