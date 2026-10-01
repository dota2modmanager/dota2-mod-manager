/* The catalog's front page: what arrived lately, then every category as a picture.
 * No heading over any of it: the window says Каталог in the tab strip, and a title repeating that
 * would push the first mods below the fold to say nothing. */
import type { CSSProperties } from 'react';
import type { Mod } from '../types.ts';
import type { ScreenActions } from './model.ts';
import { ModGrid } from '../card/ModGrid.tsx';
import { Media } from '../card/Media.tsx';

interface Props {
  recent: Mod[];
  tiles: { id: string; name: string; preview: string | null }[];
  actions: ScreenActions;
}

export function Home({ recent, tiles, actions }: Props) {
  return (
    <>
      {recent.length > 0 && (
        <>
          <div className="section-h"><span className="ms">new_releases</span>{L`Недавно добавленные`}</div>
          <div className="recent-row" id="recentRow">
            <ModGrid mods={recent} withCat onOpen={actions.openMod} onFavChanged={actions.favChanged} />
          </div>
        </>
      )}
      <div className="section-h"><span className="ms">apps</span>{L`Категории`}</div>
      <div className="cat-tiles">
        {tiles.map((c, i) => (
          <div key={c.id} className="cat-tile" data-cat={c.id} style={{ '--i': Math.min(i, 24) } as CSSProperties}
            onClick={() => actions.openCategory(c.id)}>
            {c.preview && <Media key={c.preview} url={c.preview} />}
            <div className="ct-shade" />
            <div className="ct-label">
              <span className="ct-name">{c.name}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
