/* Where the game looks, said on the screen where somebody notices a mod is not in the game. They
 * used to be in Settings, under a heading about a folder nobody is asked to choose any more.
 *
 * Dota mounts one language folder: the one the voice language names, or whatever `-language` in
 * Steam's launch options says. Minify is a neighbour to be exact about, never guessed at: each of
 * its cases says only what is known and the fix that belongs to it (src/minify.js,
 * core/minify-notice.js). And after a Dota patch: done, waiting for the game to close, or failed. */
import { useState } from 'react';
import { plural } from '../ui/format.js';
import type { BannersModel, LibraryActions } from './model.ts';
import { Banner, BannerButton } from './Banner.tsx';

type Minify = NonNullable<BannersModel['minify']>;

function minifyBody(m: Minify) {
  const one = L`Dota монтирует ровно одну языковую папку.`;
  const ourMods = m.ourMods;
  switch (m.case) {
    // installed, but building into a folder this version of the game cannot be pointed at
    case 'unmountable':
      return <><b>{L`Рядом установлен Minify`}</b>{L`. Он собирает в dota_${m.folder}, а ${one} Папку с таким именем игра не читает — его моды сейчас не грузятся, и на наши это не влияет. В свежих версиях Minify это решено переходом на голландский.`}</>;
    // it holds the folder the game reads, so ours are the ones sitting dark
    case 'minify-live':
      return <><b>{L`Игра читает моды Minify из dota_${m.mounted}`}</b>{L`, а наши ${ourMods} лежат в dota_${m.ourFolder} и сейчас не грузятся. ${one} Какую именно — решает параметр запуска Dota, и сейчас он указывает на папку Minify.`}</>;
    case 'shared':
      return <><b>{L`Minify рядом, и обе программы работают`}</b>{L`: моды в одной папке dota_${m.mounted}, а слоты ${m.reservedLabel || 'pak65-67'}, куда он пишет, мы не занимаем.`}</>;
    // the game reads our folder, whether or not anything of ours is in it yet
    case 'ours-read':
      return <><b>{L`Рядом установлен Minify`}</b>{L`. Игра читает dota_${m.ourFolder}, куда ставятся наши моды. Minify собирает в dota_${m.folder}, поэтому его моды сейчас не грузятся. ${one}`}</>;
    // the game reads Minify's folder, and there is nothing in it
    case 'minify-empty':
      return (
        <>
          <b>{L`Игра читает папку Minify dota_${m.mounted}, а она пуста`}</b>
          {ourMods > 0
            ? L`. Наши ${ourMods} лежат в dota_${m.ourFolder} и сейчас не грузятся. ${one} Какую читать, решает параметр запуска Dota.`
            : L`. Наши моды ставятся в dota_${m.ourFolder}. ${one} Какую читать, решает параметр запуска Dota.`}
        </>
      );
    // the game reads a folder neither of us filled
    case 'elsewhere':
      return <><b>{L`Игра читает dota_${m.mounted}, а там нет ни наших модов, ни модов Minify`}</b>{L`. Наши ставятся в dota_${m.ourFolder}, Minify собирает в dota_${m.folder}. ${one}`}</>;
    // which folder the game reads is not known yet: only what is
    default:
      return <><b>{L`Рядом установлен Minify`}</b>{L`. Он собирает в dota_${m.folder}, наши моды ставятся в dota_${m.ourFolder}. ${one}`}</>;
  }
}

/* A -language in Steam's launch options overrules everything this app does: Dota takes both
 * language settings from it and mounts the folder it names. Worth saying even when it names our
 * folder, since it takes the choice of text language away and breaks the day either side changes. */
function LaunchLang({ lang, followed }: { lang: string; followed: boolean }) {
  return followed
    ? (
      <Banner kind="info" icon="info">
        <b>{L`В параметрах запуска Dota стоит -language ${lang}`}</b>{L`, поэтому игра читает папку dota_${lang} — туда приложение моды и ставит. Уберёшь параметр, и они переедут обратно сами.`}
      </Banner>
    ) : (
      <Banner kind="warn" icon="warning">
        <b>{L`В параметрах запуска Dota стоит -language ${lang}`}</b>{L`. Такого языка у Доты нет, папку по нему она не смонтирует, а язык текста он всё равно заберёт. Убери его: Steam → Dota 2 → Свойства → Параметры запуска.`}
      </Banner>
    );
}

function Repair({ b, actions }: { b: BannersModel; actions: LibraryActions }) {
  const [busy, setBusy] = useState(false);
  const r = b.repair;
  const again = (label: string) => (
    <BannerButton id="repairNowBtn" icon="refresh" label={label} disabled={busy} onClick={() => { setBusy(true); actions.banner('repairNow').finally(() => setBusy(false)); }} />
  );
  if (r.state === 'waiting') {
    return (
      <Banner kind="warn" icon="update" action={again(L`Я закрыл, повтори`)}>
        <b>{L`Dota обновилась, пока игра запущена`}</b>{L`. Моды в этой сессии не работают: файлы игры заняты. Закрой Dota — приложение вернёт всё само.`}
      </Banner>
    );
  }
  if (r.state === 'failed') {
    return (
      <Banner kind="warn" icon="warning" action={again(L`Повторить`)}>
        <b>{L`Dota обновилась, вернуть моды не вышло`}</b>{r.error && <>{': '}<code>{r.error}</code></>}
        {L`. Закрой Dota и нажми «Повторить» — почти всегда дело в том, что игра держит файлы.`}
      </Banner>
    );
  }
  if (r.state === 'done') {
    const what = (r.healed || []).length ? L`, моды и настройки вернули на место` : L`, менять ничего не пришлось`;
    return (
      <Banner kind="info" icon="update" action={<BannerButton id="repairSeenBtn" label={L`Понятно`} ghost onClick={() => actions.banner('repairSeen')} />}>
        <b>{L`Dota обновилась`}</b>{`${what}${L`. Можно играть.`}`}
      </Banner>
    );
  }
  return null;
}

export function FolderBanners({ b, actions }: { b: BannersModel; actions: LibraryActions }) {
  const [reinstalling, setReinstalling] = useState(false);
  return (
    <>
      {b.mounted && (
        <Banner kind="warn" icon="warning">
          <b>{L`Dota сейчас берёт файлы из папки dota_${b.mounted.mounted}`}</b>{L`, а моды ставятся в dota_${b.mounted.folder}. Закрой Dota и перезапусти менеджер — он переключит игру сам.`}
        </Banner>
      )}
      {b.stranded.map((f) => (
        <Banner key={f.suffix} kind="warn" icon="warning"
          action={<button className="btn btn-sm btn-primary" data-move-from={f.suffix} onClick={() => actions.banner('moveFrom', f.suffix)}>
            <span className="ms">drive_file_move</span>{L`Перенести сюда`}
          </button>}>
          <b>{L`В папке dota_${f.suffix} лежат ${f.modFiles} ${plural(f.modFiles, 'мод', 'мода', 'модов')}`}</b>{L`, которые игра не видит.`}
        </Banner>
      ))}
      {b.launchLang && <LaunchLang lang={b.launchLang.lang} followed={b.launchLang.followed} />}
      {b.minify && (
        <Banner kind={b.minify.kind} icon={b.minify.kind === 'warn' ? 'warning' : 'handshake'}>{minifyBody(b.minify)}</Banner>
      )}
      {/* Minify 1.14rc7 puts its own command in front of the game in Steam's launch options. This app
          is nowhere in that path, but it is the app people have open when nothing starts. */}
      {b.prelaunch && (
        <Banner kind="info" icon="info">
          <b>{L`Steam запускает Minify перед Dota`}</b>{L`: в параметрах запуска стоит его команда prelaunch. Это его настройка «Run patches upon launch», включённая по умолчанию с версии 1.14rc7 — игра стартует после того, как патч отработает. Если Dota перестала запускаться, выключи эту галочку в настройках Minify.`}
        </Banner>
      )}
      {/* the archive is gone from the cache, so putting these back means fetching them again,
          which is why it waits for a press instead of happening at launch */}
      {b.stuck.length > 0 && (
        <Banner kind="warn" icon="warning"
          action={<BannerButton id="reinstallStuckBtn" icon="download" label={L`Поставить заново`} disabled={reinstalling}
            onClick={() => { setReinstalling(true); actions.banner('reinstallStuck').finally(() => setReinstalling(false)); }} />}>
          <b>{L`Проверка файлов Steam вернула оригиналы игры`}</b>{L`: ${b.stuck.join(', ')}. Архива для установки уже нет — скачать заново?`}
        </Banner>
      )}
      <Repair b={b} actions={actions} />
    </>
  );
}
