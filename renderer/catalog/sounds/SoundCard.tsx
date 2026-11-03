/* The card for a sound of the user's own on a hero's event, first among the hero sounds: drawn like
 * the towers' card (map/MapLookCard.tsx), a tool the app has in it. */
import { CardShell } from '../card/CardShell.tsx';
import { CardName } from '../card/CardName.tsx';

export interface SoundCardModel { installed: number }

export function SoundCard({ m, onOpen }: { m: SoundCardModel; onOpen: (card: HTMLElement) => void }) {
  return (
    <CardShell moves={false} installed={m.installed > 0} dataKey="builtin|sounds|own" index={0} onClick={(e) => onOpen(e.currentTarget)}>
      <div className="card-media">
        <div className="noimg"><span className="ms">graphic_eq</span></div>
      </div>
      <div className="card-body">
        <CardName>{L`Свой звук на способность`}</CardName>
        <div className="card-meta card-meta-split">
          <span>{m.installed ? L`Героев со своими звуками: ${m.installed}` : L`MP3, WAV или OGG`}</span>
        </div>
      </div>
    </CardShell>
  );
}
