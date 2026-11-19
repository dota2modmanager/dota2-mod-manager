/* The card of the author's drafts (views/creator.ts), drawn like the map's (decor/DecorCard.tsx),
 * a tool the app has in it. A search for a mod of one's own shows it above the mods
 * (screen/tool-search.ts): the window is otherwise behind the account's menu and the studio. */
import { CardShell } from '../card/CardShell.tsx';
import { CardName } from '../card/CardName.tsx';

export function CreatorCard({ onOpen }: { onOpen: (card: HTMLElement) => void }) {
  return (
    <CardShell moves={false} installed={false} dataKey="builtin|tools|creator" index={0} onClick={(e) => onOpen(e.currentTarget)}>
      <div className="card-media">
        <div className="noimg"><span className="ms">edit_note</span></div>
      </div>
      <div className="card-body">
        <CardName>{L`Кабинет автора`}</CardName>
        <div className="card-meta card-meta-split">
          <span>{L`Свой мод или фон в каталог: черновик и модерация`}</span>
        </div>
      </div>
    </CardShell>
  );
}
