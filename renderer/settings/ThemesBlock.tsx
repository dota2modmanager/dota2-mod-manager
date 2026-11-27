/* "Темы" in Settings: every theme the window can wear, as a card drawn in its own colours, and the
 * user's theme from a file. Until now the only way to a theme was clicking the mascot round all of
 * them; the mascot still does that, and the cards follow it (ui/theme.ts sends `mm-theme`).
 *
 * A card is drawn in its theme by carrying `data-theme` itself: the palettes in styles/themes.css
 * are attribute rules, not rules on <html>, so the --md-* roles under the card are that theme's
 * while everything around it keeps the window's. The user's own theme is not in the stylesheet
 * until it is worn, so its card gets its colours inline. */
import { useEffect, useState, type CSSProperties } from 'react';
import { Row } from './parts.tsx';
import { currentTheme, secretLook, themeChoices, wearCustom, wearTheme } from '../ui/theme.ts';
import { customTheme, dropTheme, loadTheme, saveTheme } from '../ui/theme-menu.ts';
import { CUSTOM, SECRET, themeName } from '../ui/theme-list.ts';

function ThemeCard({ id, on }: { id: string; on: boolean }) {
  const mine = id === CUSTOM ? customTheme() : null;
  const look = id === SECRET ? secretLook() : id;
  const style = mine
    ? Object.fromEntries(Object.entries(mine.colors).map(([role, hex]) => [`--md-${role}`, hex])) as CSSProperties
    : undefined;
  const name = mine ? mine.name : themeName(id);
  return (
    <button type="button" role="radio" aria-checked={on} className={`theme-card${on ? ' on' : ''}`}
      data-theme={mine ? undefined : look} data-hue={look === 'rainbow' ? 'ursa' : undefined}
      style={style} title={name} onClick={() => wearTheme(id)}>
      <span className="theme-look" aria-hidden="true">
        <span className="tl-bar" />
        <span className="tl-body">
          <span className="tl-side"><i /><i /><i /></span>
          <span className="tl-main">
            <span className="tl-tile" /><span className="tl-tile" />
            <span className="tl-btn" />
          </span>
        </span>
      </span>
      <span className="theme-name">
        <span className="theme-dots" aria-hidden="true"><i /><i /><i /></span>
        <span className="grow">{name}</span>
        {on && <span className="ms" aria-hidden="true">check_circle</span>}
      </span>
    </button>
  );
}

export function ThemesRows() {
  const [current, setCurrent] = useState(currentTheme);
  // a file loaded or dropped changes the list without changing what is worn
  const [, redraw] = useState(0);
  useEffect(() => {
    const follow = (e: Event) => setCurrent((e as CustomEvent<string>).detail);
    document.addEventListener('mm-theme', follow);
    return () => document.removeEventListener('mm-theme', follow);
  }, []);
  const list = themeChoices();
  const mine = customTheme();
  const isCustom = current === CUSTOM;
  return (
    <>
      <Row wide label={L`Тема окна`} hint={L`Цвета всего приложения. Маскот в заголовке тоже переключает их по кругу.`}>
        <div className="theme-grid" role="radiogroup" aria-label={L`Тема окна`}>
          {list.map((id) => <ThemeCard key={id} id={id} on={id === current} />)}
        </div>
      </Row>
      <Row label={L`Своя тема из файла`}
        hint={mine ? L`Загружена «${mine.name}».` : L`JSON с цветами и, если хочешь, картинкой фона.`}
        more={L`Начать проще всего с готовой: надень похожую тему, нажми «Сохранить в файл», поменяй цвета в JSON и загрузи обратно. Тема с нечитаемым текстом не загрузится, приложение скажет почему.`}>
        <button className="btn btn-sm" id="themeLoadBtn" onClick={() => { void loadTheme(wearCustom).then(() => redraw((n) => n + 1)); }}>
          <span className="ms">upload_file</span>{L`Загрузить…`}
        </button>
        <button className="btn btn-sm" id="themeSaveBtn" onClick={() => saveTheme(isCustom)}>
          <span className="ms">download</span>{L`Сохранить в файл`}
        </button>
        {mine && (
          <button className="btn btn-sm" id="themeDropBtn" onClick={() => { dropTheme(isCustom, wearCustom); redraw((n) => n + 1); }}>
            <span className="ms">delete</span>{L`Убрать`}
          </button>
        )}
      </Row>
    </>
  );
}
