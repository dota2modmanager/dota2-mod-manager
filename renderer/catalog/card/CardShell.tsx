/* A card's outer box: a motion element for a card in the first screenful, which slides to its new
 * place and fades out when it goes, and plain markup for every card past it (ModGrid.tsx says why). */
import type { CSSProperties, MouseEvent, ReactNode, Ref } from 'react';
import { motion } from 'motion/react';
import { cardMotion } from './card-motion.ts';

interface Props {
  moves: boolean;
  installed: boolean;
  dataKey: string;
  index: number;
  onClick: (e: MouseEvent<HTMLDivElement>) => void;
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
}

export function CardShell({ moves, installed, dataKey, index, onClick, ref, children }: Props) {
  const common = {
    className: `card ${installed ? 'installed' : ''}`,
    'data-key': dataKey,
    style: { '--i': Math.min(index, 28) } as CSSProperties,
    onClick,
  };
  return moves
    ? <motion.div ref={ref} layout="position" exit={cardMotion().exit} transition={cardMotion().transition} {...common}>{children}</motion.div>
    : <div ref={ref} {...common}>{children}</div>;
}
