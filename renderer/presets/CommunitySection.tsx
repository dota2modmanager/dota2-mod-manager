/* The presets people published: a search, three orders, and a card per preset that shows what is
 * in it before anything is installed. Liking and publishing need a Discord sign-in; looking and
 * installing do not. The rules of the search and the orders are community.ts beside this file. */
import { useMemo, useState, type CSSProperties } from 'react';
import { PresetInside } from './PresetInside.tsx';
import { Dropdown } from '../ui/Dropdown.tsx';
import { Thumb } from '../library/Thumb.tsx';
import { rank, rating, type CommunitySort, type TableFilter } from './community.ts';
import type { CommunityModel, CommunityPreset, PresetsActions } from './model.ts';

/** Cards drawn at first; the rest a press away, so a thousand presets do not draw a thousand strips. */
const PAGE = 24;

export function CommunitySection({ c, actions }: { c: CommunityModel; actions: PresetsActions }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<CommunitySort>('top');
  const [table, setTable] = useState<TableFilter>('all');
  const [shown, setShown] = useState(PAGE);
  const list = useMemo(() => rank(c.presets, query, sort, table), [c.presets, query, sort, table]);
  const a = actions.community;
  return (
    <section className="community" id="communityPresets">
      <div className="community-head">
        <div className="group-title">{L`Пресеты сообщества`}</div>
        <span className="text-meta">{c.loading ? L`обновляется…` : `${c.presets.length}`}</span>
        <div className="community-account">
          {c.user
            // signing out is the title bar's, where the same session is shown
            ? <span className="community-user" title={c.canVote ? L`Ты вошёл через Discord: можно оценивать и публиковать` : L`Аккаунт Discord слишком новый: оценивать и публиковать можно с аккаунта старше двух недель`}>
              <span className="ms">person</span>{c.user.name}
            </span>
            : <button className="btn btn-sm" id="communitySignIn" title={L`Чтобы ставить лайки и публиковать свои пресеты. Смотреть и устанавливать можно и без входа`}
              onClick={() => { a.signIn(); }}><span className="ms">login</span>{L`Войти через Discord`}</button>}
          <button className="btn btn-ghost btn-xs" id="communityRefresh" title={L`Обновить список`} disabled={c.loading} onClick={a.refresh}>
            <span className="ms">refresh</span>
          </button>
        </div>
      </div>
      <div className="community-intro">{L`Пресеты, которые опубликовали другие игроки. Свой можно опубликовать из меню его карточки (правая кнопка мыши).`}</div>
      <div className="community-tools">
        <div className="lib-search community-search">
          <span className="ms">search</span>
          <input id="communitySearch" placeholder={L`Поиск по названию, автору или моду…`} value={query} spellCheck={false} autoComplete="off"
            onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }} />
          <button className={`lib-search-clear ${query ? 'show' : ''}`} aria-label={L`Очистить`} onClick={() => setQuery('')}>
            <span className="ms">close</span>
          </button>
        </div>
        <Dropdown id="communitySort" icon="sort" value={sort} onPick={(v) => { setSort(v as CommunitySort); setShown(PAGE); }} options={[
          { value: 'top', label: L`Лучшие по оценке` },
          { value: 'liked', label: L`Больше всего лайков` },
          { value: 'new', label: L`Новые` },
        ]} />
        <Dropdown id="communityTable" icon="table_chart" value={table} onPick={(v) => { setTable(v as TableFilter); setShown(PAGE); }} options={[
          { value: 'all', label: L`Все пресеты` },
          { value: 'files', label: L`Без items_game` },
          { value: 'table', label: L`С items_game` },
        ]} />
      </div>
      {c.error && <div className="preset-warn"><span className="ms">cloud_off</span>{c.error}</div>}
      <div className="community-list">
        {list.slice(0, shown).map((p, i) => <CommunityCard key={p.id} p={p} index={i} actions={actions} signedIn={!!c.user} canVote={c.canVote} moderator={c.moderator} />)}
      </div>
      {!list.length && (
        <div className="empty-state community-empty">
          <span className="ms">{query ? 'search_off' : 'groups'}</span>
          <div className="empty-title">{query ? L`Ничего не нашлось` : c.loading ? L`Загружаю…` : L`Пока никто ничего не опубликовал`}</div>
          {!query && !c.loading && <div className="empty-body">{L`Опубликуй свой пресет первым: правая кнопка мыши на карточке пресета → «Опубликовать в сообществе».`}</div>}
        </div>
      )}
      {list.length > shown && (
        <button className="btn community-more" onClick={() => setShown(shown + PAGE)}>
          {L`Показать ещё`} <span className="text-meta">{list.length - shown}</span>
        </button>
      )}
    </section>
  );
}

function CommunityCard({ p, index, actions, signedIn, canVote, moderator }: {
  p: CommunityPreset; index: number; actions: PresetsActions; signedIn: boolean; canVote: boolean; moderator: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const a = actions.community;
  const votes = p.up + p.down;
  // a vote needs an account; pressing without one says how to get it rather than doing nothing
  const thumbTitle = p.mine ? L`Свой пресет оценить нельзя`
    : !signedIn ? L`Войди через Discord, чтобы оценивать`
      : !canVote ? L`Аккаунт Discord слишком новый: оценивать и публиковать можно с аккаунта старше двух недель` : '';
  return (
    <div className={`preset-card community-card${p.taken === 'on' ? ' is-active' : ''}`} style={{ '--i': index } as CSSProperties} data-community={p.id}>
      <div className="preset-head">
        <div className="preset-name">{p.name}</div>
        {p.taken === 'on' && <span className="preset-on"><span className="ms">check_circle</span>{L`Выбран`}</span>}
        {p.table && <span className="lib-tag community-table" title={L`Часть видов ставится через таблицу предметов игры (items_game): нужно разрешить её изменение`}>items_game</span>}
        <span className="text-meta">{p.count}</span>
        <div className="community-votes" title={votes ? L`Рейтинг ${Math.round(rating(p.up, p.down) * 100)}% · голосов: ${votes}` : L`Ещё никто не оценил`}>
          <button className={`community-thumb${p.vote === 1 ? ' on' : ''}`} data-like={p.id} disabled={p.mine} title={thumbTitle || L`Нравится`}
            aria-pressed={p.vote === 1} onClick={() => a.vote(p.id, 1)}>
            <span className="ms">thumb_up</span><b>{p.up}</b>
          </button>
          <button className={`community-thumb down${p.vote === -1 ? ' on' : ''}`} data-dislike={p.id} disabled={p.mine} title={thumbTitle || L`Не нравится`}
            aria-pressed={p.vote === -1} onClick={() => a.vote(p.id, -1)}>
            <span className="ms">thumb_down</span><b>{p.down}</b>
          </button>
        </div>
        {p.mine
          ? <button className="btn btn-sm btn-danger" data-unpublish={p.id} onClick={() => a.unpublish(p.id)}>{L`Снять с публикации`}</button>
          : <button className={`btn btn-sm${p.taken === 'on' ? '' : ' btn-primary'}`} data-take={p.id} disabled={busy || p.taken === 'on'}
            onClick={() => { setBusy(true); a.take(p.id).finally(() => setBusy(false)); }}>
            {p.taken === 'on' ? L`Применён` : p.taken === 'own' ? L`Применить` : <><span className="ms">download</span>{L`Установить`}</>}
          </button>}
        {moderator && !p.mine && (
          <button className="btn btn-sm btn-ghost" data-hide={p.id} title={L`Скрыть пресет из «Пресетов сообщества» как модератор`} onClick={() => a.unpublish(p.id)}>
            <span className="ms">visibility_off</span>{L`Скрыть`}
          </button>
        )}
      </div>
      <div className="community-by text-meta">
        <span className="ms">person</span>{p.author || L`без имени`}{p.date && <> · {p.date}</>}{p.mine && <> · <b>{L`твой`}</b></>}
      </div>
      {p.about && <div className="preset-about">{p.about}</div>}
      <div className="preset-strip">
        {p.strip.map((thumb, i) => <Thumb key={i} thumb={thumb} cls="preset-thumb" />)}
        {p.rest > 0 && <div className="preset-more">{`+${p.rest}`}</div>}
      </div>
      <div className="preset-cats">
        {p.cats.map((c) => <span key={c.id} className="preset-cat"><span className="ms">{c.icon}</span>{c.name}<b>{c.n}</b></span>)}
      </div>
      <PresetInside inside={p.inside} />
    </div>
  );
}
