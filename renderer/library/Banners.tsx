/* The banners over My mods. This is the screen where somebody notices a mod is not in the game,
 * so this is where the reasons are said: the master switch, files waiting to be linked, the slot
 * ceiling, the item schema, another patcher, a game file that fails Dota's signature, and the
 * folders the game does or does not read (FolderBanners.tsx). */
import { useState } from 'react';
import { plural } from '../ui/format.ts';
import type { BannersModel, LibraryActions } from './model.ts';
import { Banner, BannerButton } from './Banner.tsx';
import { FolderBanners } from './FolderBanners.tsx';

/* New versions in the catalog. Nothing is downloaded until the button is pressed: an update can be
 * hundreds of megabytes, and fetching it behind somebody's back at launch is not this app's call. */
function Updates({ names, actions }: { names: string[]; actions: LibraryActions }) {
  const [busy, setBusy] = useState(false);
  const shown = names.slice(0, 3).map((n) => `«${n}»`).join(', ');
  const list = names.length > 3 ? `${shown} ${L`и ещё ${names.length - 3}`}` : shown;
  return (
    <Banner kind="info" icon="upgrade"
      action={<BannerButton id="updateAllBtn" icon="upgrade" label={names.length === 1 ? L`Обновить` : L`Обновить все`} disabled={busy}
        onClick={() => { setBusy(true); actions.banner('updateAll').finally(() => setBusy(false)); }} />}>
      <b>{names.length === 1 ? L`Вышла новая версия мода` : L`Вышли новые версии модов`}</b>
      {`: ${list}${L`. Место в порядке загрузки и включённость останутся как есть.`}`}
    </Banner>
  );
}

export function Banners({ b, actions }: { b: BannersModel; actions: LibraryActions }) {
  return (
    <>
      {b.masterOff && (
        <Banner kind="off" icon="bolt">
          <b>{L`Моды выключены`}</b>{L` мастер-переключателем внизу справа — игра запустится ванильной. Включи, чтобы менять моды по отдельности.`}
        </Banner>
      )}
      {b.matched > 0 && (
        <Banner kind="info" icon="library_add_check"
          action={<BannerButton id="adoptAllBtn" icon="library_add_check" label={L`Привязать все`} onClick={() => actions.banner('adoptAll')} />}>
          <b>{b.matched}</b>
          {` ${plural(b.matched, 'файл опознан', 'файла опознаны', 'файлов опознаны')}${L` как моды из каталога — привяжи, чтобы получить превью и управлять как обычными.`}`}
        </Banner>
      )}
      {b.updates.length > 0 && <Updates names={b.updates} actions={actions} />}
      {b.nearLimit && !b.masterOff && (
        <Banner kind="warn" icon="warning"
          action={<BannerButton id="combineHintBtn" icon="merge" label={L`Объединить`} onClick={() => actions.banner('combine')} />}>
          {`${L`Занято`} `}<b>{b.nearLimit.slots}</b>
          {L` из ${b.nearLimit.ceil} слотов. Игра не грузит больше ~99 отдельных паков — объедини моды в один, чтобы уместить больше.`}
        </Banner>
      )}
      {b.conflicts && (
        <Banner kind="warn" icon="warning">
          <b>{L`Моды спорят за один предмет`}</b>
          {`: ${b.conflicts.lists.map((mods) => `«${mods.join('» / «')}»`).join(', ')}${b.conflicts.more ? ` ${L`и ещё ${b.conflicts.more}`}` : ''}${L`. В таблицу попадёт правка того мода, что установлен последним — выключи лишний.`}`}
        </Banner>
      )}
      {b.foreign && (
        <Banner kind="warn" icon="warning">
          <b>{L`В gameinfo уже прописан другой патчер`}</b>{': '}<code>{b.foreign}</code>
          {L`. Два патчера в одном файле уживаются плохо — включай наш только если тем не пользуешься.`}
        </Banner>
      )}
      {b.vanillaBad && (
        <Banner kind="warn" icon="warning">
          <b>{L`Файл игры не совпадает с подписью Dota`}</b>
          {L`. Пока так, клиент может не пускать в матчмейкинг — и моды тут ни при чём. Приложение не смогло восстановить оригинал само: проверь целостность файлов Dota 2 через Steam, это чинит за минуту.`}
        </Banner>
      )}
      <FolderBanners b={b} actions={actions} />
    </>
  );
}
