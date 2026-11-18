/* The strip to try the set on before it goes in: ground, an enemy, an ally, the shop and the menu,
 * each wearing the cursor the game would show there, for a move, an attack or a spell. */
import type { CursorModalActions, CursorTile, PlayMode } from './model.ts';

const ZONES: { id: string; icon: string; label: () => string; by: Record<PlayMode, string> }[] = [
  { id: 'ground', icon: 'grass', label: () => L`Земля`, by: { move: 'cursor_default', attack: 'cursor_attack_default', spell: 'cursor_spell_default' } },
  { id: 'enemy', icon: 'skull', label: () => L`Враг`, by: { move: 'cursor_default_enemy', attack: 'cursor_attack_enemy', spell: 'cursor_spell_enemy' } },
  { id: 'team', icon: 'shield_person', label: () => L`Союзник`, by: { move: 'cursor_default_team', attack: 'cursor_attack_team', spell: 'cursor_spell_team' } },
  { id: 'shop', icon: 'storefront', label: () => L`Магазин`, by: { move: 'cursor_buy', attack: 'cursor_cannot_buy', spell: 'cursor_item_drop' } },
  { id: 'menu', icon: 'menu', label: () => L`Меню`, by: { move: 'cursor_db_default', attack: 'cursor_db_default_highlight', spell: 'cursor_db_default_highlight' } },
];

export function CursorPlay({ tiles, play, actions }: { tiles: CursorTile[]; play: PlayMode; actions: CursorModalActions }) {
  const css = (name: string) => tiles.find((t) => t.kind.name === name)?.css ?? 'auto';
  const modes: [PlayMode, string, string][] = [['move', 'near_me', L`Обычный`], ['attack', 'swords', L`Атака`], ['spell', 'my_location', L`Способность`]];
  return (
    <div className="cursor-play">
      <div className="cursor-play-modes">
        <span className="cursor-play-title">{L`Проверь: наведи мышь`}</span>
        <div className="cursor-seg" role="tablist">
          {modes.map(([id, icon, label]) => (
            <button key={id} role="tab" aria-selected={play === id} className={play === id ? 'on' : ''} id={`cursorPlay-${id}`} title={label} aria-label={label} onClick={() => actions.play(id)}>
              <span className="ms">{icon}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="cursor-play-zones">
        {ZONES.map((z) => (
          <div key={z.id} className={`cursor-zone zone-${z.id}`} style={{ cursor: css(z.by[play]) }} data-cursor={z.by[play]}>
            <span className="ms">{z.icon}</span>
            <span>{z.label()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
