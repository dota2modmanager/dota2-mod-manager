/* Home as React draws it (views/home.ts works out what is on it, home/model.ts holds the rules).
 *
 * Read top to bottom it goes from the app to the user: whose app this is (the name, the version,
 * the stars), where to go (a way into every section, each saying what is in it now), what is new
 * in the catalog (the pictures, and the loudest part of the screen), then what this version
 * changed beside the news and the state of the game. The name is small on purpose: it is there
 * so a screenshot says which program it is, not to sell the program to somebody already in it. */
import { motion } from 'motion/react';
import { dur, ease } from '../motion/tokens.ts';
import { ModGrid } from '../catalog/card/ModGrid.tsx';
import { shortCount, type HomeModel } from './model.ts';
import type { HomeActions } from '../views/home.ts';

const LOGO = (
  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2l7 4v8l-7 8-7-8V6z" /><path d="M12 8v6" /><path d="M9 11h6" />
  </svg>
);

function Head({ m, a }: { m: HomeModel; a: HomeActions }) {
  return (
    <header className="home-head">
      <span className="home-logo">{LOGO}</span>
      <div className="home-name">
        <h1 className="home-title">Dota 2 Mod Manager</h1>
        {m.version && <span className="home-version">{L`Версия ${m.version}`}</span>}
      </div>
      <div className="home-links">
        <button type="button" className="btn btn-ghost btn-sm" id="homeStars" onClick={() => a.open(a.links.repo)}
          title={L`Поставь звезду, если приложение тебе помогло`}>
          <span className="ms">star</span>
          {m.stars !== null ? L`${shortCount(m.stars)} на GitHub` : 'GitHub'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => a.open(a.links.discord)}>
          <span className="ms">forum</span>Discord
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => a.open(a.links.site())}>
          <span className="ms">language</span>{L`Сайт`}
        </button>
      </div>
    </header>
  );
}

function Dests({ m, a }: { m: HomeModel; a: HomeActions }) {
  return (
    <nav className="home-dests" aria-label={L`Разделы`}>
      {m.dests.map((d, i) => (
        <motion.button type="button" key={d.view} className="home-dest" data-go={d.view}
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: dur('--dur-medium'), ease: ease('--ease-out'), delay: i * 0.03 }}
          onClick={() => a.go(d.view)}>
          <span className="ms home-dest-icon" aria-hidden="true">{d.icon}</span>
          <span className="home-dest-body">
            <span className="home-dest-title">{d.title}{d.fresh && <span className="tb-new" aria-label={L`Есть новое`} />}</span>
            <span className="home-dest-line">{d.line}</span>
          </span>
        </motion.button>
      ))}
    </nav>
  );
}

export function HomeScreen({ m, a }: { m: HomeModel; a: HomeActions }) {
  return (
    <div className="home">
      <Head m={m} a={a} />
      <Dests m={m} a={a} />

      {m.recent.length > 0 && (
        <section aria-labelledby="homeRecentH">
          <div className="section-h" id="homeRecentH">
            <span className="ms">new_releases</span>{L`Новое в каталоге`}
            <button className="btn btn-ghost btn-sm section-more" id="homeRecentAll" onClick={() => void a.allRecent()}>{L`Все новые`}</button>
          </div>
          <div className="recent-row home-recent">
            <ModGrid mods={m.recent} withCat onOpen={a.openMod} onFavChanged={() => {}} listKey="home" />
          </div>
        </section>
      )}

      <div className="home-cols">
        <section className="home-panel" aria-labelledby="homeNotesH">
          <h2 className="home-panel-title" id="homeNotesH">{m.version ? L`Что нового в ${m.version}` : L`Что нового`}</h2>
          {m.notes.length
            ? <ul className="home-notes">{m.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            : <p className="home-quiet">{L`Список изменений этой версии появится с релизом.`}</p>}
          <button type="button" className="btn btn-ghost btn-sm" id="homeNotesAll" onClick={() => void a.allNotes()}>{L`Все изменения`}</button>
        </section>

        <section className="home-panel" aria-labelledby="homeNowH">
          <h2 className="home-panel-title" id="homeNowH">{L`Сейчас`}</h2>
          <ul className="home-status">
            {m.status.map((s) => (
              <li key={s.id} className={`home-status-row ${s.tone}`} data-status={s.id}>
                <span className="ms" aria-hidden="true">{s.icon}</span>
                <span className="home-status-text">{s.text}</span>
                {s.action && <button type="button" className="btn btn-sm" onClick={() => void s.action?.run()}>{s.action.label}</button>}
              </li>
            ))}
          </ul>
          {m.news.length > 0 && (
            <>
              <h3 className="home-news-title">{L`Новости`}</h3>
              <ul className="home-news">
                {m.news.map((n) => (
                  <li key={n.id} className={n.level === 'warn' ? 'warn' : ''}>
                    {n.date && <span className="home-news-date">{n.date}</span>}
                    <span>{n.text}</span>
                    {n.url && <button type="button" className="btn btn-ghost btn-sm" onClick={() => a.open(n.url || '')}>{L`Подробнее`}</button>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
