/* The card for a main menu background of the user's own, first among the backgrounds: drawn like
 * the hero sounds' card (sounds/SoundCard.tsx), a tool the app has in it. */
import { CardShell } from '../card/CardShell.tsx';
import { CardName } from '../card/CardName.tsx';

export interface BackgroundCardModel { installed: string | null }

export function BackgroundCard({ m, onOpen }: { m: BackgroundCardModel; onOpen: (card: HTMLElement) => void }) {
  return (
    <CardShell moves={false} installed={!!m.installed} dataKey="builtin|backgrounds|own" index={0} onClick={(e) => onOpen(e.currentTarget)}>
      <div className="card-media">
        <div className="noimg"><span className="ms">wallpaper</span></div>
      </div>
      <div className="card-body">
        <CardName>{L`Свой фон меню`}</CardName>
        <div className="card-meta card-meta-split">
          <span>{m.installed || L`Картинка, GIF или видео`}</span>
        </div>
      </div>
    </CardShell>
  );
}
