/* An arcana's card, first among the tools: a tool the app has in it rather than one to download.
 * Drawn with a mod card's markup (CardShell, .card-media, .card-body) and a tool's line under the
 * name (ToolMeta.tsx); once built, its picture is the arcana in the colour that was built. */
import { CardShell } from '../card/CardShell.tsx';
import { CardName } from '../card/CardName.tsx';
import { arcanaWords } from './heroes.ts';
import { gemOf, useArcanaPicture, useTinted, type Rgb } from './tint.ts';

export interface ArcanaCardModel {
  set: string;
  /** the item's name, as the game has it */
  name: string;
  picture: string | null;
  /** the colour it was built in, when it was */
  installed: Rgb | null;
}

export function ArcanaCard({ m, index, onOpen }: { m: ArcanaCardModel; index: number; onOpen: (set: string, card: HTMLElement) => void }) {
  const gem = gemOf(m.set);
  const picture = useTinted(useArcanaPicture(m.set, m), m.installed ?? gem, gem);
  return (
    <CardShell moves={false} installed={Boolean(m.installed)} dataKey={`builtin|arcana|${m.set}`} index={index} onClick={(e) => onOpen(m.set, e.currentTarget)}>
      <div className="card-media">
        {picture ? <img src={picture} alt="" /> : <div className="noimg"><span className="ms">palette</span></div>}
      </div>
      <div className="card-body">
        <CardName>{arcanaWords(m.set, m.name).card()}</CardName>
        <div className="card-meta card-meta-split">
          {!m.installed && <span>{L`Собрать`}</span>}
          <span className="card-pills"><span className="mtag soft">{L`Любой цвет`}</span></span>
        </div>
      </div>
    </CardShell>
  );
}
