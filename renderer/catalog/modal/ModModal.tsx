/* The window a mod card opens: its picture, who made it, its looks, what can be done with it, and
 * what the catalog wrote about it. The markup drawModal() used to write, so the window's styles,
 * the simulation and the screenshot harness find what they always found. */
import type { CSSProperties } from 'react';
import type { ModModalActions, ModModalModel } from './model.ts';
import { Media } from '../card/Media.tsx';
import { LegacyHtml } from '../screen/LegacyHtml.tsx';
import { flatColor } from '../colors.ts';
import { ModActions } from './ModActions.tsx';
import { PackList } from './PackList.tsx';
import { catalogName, catalogLabel } from '../../ui/catalog-name.ts';

export function ModModal({ m, actions }: { m: ModModalModel; actions: ModModalActions }) {
  const favLabel = m.fav ? L`Убрать из избранного` : L`В избранное`;
  return (
    <>
      <div className="modal-media">
        <Media key={m.mediaUrl || ''} url={m.mediaUrl} autoplay fallbackIcon={m.fallbackIcon} />
        <button className="modal-close" id="modalCloseBtn" aria-label={L`Закрыть`} onClick={actions.close}>
          <span className="ms">close</span>
        </button>
        {m.playable && (
          <button className="preview-toggle" id="previewPlayBtn" onClick={actions.playPreview}>
            <span className="ms">play_circle</span>{L`Смотреть превью`}
          </button>
        )}
      </div>
      <div className="modal-body">
        <div className="modal-title-row">
          <div className="modal-title" title={m.mod.name}>{catalogName(m.mod.name)}</div>
          <button className={`fav-btn ${m.fav ? 'on' : ''}`} data-fav={`${m.categoryId}|${m.mod.name}`} data-owned="react"
            aria-pressed={m.fav} title={favLabel} aria-label={favLabel} onClick={actions.toggleFav}>
            <span className="ms">{m.fav ? 'favorite' : 'favorite_border'}</span>
          </button>
        </div>
        <div className="modal-sub">
          <span>{m.catName}</span>
          {m.mod._group && <span>{`· ${catalogLabel(m.mod._group)}`}</span>}
          {m.mod._custom && <span>{L`· свой пак`}</span>}
          {m.date && <span>{`· ${m.date}`}</span>}
          <LegacyHtml tag="span" className="modal-layer" html={m.creditsHtml} bind={actions.bindCredits} />
        </div>
        {m.styles && (
          <div className="style-row">
            {m.styles.map((s, i) => (
              <button key={i} className={`style-btn ${i === m.styleIdx ? 'active' : ''}`} data-style={i}
                style={{ '--c': flatColor(s.color) } as CSSProperties} onClick={() => actions.pickStyle(i)}>
                {s.label ? catalogLabel(s.label) : tr('Обычный')}
              </button>
            ))}
          </div>
        )}
        {m.kind === 'pack' && <PackList m={m} actions={actions} />}
        <div className="modal-actions"><ModActions m={m} actions={actions} /></div>
        <LegacyHtml className="modal-layer" html={m.guidesHtml} bind={actions.bindGuides} />
        {m.links.length > 0 && (
          <div className="modal-links">
            {m.links.map((l) => (
              <button key={l.index} className="btn btn-sm" data-link={l.index} onClick={() => actions.openExtraLink(l.index)}>
                <span className="ms">open_in_new</span>{l.label}
              </button>
            ))}
          </div>
        )}
        {m.note && <div className="modal-note">{m.note}</div>}
      </div>
    </>
  );
}
