/* The Workshop as React draws it (views/studio.ts works out what is on it).
 *
 * Groups by what in the game a tool changes, because that is the question somebody arrives with:
 * "can I change the map", not "which tools are there". Inside a group a tile is a row of three
 * things that each answer one question: what it is (the name), what it does (one line), and what
 * is on now (the green status, the same colour "installed" has everywhere in the app). */
import { motion } from 'motion/react';
import { dur, ease } from '../motion/tokens.ts';
import { isCutOut, useTrimmed } from '../catalog/arcana/tint.ts';

export interface StudioTile {
  id: string;
  icon: string;
  title: string;
  text: string;
  /** a picture out of the game, where the tool has one (an arcana) */
  picture?: string | null;
  /** what is on now */
  status?: { text: string; on: boolean };
  /** not opened yet on this machine */
  fresh: boolean;
  /** leaves the app for the site */
  external?: boolean;
  open: (from: HTMLElement) => unknown;
}

export interface StudioGroup { id: string; title: string; tiles: StudioTile[] }

/** An arcana's picture cut to its figure, so a set's tall art stands whole in the middle of the square. */
function Picture({ src }: { src: string }) {
  const cut = useTrimmed(src);
  return <img src={cut || src} className={cut && isCutOut(cut) ? 'cutout' : undefined} alt="" draggable={false} />;
}

function Tile({ t, i, onOpen }: { t: StudioTile; i: number; onOpen: (t: StudioTile, el: HTMLElement) => void }) {
  return (
    <motion.button type="button" className={`studio-tile${t.status?.on ? ' is-on' : ''}`} data-tool={t.id}
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: dur('--dur-medium'), ease: ease('--ease-out'), delay: Math.min(i, 12) * 0.025 }}
      onClick={(e) => onOpen(t, e.currentTarget)}>
      <span className="studio-glyph" aria-hidden="true">
        {t.picture ? <Picture src={t.picture} /> : <span className="ms">{t.icon}</span>}
      </span>
      <span className="studio-body">
        <span className={`studio-name${t.fresh ? ' has-new' : ''}`}>
          {t.title}
          {t.external && <span className="ms studio-ext" aria-label={L`Откроется на сайте`}>open_in_new</span>}
        </span>
        <span className="studio-text">{t.text}</span>
        {t.status && <span className="studio-status">{t.status.text}</span>}
      </span>
      {t.fresh && <span className="studio-new">{L`Новое`}</span>}
    </motion.button>
  );
}

export function StudioScreen({ groups, onOpen }: { groups: StudioGroup[]; onOpen: (t: StudioTile, el: HTMLElement) => void }) {
  let i = 0;
  return (
    <div className="studio">
      <header className="view-header studio-head">
        <h1 className="view-title">{L`Мастерская`}</h1>
        <p className="studio-lede">{L`Всё, что приложение собирает из файлов твоей игры: никаких скачиваний, только твоя Dota в другом виде.`}</p>
      </header>
      {groups.filter((g) => g.tiles.length).map((g) => (
        <section className="studio-group" key={g.id} aria-labelledby={`studio-${g.id}`}>
          <h2 className="studio-group-title" id={`studio-${g.id}`}>{g.title}</h2>
          <div className="studio-grid">
            {g.tiles.map((t) => <Tile key={t.id} t={t} i={i++} onOpen={onOpen} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
