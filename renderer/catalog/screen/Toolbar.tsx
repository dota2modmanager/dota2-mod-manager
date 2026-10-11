/* Two lines, on purpose. The top one is how to look at the category - what order, whose heroes,
 * which slot, and the two answers about your own library - and it is the same everywhere. Tags
 * belong to this category alone, so they sit under it, quieter. */
import { catalogLabel } from '../../ui/catalog-name.ts';
import { SORTS } from '../../core/constants.ts';
import { plural } from '../../ui/format.ts';
import { heroName } from '../../ui/hero-name.ts';
import type { ScreenActions, ToolbarModel } from './model.ts';

interface Props { model: ToolbarModel; actions: ScreenActions }

/** `label` is what a screen reader calls the list: the icon beside it says it to the eye only. */
function Select({ icon, id, label, value, first, options, onPick }: {
  icon: string; id: string; label: string; value: string; first?: string;
  options: { value: string; label: string }[]; onPick: (v: string) => void;
}) {
  return (
    <div className="select-wrap">
      <span className="ms" aria-hidden="true">{icon}</span>
      <select id={id} aria-label={label} value={value} onChange={(e) => onPick(e.target.value)}>
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
        <Select icon="sort" id="sortSelect" label={L`Сортировка`} value={t.sort}
          options={SORTS.map((s: { key: string; label: string }) => ({ value: s.key, label: tr(s.label) }))}
          onPick={(sort) => actions.filter({ sort })} />
        {t.heroes.length > 0 && (
          <Select icon="person" id="heroSelect" label={L`Герой`} value={t.hero} first={L`Все герои`}
            options={t.heroes.map((h) => ({ value: h, label: heroName(h) }))} onPick={(hero) => actions.filter({ hero })} />
        )}
        {t.groups.length > 0 && (
          <Select icon={t.groupIcon} id="groupSelect" label={t.groupLabel} value={t.group} first={t.groupLabel}
            options={t.groups.map((g) => ({ value: g, label: catalogLabel(g) }))} onPick={(group) => actions.filter({ group })} />
        )}
        {t.slots.length > 0 && (
          <Select icon="checkroom" id="slotSelect" label={L`Слот`} value={t.slot} first={L`Все слоты`}
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
