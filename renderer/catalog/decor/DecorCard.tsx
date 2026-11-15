/* The cards of the two map windows, drawn like the HUD scale's card (hud/HudCard.tsx), a tool the
 * app has in it: Optimization first in its section, the map of one's own first among the terrains. */
import { CardShell } from '../card/CardShell.tsx';
import { CardName } from '../card/CardName.tsx';

export interface DecorCardModel { kind: 'map' | 'optimize'; installed: boolean }

export function DecorCard({ m, onOpen }: { m: DecorCardModel; onOpen: (card: HTMLElement, kind: 'map' | 'optimize') => void }) {
  const isMap = m.kind === 'map';
  return (
    <CardShell moves={false} installed={m.installed} dataKey={isMap ? 'builtin|terrains|map' : 'builtin|optimization|decor'} index={0} onClick={(e) => onOpen(e.currentTarget, m.kind)}>
      <div className="card-media">
        <div className="noimg"><span className="ms">{isMap ? 'landscape' : 'speed'}</span></div>
      </div>
      <div className="card-body">
        <CardName>{isMap ? L`Своя карта` : L`Оптимизация`}</CardName>
        <div className="card-meta card-meta-split">
          <span>{isMap ? L`Ландшафт, погода, тёмная карта, лоу-поли земля и деревья` : L`Декор, вода, эффекты и свет`}</span>
        </div>
      </div>
    </CardShell>
  );
}
