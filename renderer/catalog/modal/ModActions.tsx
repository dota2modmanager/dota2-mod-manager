/* What the window lets you do with what it shows.
 *
 * A tool is somebody else's program, so its window offers what you can do with a program rather
 * than with a mod: fetch it, start it, open the folder it went into, throw it away. There is no
 * switch anywhere - a tool sits in the app's own folder and the game never looks at it. */
import type { ModModalActions, ModModalModel } from './model.ts';

export function ModActions({ m, actions }: { m: ModModalModel; actions: ModModalActions }) {
  const installed = Boolean(m.installedId);
  if (m.kind === 'tool') {
    if (installed) {
      return (
        <>
          <button className="btn btn-primary" id="toolRunBtn" data-rel={m.toolRelPath} onClick={actions.runTool}>
            <span className="ms">play_arrow</span>{L`Запустить`}
          </button>
          <button className="btn" id="toolFolderBtn" data-rel={m.toolRelPath} onClick={actions.openToolFolder}>
            <span className="ms">folder_open</span>{L`Папка`}
          </button>
          <button className="btn btn-danger" id="toolDeleteBtn" onClick={actions.uninstall}>
            <span className="ms">delete</span>{L`Удалить`}
          </button>
        </>
      );
    }
    if (m.target) {
      return (
        <button className="btn btn-primary" id="installBtn" disabled={m.busy} onClick={actions.install}>
          <span className="ms">download</span>{m.busy ? L`Скачивание…` : L`Скачать`}
        </button>
      );
    }
    return m.mod.file
      ? <button className="btn" id="openLinkBtn" onClick={actions.openLink}><span className="ms">open_in_new</span>{L`Открыть сайт`}</button>
      : null;
  }
  if (m.kind === 'pack') {
    const count = m.pack?.activeCount ?? 0;
    return (
      <button className="btn btn-primary" id="installPackBtn" disabled={!count} onClick={actions.install}>
        <span className="ms">download</span>{L`Установить пак (${count})`}
      </button>
    );
  }
  if (m.target) {
    return installed
      ? <button className="btn btn-danger" id="uninstallBtn" onClick={actions.uninstall}><span className="ms">delete</span>{L`Удалить`}</button>
      : (
        <button className="btn btn-primary" id="installBtn" disabled={m.busy} onClick={actions.install}>
          <span className="ms">download</span>{m.busy ? L`Установка…` : L`Установить`}
        </button>
      );
  }
  return m.mod.file
    ? <button className="btn" id="openLinkBtn" onClick={actions.openLink}><span className="ms">open_in_new</span>{L`Открыть ссылку`}</button>
    : null;
}
