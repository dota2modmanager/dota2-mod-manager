/* Two lines, on purpose. The top one is how to look at the category - what order, whose heroes,
 * which slot, and the two answers about your own library - and it is the same everywhere. Tags
 * belong to this category alone, so they sit under it, quieter. */
import { SORTS } from '../../core/constants.ts';
import { plural } from '../../ui/format.ts';
import type { ScreenActions, ToolbarModel } from './model.ts';

interface Props { model: ToolbarModel; actions: ScreenActions }

function Select({ icon, id, value, first, options, onPick }: {
  icon: string; id: string; value: string; first?: string;
  options: { value: string; label: string }[]; onPick: (v: string) => void;
}) {
  return (
    <div className="select-wrap">
      <span className="ms">{icon}</span>
      <select id={id} value={value} onChange={(e) => onPick(e.target.value)}>
        {first !== undefined && <option value="">{first}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

export function Toolbar({ model: t, actions }: Props) {
  return (
    <div className="toolbar">
      <div className="tb-line">
        <Select icon="sort" id="sortSelect" value={t.sort}
          options={SORTS.map((s: { key: string; label: string }) => ({ value: s.key, label: tr(s.label) }))}
          onPick={(sort) => actions.filter({ sort })} />
        {t.heroes.length > 0 && (
          <Select icon="person" id="heroSelect" value={t.hero} first={L`Все герои`}
            options={t.heroes.map((h) => ({ value: h, label: h }))} onPick={(hero) => actions.filter({ hero })} />
        )}
        {t.groups.length > 0 && (
          <Select icon={t.groupIcon} id="groupSelect" value={t.group} first={t.groupLabel}
            options={t.groups.map((g) => ({ value: g, label: g }))} onPick={(group) => actions.filter({ group })} />
        )}
        {t.slots.length > 0 && (
          <Select icon="checkroom" id="slotSelect" value={t.slot} first={L`Все слоты`}
            options={t.slots.map((s) => ({ value: s.id, label: s.label }))} onPick={(slot) => actions.filter({ slot })} />
        )}
        {(t.installable || t.fav) && <div className="sep" />}
        {t.installable && (
          <button className={`fchip ${t.installedOnly ? 'active' : ''}`} id="installedChip"
            onClick={() => actions.filter({ installedOnly: !t.installedOnly })}>
            <span className="ms">check_circle</span>{L`Установленные`}
          </button>
        )}
        {t.fav && (
          <button className={`fchip ${t.favOnly ? 'active' : ''}`} id="favChip"
            onClick={() => actions.filter({ favOnly: !t.favOnly })}>
            <span className="ms">favorite</span>{L`Избранное`}
          </button>
        )}
        {t.layout && (
          <div className="layout-toggle" role="group" aria-label={L`Вид`}>
            <button className={`seg-btn ${t.layout === 'grid' ? 'active' : ''}`} data-layout="grid"
              title={L`Сеткой героев`} aria-label={L`Сеткой героев`} onClick={() => actions.layout('grid')}>
              <span className="ms">grid_view</span>
            </button>
            <button className={`seg-btn ${t.layout === 'list' ? 'active' : ''}`} data-layout="list"
              title={L`Все моды списком`} aria-label={L`Все моды списком`} onClick={() => actions.layout('list')}>
              <span className="ms">view_agenda</span>
            </button>
          </div>
        )}
        {t.showCount && (
          <span className="count">{`${t.resultCount} ${plural(t.resultCount, 'результат', 'результата', 'результатов')}`}</span>
        )}
      </div>
      {t.tags.length > 0 && (
        <div className="tb-line tb-tags">
          {t.tags.map((tag) => (
            <button key={tag.id} className={`fchip ${tag.on ? 'active' : ''}`} data-tag={tag.id}
              onClick={() => actions.toggleTag(tag.id)}>
              {tag.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
