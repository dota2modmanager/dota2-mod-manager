/* The catalog screen: one of the shapes model.ts names, drawn with the markup the string templates
 * wrote, so the styles, the simulation and the screenshot harness find what they always found. */
import { Fragment } from 'react';
import type { ScreenActions, ScreenModel } from './model.ts';
import { Toolbar } from './Toolbar.tsx';
import { Home } from './Home.tsx';
import { HeroGrid } from './HeroGrid.tsx';
import { CosmeticScreen } from './CosmeticScreen.tsx';
import { BuilderHub } from './BuilderHub.tsx';
import { CosmeticGrid } from '../cosmetic/CosmeticCard.tsx';
import { ModGrid } from '../card/ModGrid.tsx';

interface Props { model: ScreenModel; actions: ScreenActions }

export function Screen({ model, actions }: Props) {
  switch (model.kind) {
    case 'loading':
      return <div className="empty-note">{L`Загрузка каталога…`}</div>;
    case 'offline':
      return <Offline offline={model.offline} error={model.error} retry={actions.retry} />;
    case 'home':
      return <Home recent={model.recent} tiles={model.tiles} actions={actions} />;
    case 'heroes':
      return (
        <Fragment key={model.key}>
          <div className="view-header"><h1 className="view-title">{model.title}</h1></div>
          <Toolbar model={model.toolbar} actions={actions} />
          <HeroGrid tiles={model.tiles} actions={actions} />
        </Fragment>
      );
    case 'list':
      return <List model={model} actions={actions} key={model.key} />;
    case 'cosmetics':
      return <CosmeticScreen m={model} actions={actions} key={model.key} />;
    case 'builder':
      return <BuilderHub m={model} actions={actions} />;
  }
}

function List({ model: m, actions }: { model: Extract<ScreenModel, { kind: 'list' }>; actions: ScreenActions }) {
  return (
    <>
      <div className="view-header">
        {m.back && (
          <button className="btn btn-ghost btn-sm hero-back" id="heroBack" onClick={actions.allHeroes}>
            <span className="ms">arrow_back</span>{L`Все герои`}
          </button>
        )}
        <h1 className="view-title">{m.title}{m.accent !== undefined && <> <span className="accent">{m.accent}</span></>}</h1>
      </div>
      {m.toolbar && <Toolbar model={m.toolbar} actions={actions} />}
      {m.note && <div className="empty-note">{m.note}</div>}
      {m.mods && (
        <>
          {m.mods.heading && <div className="section-h"><span className="ms">extension</span>{L`Моды`}</div>}
          <div className="grid" id="modGrid">
            <ModGrid mods={m.mods.mods} grouped={m.mods.grouped} withCat={m.mods.withCat} emptyText={m.mods.emptyText}
              onOpen={actions.openMod} onFavChanged={actions.favChanged} />
          </div>
        </>
      )}
      {m.cosmetics && (
        <>
          <div className="section-h spaced"><span className="ms">auto_awesome</span>{L`Косметика`}</div>
          <div className="grid" id="cosGrid">
            <CosmeticGrid items={m.cosmetics.items} emptyText={m.cosmetics.emptyText}
              onOpen={actions.openCosmetic} onFavChanged={actions.cosmeticFavChanged} />
          </div>
          {m.cosmetics.more && <div className="search-more">{m.cosmetics.more}</div>}
        </>
      )}
    </>
  );
}

/* Two failures that need different sentences. Not being able to open a socket is the wifi off or
 * the route to the catalog blocked; anything else is a server that answered with something, and
 * telling that person to check their connection sends them to fix what is not broken. Either way
 * the mods already installed still work, which is the part worth saying on an empty screen. */
function Offline({ offline, error, retry }: { offline: boolean; error: string; retry: () => void }) {
  return (
    <div className="empty-note offline-note">
      <span className="ms offline-icon">{offline ? 'wifi_off' : 'cloud_off'}</span>
      <b>{offline ? L`Нет соединения с интернетом` : L`Каталог сейчас недоступен`}</b>
      <span>{offline
        ? L`Моды, которые уже стоят, работают. Каталог появится, как только связь вернётся.`
        : L`Моды, которые уже стоят, работают. Попробуй ещё раз через минуту.`}</span>
      <button className="btn btn-primary" id="retryCat" onClick={retry}>{L`Повторить`}</button>
      <span className="offline-detail">{error}</span>
    </div>
  );
}
