/* The window for hero picker portraits of the user's own: a picker of its own, every hero as the
 * game's grid draws him and playing his movie while pointed at. A hero clicked comes up close: his
 * card travels out of the grid to the stage (one layout id, so Motion moves the same card), the
 * grid steps back behind it, and the panel slides in on the right. The stage plays his movie as the
 * game would, the game's or the one he will have. */
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from 'motion/react';
import { dur, ease } from '../../motion/tokens.ts';
import { PickerSearch } from '../builder/parts.tsx';
import { PickerCard } from './PickerCard.tsx';
import { PortraitPanel } from './PortraitPanel.tsx';
import type { PortraitStudioActions, PortraitStudioModel } from './model.ts';

const travel = () => ({ duration: dur('--dur-slow') * 1.6, ease: ease('--ease-out') });
const fade = () => ({ duration: dur('--dur-medium'), ease: ease('--ease-standard') });

export function PortraitStudio({ m, actions }: { m: PortraitStudioModel; actions: PortraitStudioActions }) {
  const q = m.filter.trim().toLowerCase();
  const shown = q ? m.heroes.filter((h) => h.name.toLowerCase().includes(q) || h.hero.includes(q)) : m.heroes;
  const d = m.open;
  const mine = m.view === 'mine';
  return (
    <MotionConfig reducedMotion="user">
      <div className="modal-body portrait-studio">
        <div className="modal-title-row">
          <div className="modal-title">{L`Портреты героев`}</div>
          <button className="modal-close" id="modalCloseBtn" aria-label={L`Закрыть`} onClick={actions.close}><span className="ms">close</span></button>
        </div>
        <div className="modal-sub"><span>{L`Своя картинка и свой ролик героя в выборе героя. Наведи на героя, чтобы увидеть ролик из игры.`}</span></div>

        <LayoutGroup>
          <div className="portrait-stage-wrap">
            <motion.div className="portrait-grid-wrap" animate={{ opacity: d ? 0.18 : 1, scale: d ? 0.97 : 1, filter: d ? 'blur(3px)' : 'blur(0px)' }} transition={fade()}
              style={{ pointerEvents: d ? 'none' : undefined }}>
              <PickerSearch id="portraitSearch" value={m.filter} onChange={actions.filter} />
              <motion.div className="portrait-grid" id="portraitGrid" layoutScroll>
                {shown.map((h) => (
                  <div key={h.hero} className="portrait-cell" data-hero={h.hero}>
                    {d?.hero === h.hero
                      ? <div className="picker-card placeholder" />
                      : <motion.div layoutId={`portrait-${h.hero}`} transition={travel()} className="portrait-cell-card">
                        <PickerCard picture={h.picture} movie={h.movie} onHover={() => actions.hover(h.hero)} onClick={() => actions.pick(h.hero)} />
                      </motion.div>}
                    <span className="portrait-cell-name">{h.name}</span>
                    {h.own && <span className="portrait-cell-mark ms" title={L`Свой портрет стоит`}>check_circle</span>}
                  </div>
                ))}
              </motion.div>
            </motion.div>

            <AnimatePresence>
              {d && (
                <motion.div key="focus" className="portrait-focus" initial={{ opacity: 1 }} exit={{ opacity: 1 }}>
                  <div className="portrait-close-area" onClick={actions.back} />
                  <div className="portrait-stage">
                    <motion.div layoutId={`portrait-${d.hero}`} transition={travel()} className="portrait-big">
                      <PickerCard picture={mine ? d.ownPicture ?? d.gamePicture : d.gamePicture} movie={mine ? d.ownMovie ?? d.gameMovie : d.gameMovie} name={d.name} />
                    </motion.div>
                    <motion.div className="portrait-views" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={fade()}>
                      <button className={`style-btn${!mine ? ' active' : ''}`} id="portraitViewGame" onClick={() => actions.view('game')}>{L`Как в игре`}</button>
                      <button className={`style-btn${mine ? ' active' : ''}`} id="portraitViewMine" onClick={() => actions.view('mine')}>{L`Как будет`}</button>
                    </motion.div>
                  </div>
                  <PortraitPanel d={d} busy={m.busy} actions={actions} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </LayoutGroup>
      </div>
    </MotionConfig>
  );
}
