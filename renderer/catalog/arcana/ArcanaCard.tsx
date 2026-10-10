/* The arcana's card, first among the tools: a tool the app has in it rather than one to download.
 * Drawn with a mod card's markup (CardShell, .card-media, .card-body) and a tool's line under the
 * name (ToolMeta.tsx); once built, its picture is the arcana in the colour that was built. */
import { CardShell } from '../card/CardShell.tsx';
import { CardName } from '../card/CardName.tsx';
import { GEM, useTinted, type Rgb } from './tint.ts';

export interface ArcanaCardModel {
  picture: string | null;
  /** the colour it was built in, when it was */
  installed: Rgb | null;
}

export function ArcanaCard({ m, onOpen }: { m: ArcanaCardModel; onOpen: (card: HTMLElement) => void }) {
  const picture = useTinted(m.picture, m.installed ?? GEM);
  return (
    <CardShell moves={false} installed={Boolean(m.installed)} dataKey="builtin|arcana" index={0} onClick={(e) => onOpen(e.currentTarget)}>
      <div className="card-media">
        {picture ? <img src={picture} alt="" /> : <div className="noimg"><span className="ms">palette</span></div>}
      </div>
      <div className="card-body">
        <CardName>{L`Аркана Террорблейда`}</CardName>
        <div className="card-meta card-meta-split">
          {!m.installed && <span>{L`Собрать`}</span>}
          <span className="card-pills"><span className="mtag soft">{L`Любой цвет`}</span></span>
        </div>
      </div>
    </CardShell>
  );
}
