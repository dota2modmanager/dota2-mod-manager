/* My mods: what is installed, and in the order the game loads it.
 *
 * A row here is rarely just a row. It can be a pack that folds open into its members, a cosmetic
 * pick, a font with no switch at all, or a file somebody dropped into the mods folder by hand.
 * Each draws its own row, yet all of them share one selection and one bulk bar. */
import { useCallback, useEffect, useRef } from 'react';
import { bindContextMenu } from '../ui/menu.ts';
import { bindNotice } from '../ui/notice.ts';
import { LegacyHtml } from '../catalog/screen/LegacyHtml.tsx';
import type { LibraryActions, LibraryModel } from './model.ts';
import { Banners } from './Banners.tsx';
import { BulkBar, CosmeticsHead, LibToolbar, ListHead } from './Toolbar.tsx';
import { ExternalRow, ModRow, PackRow } from './Rows.tsx';
import { useOrderDrag } from './drag.ts';
import { plural } from '../ui/format.ts';

export function LibraryScreen({ m, actions }: { m: LibraryModel; actions: LibraryActions }) {
  const bindBanner = useCallback((el: HTMLElement) => bindNotice(el, actions.noticeRead), [actions]);
  return (
    <>
      <div className="view-header"><h1 className="view-title">{L`Мои моды`}</h1></div>
      {m.noticeHtml && <LegacyHtml html={m.noticeHtml} bind={bindBanner} />}
      <Banners b={m.banners} actions={actions} />
      <LibToolbar m={m} actions={actions} />
      {m.listHead && <ListHead m={m} actions={actions} />}
      <LibList m={m} actions={actions} />
      {m.external && (
        <>
          <div className="section-h spaced"><span className="ms">folder_zip</span>{L`Внешние файлы в папке модов`}</div>
          <div className="view-intro">
            {L`Моды, положенные в папку мимо менеджера. «Принять» берёт файл к себе — с превью, переключателем и всем остальным.`}
            {m.external.dupes > 0 && (
              <>
                {' '}<b>{m.external.dupes}</b>
                {` ${plural(m.external.dupes, 'из них — копия уже установленного мода', 'из них — копии уже установленных модов', 'из них — копии уже установленных модов')}.`}
              </>
            )}
          </div>
          <div className="lib-list" id="extList">
            {m.external.rows.map((f) => <ExternalRow key={f.key} f={f} actions={actions} />)}
          </div>
        </>
      )}
      <BulkBar m={m} actions={actions} />
    </>
  );
}

function LibList({ m, actions }: { m: LibraryModel; actions: LibraryActions }) {
  const ref = useRef<HTMLDivElement>(null);
  useOrderDrag(ref, actions.reorder);
  // what a row does beyond its switch and its delete is a right-click away (views/library/menus.ts)
  const menu = useRef(actions.menu);
  menu.current = actions.menu;
  useEffect(() => {
    if (ref.current) bindContextMenu(ref.current, '.lib-row[data-row]', (row: HTMLElement) => menu.current(row.dataset.row || ''));
  }, []);
  return (
    <div className="lib-list" id="libList" ref={ref}>
      {m.empty ? <div className="empty-note">{m.empty}</div> : (
        <>
          {m.rows.map((r) => (r.kind === 'pack'
            ? <PackRow key={r.id} p={r} masterOff={m.masterOff} actions={actions} />
            : <ModRow key={r.id} r={r} masterOff={m.masterOff} actions={actions} />))}
          <CosmeticsHead m={m} actions={actions} />
          {m.cosmetics?.rows.map((r) => <ModRow key={r.id} r={r} masterOff={m.masterOff} actions={actions} />)}
        </>
      )}
    </div>
  );
}
