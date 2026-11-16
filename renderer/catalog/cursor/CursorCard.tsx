/* The card for the own-cursor window, first among the cursors: drawn like the HUD editor's card
 * (hud/HudCard.tsx), a tool the app has in it. */
import { CardShell } from '../card/CardShell.tsx';
import { CardName } from '../card/CardName.tsx';

export interface CursorCardModel { installed: boolean }

export function CursorCard({ m, onOpen }: { m: CursorCardModel; onOpen: (card: HTMLElement) => void }) {
  return (
    <CardShell moves={false} installed={m.installed} dataKey="builtin|cursors|own" index={0} onClick={(e) => onOpen(e.currentTarget)}>
      <div className="card-media">
        <div className="noimg"><span className="ms">arrow_selector_tool</span></div>
      </div>
      <div className="card-body">
        <CardName>{L`Свой курсор`}</CardName>
        <div className="card-meta card-meta-split">
          <span>{m.installed ? L`Свой курсор стоит` : L`Одна картинка — все курсоры игры`}</span>
        </div>
      </div>
    </CardShell>
  );
}
