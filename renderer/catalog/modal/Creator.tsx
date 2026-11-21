/* Who made a mod, under what the window says about it: the first author, how many mods of theirs
 * the catalog has, and a way to the rest of theirs in this category. */
import type { ModModalModel } from './model.ts';
import { FollowButton } from '../social/Social.tsx';

export function Creator({ c, onAll, onPage }: { c: NonNullable<ModModalModel['creator']>; onAll: () => void; onPage: () => void }) {
  return (
    <div className="mod-creator" id="modCreator">
      <span className="mod-creator-badge" aria-hidden="true">{c.name.slice(0, 1).toUpperCase()}</span>
      <span className="mod-creator-text">
        <span className="mod-creator-label">{L`Создатель`}</span>
        <span className="mod-creator-name" title={c.name}>{c.name}</span>
        <span className="mod-creator-count">{L`Модов в каталоге: ${c.mods}`}</span>
      </span>
      <FollowButton author={c.name} />
      <span className="mod-creator-actions">
      {c.mods > c.here && (
        <button className="btn btn-sm" id="modCreatorPage" onClick={onPage}>
          <span className="ms">person</span>{L`Все моды автора`}
        </button>
      )}
      {c.here > 1 && (
        <button className="btn btn-sm" id="modCreatorAll" onClick={onAll}>
          <span className="ms">brush</span>{L`Ещё в этой категории: ${c.here - 1}`}
        </button>
      )}
      </span>
    </div>
  );
}
