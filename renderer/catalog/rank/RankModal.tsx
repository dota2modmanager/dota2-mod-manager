/* The window for the rank medal and hero levels of the player's own screen: a medal (or the
 * player's own), then a level from 1 to 30 for every hero or for some, each with the badge tier it
 * earns, then the build. The pictures are the game's own (src/rank-look-service.ts). The mod
 * window's markup and classes (.modal-body, .style-btn), so it reads as one of them. */
import type { RankLook, RankMedal } from '../../api/content.ts';

export interface RankModalModel {
  look: RankLook;
  /** a look is on now */
  installed: boolean;
  heroes: { id: string; name: string }[];
  portraits: Record<string, string>;
  /** the medals by picture name, and the six badge tiers, as data URIs; empty until they are read */
  medals: Record<string, string>;
  badges: string[];
  filter: string;
  /** ValveResourceFormat is downloaded */
  vrf: boolean;
  busy: 'tool' | 'build' | null;
}

export interface RankModalActions {
  close: () => void;
  medal: (m: RankMedal | null) => void;
  every: (n: number | null) => void;
  level: (hero: string, n: number | null) => void;
  filter: (s: string) => void;
  getTool: () => void;
  install: () => void;
}

/** The game's own names of the tiers, for the label under each medal: by language, since "Герой" is also a hero. */
const TIERS: Record<string, string[]> = {
  ru: ['Без ранга', 'Рекрут', 'Страж', 'Рыцарь', 'Герой', 'Легенда', 'Властелин', 'Божество', 'Титан'],
  en: ['Uncalibrated', 'Herald', 'Guardian', 'Crusader', 'Archon', 'Legend', 'Ancient', 'Divine', 'Immortal'],
  'zh-CN': ['未校准', '先锋', '卫士', '中军', '统帅', '传奇', '万古流芳', '超凡入圣', '冠绝一世'],
};
const TIER_NAMES = () => TIERS[window.I18N_LANG] ?? TIERS.en;
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
const TOPS = { 5000: 'a', 100: 'b', 10: 'c' } as const;
/** The first level of each badge tier, as src/rank-look.ts TIER_FROM has them (#549). */
const TIER_FROM = [1, 6, 12, 18, 25, 30];
const tierOf = (level: number) => Math.max(0, TIER_FROM.filter((from) => level >= from).length - 1);
const picture = (m: RankMedal) => (m.tier === 8 && m.top ? `rank8${TOPS[m.top]}` : `rank${m.tier}`);

function Badge({ m, level }: { m: RankModalModel; level: number | null }) {
  const src = level !== null ? m.badges[tierOf(level)] : '';
  return <span className="rank-badge">{src && <img src={src} alt="" />}<b>{level ?? '-'}</b></span>;
}

export function RankModal({ m, actions }: { m: RankModalModel; actions: RankModalActions }) {
  const names = TIER_NAMES();
  const med = m.look.medal;
  const q = m.filter.trim().toLowerCase();
  const shown = q ? m.heroes.filter((h) => h.name.toLowerCase().includes(q) || h.id.includes(q)) : m.heroes;
  const pick = (tier: number) => actions.medal({ tier, stars: med?.stars ?? 1, top: 0 });
  return (
    <div className="modal-body rank-look">
      <div className="modal-title-row">
        <div className="modal-title">{L`Свой ранг и уровни героев`}</div>
        <button className="modal-close" id="modalCloseBtn" aria-label={L`Закрыть`} onClick={actions.close}>
          <span className="ms">close</span>
        </button>
      </div>
      <div className="modal-sub"><span>{L`Медаль и уровни Dota Plus, которые видишь только ты`}</span></div>

      <div className="map-side">
        <div className="map-side-label">{L`Медаль`}</div>
        <div className="rank-medals" id="rankMedals">
          <button className={`rank-medal ${med ? '' : 'active'}`} aria-pressed={!med} onClick={() => actions.medal(null)}>
            <span className="ms">person</span><span>{L`Моя`}</span>
          </button>
          {names.map((name, tier) => {
            const on = med?.tier === tier;
            const src = m.medals[on ? picture(med) : `rank${tier}`];
            return (
              <button key={tier} className={`rank-medal ${on ? 'active' : ''}`} aria-pressed={on} title={name} onClick={() => pick(tier)}>
                {src ? <img src={src} alt="" /> : <span className="ms">military_tech</span>}
                <span>{name}</span>
              </button>
            );
          })}
        </div>
        {med && med.tier >= 1 && med.tier <= 7 && (
          <div className="style-row" id="rankStars">
            {ROMAN.map((r, i) => (
              <button key={r} className={`style-btn ${med.stars === i + 1 ? 'active' : ''}`} onClick={() => actions.medal({ ...med, stars: i + 1 })}>{names[med.tier]} {r}</button>
            ))}
          </div>
        )}
        {med?.tier === 8 && (
          <div className="style-row" id="rankTop">
            {([0, 5000, 100, 10] as const).map((top) => (
              <button key={top} className={`style-btn ${med.top === top ? 'active' : ''}`} onClick={() => actions.medal({ ...med, top })}>
                {top ? L`Топ ${top}` : names[8]}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="map-side">
        <div className="map-side-label">{L`Уровни героев`}</div>
        <label className="sound-volume rank-every">
          <span>{L`Всем героям`} <Badge m={m} level={m.look.every} /> {m.look.every === null ? L`как в игре` : ''}</span>
          <input type="range" className="scale-range" id="rankEvery" min={0} max={30} step={1} value={m.look.every ?? 0}
            onChange={(e) => actions.every(Number(e.currentTarget.value) || null)} />
        </label>
        <input className="input" id="rankFilter" placeholder={L`Найти героя`} value={m.filter} onChange={(e) => actions.filter(e.currentTarget.value)} />
        <div className="rank-heroes">
          {shown.map((h) => {
            const own = m.look.levels[h.id];
            return (
              <div className={`rank-hero ${own ? 'set' : ''}`} key={h.id}>
                {m.portraits[h.id] ? <img className="rank-portrait" src={m.portraits[h.id]} alt="" /> : <span className="rank-portrait" />}
                <span className="rank-hero-name" title={h.name}>{h.name}</span>
                <Badge m={m} level={own ?? m.look.every} />
                <input className="input rank-level" type="number" min={1} max={30} aria-label={L`Уровень: ${h.name}`} placeholder={m.look.every ? String(m.look.every) : '-'}
                  value={own ?? ''} onChange={(e) => {
                    const n = Math.round(Number(e.currentTarget.value));
                    actions.level(h.id, e.currentTarget.value === '' || !n ? null : Math.min(30, Math.max(1, n)));
                  }} />
              </div>
            );
          })}
          {!shown.length && <div className="share-hint">{L`Ничего не нашлось`}</div>}
        </div>
      </div>

      <div className="modal-actions">
        {!m.vrf
          ? <button className="btn btn-primary" id="rankToolBtn" disabled={m.busy !== null} onClick={actions.getTool}>
            <span className="ms">{m.busy === 'tool' ? 'progress_activity' : 'download'}</span>{L`Скачать ValveResourceFormat`}
          </button>
          : m.busy === 'build'
            ? <button className="btn btn-primary" disabled><span className="ms">progress_activity</span>{L`Собираю…`}</button>
            : <button className="btn btn-primary" id="rankInstallBtn" onClick={actions.install}>
              <span className="ms">download</span>{m.installed ? L`Обновить` : L`Поставить`}
            </button>}
      </div>

      <div className="modal-note">
        {L`Другие игроки видят твою настоящую медаль и уровни. Выбранная медаль у тебя на экране стоит у всех игроков. После обновления Доты приложение соберёт всё заново само.`}
      </div>
    </div>
  );
}
