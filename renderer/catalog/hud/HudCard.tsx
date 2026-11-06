/* The card for the HUD editor, first among the HUDs: drawn like the menu
 * background's card (background/BackgroundCard.tsx), a tool the app has in it. */
import { CardShell } from '../card/CardShell.tsx';
import { CardName } from '../card/CardName.tsx';

export interface HudCardModel {
  /** panels the layout on now changes, or null with none on */
  changed: number | null;
}

export function HudCard({ m, onOpen }: { m: HudCardModel; onOpen: (card: HTMLElement) => void }) {
  return (
    <CardShell moves={false} installed={m.changed !== null} dataKey="builtin|huds|scale" index={0} onClick={(e) => onOpen(e.currentTarget)}>
      <div className="card-media">
        <div className="noimg"><span className="ms">dashboard_customize</span></div>
      </div>
      <div className="card-body">
        <CardName>{L`Редактор интерфейса`}</CardName>
        <div className="card-meta card-meta-split">
          <span>{m.changed !== null ? L`Панелей изменено: ${m.changed}` : L`Панели на своих местах и своего размера`}</span>
        </div>
      </div>
    </CardShell>
  );
}
