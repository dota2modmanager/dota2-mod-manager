/* The card for the map without its decor, first in Optimization: drawn like the HUD scale's card
 * (hud/HudCard.tsx), a tool the app has in it. */
import { CardShell } from '../card/CardShell.tsx';
import { CardName } from '../card/CardName.tsx';

export interface DecorCardModel { installed: boolean }

export function DecorCard({ m, onOpen }: { m: DecorCardModel; onOpen: (card: HTMLElement) => void }) {
  return (
    <CardShell moves={false} installed={m.installed} dataKey="builtin|optimization|decor" index={0} onClick={(e) => onOpen(e.currentTarget)}>
      <div className="card-media">
        <div className="noimg"><span className="ms">grass</span></div>
      </div>
      <div className="card-body">
        <CardName>{L`Карта без декора`}</CardName>
        <div className="card-meta card-meta-split">
          <span>{L`Трава, цветы, камни и мусор прочь с карты`}</span>
        </div>
      </div>
    </CardShell>
  );
}
