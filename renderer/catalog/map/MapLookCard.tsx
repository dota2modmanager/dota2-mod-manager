/* The card for towers or trees out of the game's own looks, first in its category: drawn like the
 * arcana's card (arcana/ArcanaCard.tsx), a tool the app has in it. The towers' card shows the
 * first look's picture; the trees have none, so their card keeps the category's glyph. */
import { CardShell } from '../card/CardShell.tsx';
import { CardName } from '../card/CardName.tsx';
import { useCosmeticIcon } from '../cosmetic/CosmeticCard.tsx';
import type { MapKind } from '../../api/content.ts';

export interface MapLookCardModel {
  kind: MapKind;
  /** the item whose picture stands for the card, for the towers */
  picture: string | null;
  installed: boolean;
}

export function MapLookCard({ m, onOpen }: { m: MapLookCardModel; onOpen: (kind: MapKind, card: HTMLElement) => void }) {
  const src = useCosmeticIcon(m.picture || '');
  return (
    <CardShell moves={false} installed={m.installed} dataKey={`builtin|map|${m.kind}`} index={0} onClick={(e) => onOpen(m.kind, e.currentTarget)}>
      <div className="card-media">
        {src ? <img src={src} alt="" /> : <div className="noimg"><span className="ms">{m.kind === 'towers' ? 'fort' : 'forest'}</span></div>}
      </div>
      <div className="card-body">
        <CardName>{m.kind === 'towers' ? L`Башни из игры` : L`Деревья из игры`}</CardName>
        <div className="card-meta card-meta-split">
          {!m.installed && <span>{L`Собрать`}</span>}
          <span className="card-pills"><span className="mtag soft">{L`Radiant и Dire`}</span></span>
        </div>
      </div>
    </CardShell>
  );
}
