/* A card's name, which is also how a keyboard opens the card.
 *
 * A card opens on a click anywhere on it, and the click lives on the card's box, a div. Nothing on
 * it took keyboard focus but the star and the plus, so without a mouse there was no way to open a
 * mod's window, and with it no way to install anything (found by the accessibility walk,
 * tools/sim/scenarios/a11y.js). The box cannot simply become a button: the star and the plus sit
 * inside it, and a button may not hold other buttons.
 *
 * So the name is a button. It looks exactly like the text it replaces (.card-open in catalog.css),
 * takes the ring every focused control takes (tokens.css), and a press on it is a click that
 * reaches the card's own handler like any other. */
import type { ReactNode } from 'react';

export function CardName({ children }: { children: ReactNode }) {
  return <div className="card-name"><button type="button" className="card-open">{children}</button></div>;
}
