/* The window the uninstaller opens on its way out.
 *
 * Removing the app leaves three things behind that only the app knows how to undo: its edit
 * to the game's own files, the mods sitting in the game's language folder, and its folder of
 * settings, caches and the downloaded toolchain. Each one is a question rather than a
 * decision made on somebody's behalf, and each says how much it is talking about, because
 * "delete all data" means nothing until you know it is 340 MB of pictures.
 *
 * Nothing here reaches the network or the rest of the app: see preload-uninstall.js.
 */
'use strict';

const $ = (sel) => document.querySelector(sel);
const MB = (bytes) => (bytes / 1048576).toFixed(bytes > 10485760 ? 0 : 1);

/** One question, drawn the same way whatever it is about. */
function optionHtml({ id, checked, title, note }) {
  return `
    <label class="uninstall-opt">
      <input type="checkbox" id="${id}"${checked ? ' checked' : ''}>
      <span class="uninstall-opt-body">
        <b>${title}</b>
        <small>${note}</small>
      </span>
    </label>`;
}

async function main() {
  let plan;
  try {
    plan = await window.uninstall.plan();
  } catch {
    // Nothing could be read, so there is nothing this window can honestly offer. Let the
    // uninstaller get on with removing the program.
    window.uninstall.done();
    return;
  }
  // the language the app was being used in, not whatever this window happens to boot with
  window.I18N_LANG = plan.lang === 'ru' || plan.lang === 'zh-CN' ? plan.lang : 'en';
  document.documentElement.lang = window.I18N_LANG;

  $('#title').textContent = L`Удалить Dota 2 Mod Manager`;
  $('#sub').textContent = L`Программа будет удалена. Отметь, что забрать вместе с ней.`;
  $('#cancelBtn').textContent = L`Отмена`;
  $('#okBtn').textContent = L`Удалить`;

  const opts = [];
  // Only worth asking when there is an edit to undo. Left first and checked, because a game
  // left carrying our change with no app to undo it is the one outcome nobody can fix later.
  if (plan.patched) {
    opts.push({
      id: 'optRevert',
      checked: true,
      title: L`Вернуть файлы игры как были`,
      note: L`Безопасный режим сейчас выключен. gameinfo и подписи вернутся байт в байт, без следов.`,
    });
  }
  /* Off by default, both of them. Ticking "delete 276 MB of mods" for somebody is the app
   * making a decision that is theirs, and it is the decision that cannot be undone. Putting
   * the game back is different and stays on: a game left carrying our edit with the one
   * program that can undo it now gone is the outcome nobody can fix afterwards. */
  opts.push({
    id: 'optMods',
    checked: false,
    title: L`Удалить установленные моды`,
    note: plan.mods
      ? L`${plan.mods} шт., ${MB(plan.modBytes)} МБ в папке игры. Иначе останутся лежать там, и управлять ими будет нечем.`
      : L`Модов не установлено.`,
  });
  opts.push({
    id: 'optData',
    checked: false,
    title: L`Удалить данные приложения`,
    note: L`Настройки, библиотека, кэш картинок и скачанные инструменты — ${MB(plan.dataBytes)} МБ.`,
  });
  $('#opts').innerHTML = opts.map(optionHtml).join('');

  const boxes = () => ({
    revert: !!$('#optRevert')?.checked,
    mods: !!$('#optMods')?.checked,
    data: !!$('#optData')?.checked,
  });
  const paintNote = () => {
    const b = boxes();
    $('#note').textContent = (b.revert || b.mods || b.data)
      ? ''
      : L`Ничего не отмечено — будет удалена только сама программа.`;
  };
  $('#opts').addEventListener('change', paintNote);
  paintNote();

  $('#cancelBtn').addEventListener('click', () => window.uninstall.cancel());
  $('#okBtn').addEventListener('click', async () => {
    $('#okBtn').disabled = true;
    $('#cancelBtn').disabled = true;
    $('#okBtn').textContent = L`Удаляю…`;
    const b = boxes();
    const r = await window.uninstall.run(b);
    // What could not be removed is said plainly and then let go: the uninstaller takes the
    // program either way, and a window that refuses to close is worse than a leftover file.
    if (r?.errors?.length) {
      $('#note').textContent = L`Не удалось убрать ${r.errors.length}: ${r.errors.slice(0, 2).join('; ')}`;
      $('#okBtn').textContent = L`Продолжить`;
      $('#okBtn').disabled = false;
      $('#okBtn').onclick = () => window.uninstall.done(b.data);
      return;
    }
    // the app's own folder is taken by the uninstaller a moment from now, not from in here
    window.uninstall.done(b.data);
  });
}

main();
