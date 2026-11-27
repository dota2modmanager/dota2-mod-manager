/* What became of the mods sent from the author's window: the catalog's own record for the upload
 * key, asked for when the panel opens and again on Refresh. Drawn above the author's window so it
 * works from the drafts list as well as from a draft.
 *
 * Laid out as a timeline: a tally on top that is also the filter (all, on moderation, accepted,
 * turned down) with how much of what was sent got in, then each submission on a rail coloured by
 * its state, newest first, with the mod's picture once the catalog lists it. Each row answers what
 * the author wants next: a turned-down mod says why (the moderator writes it on the pull request,
 * crates/mm-core/src/tools/creator_upload.rs fetches it), an accepted one how many times it was
 * downloaded, and a click opens the pull request. creator/history.ts holds the rules. */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { dur, ease } from '../motion/tokens.ts';
import type { CreatorActions, CreatorModel } from './CreatorModal.tsx';
import type { CreatorHistoryItem } from '../api/creator.ts';
import { useDownloads } from '../catalog/card/hooks.ts';
import { findModByName } from '../views/catalog/lists.ts';
import { formatCount } from '../core/download-counts.ts';
import { previewUrl } from '../ui/media.ts';
import { ago, countStates, filterItems, newestFirst, stateOf, type HistoryFilter, type HistoryState } from './history.ts';
import type { Mod } from '../catalog/types.ts';

const STATE = (): Record<HistoryState, { label: string; icon: string }> => ({
  moderation: { label: L`На модерации`, icon: 'hourglass_top' },
  accepted: { label: L`Принято`, icon: 'check_circle' },
  rejected: { label: L`Отклонено`, icon: 'cancel' },
});

function stamped(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString(window.I18N_LANG === 'ru' ? 'ru-RU' : 'en-GB');
}

function when(iso?: string): string {
  const a = ago(iso, Date.now());
  if (!a) return '';
  switch (a.unit) {
    case 'now': return L`только что`;
    case 'min': return L`${a.n} мин назад`;
    case 'hour': return L`${a.n} ч назад`;
    case 'day': return L`${a.n} дн. назад`;
    default: return L`${a.n} мес. назад`;
  }
}

/** The accepted mod's downloads, once the catalog lists it and the counter has answered. */
function Downloads({ mod }: { mod: Mod }) {
  const n = useDownloads(mod._cat || '', mod);
  return n > 0 ? <span className="creator-history-dl"><span className="ms">download</span>{formatCount(n)}</span> : null;
}

function Row({ item, i }: { item: CreatorHistoryItem; i: number }) {
  const state = stateOf(item);
  const listed = item.name ? findModByName('', item.name) : null;
  const why = item.reason || item.note;
  // the record comes from the catalog's worker: only a GitHub page opens, as on the catalog's site
  const url = item.url?.startsWith('https://github.com/') ? item.url : undefined;
  const open = url ? () => void window.api.misc.openExternal(url) : undefined;
  const s = STATE()[state];
  // the catalog's picture, as its cards resolve it; a clip is not drawn as a still
  const pic = listed ? previewUrl(listed._cat || '', listed.preview) : null;
  const still = pic && !/\.(mp4|webm)(\?|$)/i.test(pic) ? pic : null;
  return (
    <motion.li className={`creator-history-item ${state}${open ? ' link' : ''}`} role={open ? 'link' : undefined}
      tabIndex={open ? 0 : undefined} title={open ? L`Открыть заявку на GitHub` : undefined} onClick={open}
      onKeyDown={(e) => { if (open && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } }}
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: dur('--dur-medium'), ease: ease('--ease-out'), delay: Math.min(i, 12) * 0.035 }}>
      <span className="creator-history-node" aria-hidden="true"><span className="ms">{s.icon}</span></span>
      <div className="creator-history-card">
        {still
          ? <img className="creator-history-pic" src={still} alt="" loading="lazy" />
          : <span className="creator-history-pic"><span className="ms">{item.kind === 'update' ? 'sync_alt' : 'deployed_code'}</span></span>}
        <div className="creator-history-text">
          <div className="creator-history-name">{item.name || L`Без имени`}</div>
          <div className="creator-history-meta">
            {item.kind === 'update' && <span className="creator-history-kind"><span className="ms">sync_alt</span>{L`Обновление`}</span>}
            {item.createdAt && <span title={stamped(item.createdAt)}>{when(item.createdAt)}</span>}
            {state === 'accepted' && listed && <Downloads mod={listed} />}
          </div>
          {state === 'rejected' && why && (
            <div className="creator-history-reason"><span className="ms">forum</span><span>{why}</span></div>
          )}
        </div>
        <span className="creator-history-status">{s.label}</span>
        {open && <span className="ms creator-history-go" aria-hidden="true">open_in_new</span>}
      </div>
    </motion.li>
  );
}

function Tally({ items, filter, onPick }: { items: CreatorHistoryItem[]; filter: HistoryFilter; onPick: (f: HistoryFilter) => void }) {
  const c = countStates(items);
  const states = STATE();
  const tiles: { f: HistoryFilter; label: string; icon: string }[] = [
    { f: 'all', label: L`Всего`, icon: 'inventory_2' },
    { f: 'moderation', ...states.moderation },
    { f: 'accepted', ...states.accepted },
    { f: 'rejected', ...states.rejected },
  ];
  const decided = c.accepted + c.rejected;
  return (
    <div className="creator-history-tally">
      <div className="creator-history-tiles" role="tablist" aria-label={L`Фильтр истории`}>
        {tiles.map((t) => (
          <button key={t.f} type="button" role="tab" aria-selected={filter === t.f} data-filter={t.f}
            className={`creator-history-tile ${t.f}${filter === t.f ? ' on' : ''}`} onClick={() => onPick(t.f)}>
            <span className="ms" aria-hidden="true">{t.icon}</span>
            <b>{c[t.f]}</b>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      {decided > 0 && (
        <div className="creator-history-rate">
          <div className="creator-history-bar" aria-hidden="true">
            <span className="accepted" style={{ width: `${(c.accepted / decided) * 100}%` }} />
            <span className="rejected" style={{ width: `${(c.rejected / decided) * 100}%` }} />
          </div>
          <span className="text-meta">{L`Принято ${c.accepted} из ${decided} рассмотренных`}</span>
        </div>
      )}
    </div>
  );
}

export function HistoryPanel({ m, actions }: { m: CreatorModel; actions: CreatorActions }) {
  const [filter, setFilter] = useState<HistoryFilter>('all');
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

  const shown = newestFirst(filterItems(m.historyItems, filter));
  return createPortal(
    <div className="creator-history-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) actions.hideHistory(); }}>
      <motion.div className="creator-history" role="dialog" aria-modal="true" aria-labelledby="creatorHistoryTitle"
        initial={{ opacity: 0, scale: 0.97, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: dur('--dur-medium'), ease: ease('--ease-out') }}>
        <div className="modal-title-row">
          <div className="modal-title" id="creatorHistoryTitle"><span className="ms">history</span>{L`История загрузок`}</div>
          <button className="btn btn-ghost btn-sm" id="creatorHistoryRefresh" disabled={m.historyLoading} onClick={actions.history}>
            <span className={`ms${m.historyLoading ? ' creator-spin' : ''}`}>refresh</span>{L`Обновить историю`}</button>
          <button className="modal-close" id="creatorHistoryClose" aria-label={L`Закрыть`} onClick={actions.hideHistory}><span className="ms">close</span></button>
        </div>
        {m.historyError ? (
          <div className="preset-warn"><span className="ms">error</span>{L`Не удалось загрузить историю`}: {m.historyError}</div>
        ) : m.historyLoading && !m.historyItems.length ? (
          <ul className="creator-history-list" aria-busy="true" aria-label={L`Загрузка…`}>
            {[0, 1, 2].map((i) => <li key={i} className="creator-history-skeleton"><span /><span /></li>)}
          </ul>
        ) : m.historyItems.length ? (
          <>
            <Tally items={m.historyItems} filter={filter} onPick={setFilter} />
            {shown.length
              ? <ol className="creator-history-list">{shown.map((item, i) => <Row key={`${filter}-${item.url || item.name || 'upload'}-${i}`} item={item} i={i} />)}</ol>
              : <div className="creator-history-empty"><span className="ms">filter_alt_off</span>{L`Здесь пусто`}</div>}
          </>
        ) : (
          <div className="creator-history-empty big">
            <span className="ms">rocket_launch</span>
            <b>{L`Загрузок еще нет`}</b>
            <span>{L`Отправленные моды появятся здесь: на модерации, принятые и отклонённые с причиной.`}</span>
          </div>
        )}
      </motion.div>
    </div>,
    document.body,
  );
}
