/* The card for the rank medal and hero levels of the player's own screen, first among the ranks:
 * drawn like the HUD scale's card (hud/HudCard.tsx), a tool the app has in it. */
import { CardShell } from '../card/CardShell.tsx';
import { CardName } from '../card/CardName.tsx';

export interface RankCardModel { installed: boolean }

export function RankCard({ m, onOpen }: { m: RankCardModel; onOpen: (card: HTMLElement) => void }) {
  return (
    <CardShell moves={false} installed={m.installed} dataKey="builtin|ranks|look" index={0} onClick={(e) => onOpen(e.currentTarget)}>
      <div className="card-media">
        <div className="noimg"><span className="ms">military_tech</span></div>
      </div>
      <div className="card-body">
        <CardName>{L`Свой ранг и уровни героев`}</CardName>
        <div className="card-meta card-meta-split">
          <span>{L`Медаль и уровни Dota Plus, которые видишь только ты`}</span>
        </div>
      </div>
    </CardShell>
  );
}
