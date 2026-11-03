/* The card for the in-game HUD made smaller or larger, first among the HUDs: drawn like the menu
 * background's card (background/BackgroundCard.tsx), a tool the app has in it. */
import { CardShell } from '../card/CardShell.tsx';
import { CardName } from '../card/CardName.tsx';

export interface HudCardModel { scale: number | null }

export function HudCard({ m, onOpen }: { m: HudCardModel; onOpen: (card: HTMLElement) => void }) {
  return (
    <CardShell moves={false} installed={m.scale !== null} dataKey="builtin|huds|scale" index={0} onClick={(e) => onOpen(e.currentTarget)}>
      <div className="card-media">
        <div className="noimg"><span className="ms">aspect_ratio</span></div>
      </div>
      <div className="card-body">
        <CardName>{L`Размер интерфейса в игре`}</CardName>
        <div className="card-meta card-meta-split">
          <span>{m.scale !== null ? `${m.scale}%` : L`Меньше или больше, чем даёт игра`}</span>
        </div>
      </div>
    </CardShell>
  );
}
