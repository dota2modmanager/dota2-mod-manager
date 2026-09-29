/**
 * Whether this run of the app is the uninstaller asking what to take along.
 *
 * The uninstaller runs the app once with `--uninstall`, puts its questions on screen and reads
 * the exit code for the answer. An update runs the *old* uninstaller too, so the same flag
 * arrives on a run where nobody is removing anything and nothing may be removed.
 *
 * That went wrong once, in front of everybody: 2.6.1 opened the removal window in the middle of
 * a routine update, with boxes ticked. This is the app's half of the pair of locks that stops it
 * coming back; the other half is in build/installer.nsh, which never starts the app at all on
 * those command lines. Two cheap checks beat one clever one, and they are cheap only while they
 * agree, so a test holds this list to the flags that script tests for.
 *
 * It lives in its own file rather than inline in main.js so it can be called with a command line
 * instead of the one this process happens to have been given.
 */

/**
 * Command-line flags that mean "this is not a person removing the program".
 *
 * `--updated` is the one that says it outright. `/KEEP_APP_DATA` arrives with it and says the
 * data is staying, which a removal never does. `/S` means "no interface", and a window asking
 * questions is an interface, so it belongs here on its own account.
 *
 * `${Silent}` is deliberately not among them: the one-click uninstaller turns silent mode on
 * itself the moment the person confirms, so by the time anything runs it is on either way. Only
 * the command line tells an update from a removal. Windows' own uninstall entry passes no
 * arguments at all, which is exactly when the questions should be asked.
 */
export const UPDATE_FLAGS: readonly string[] = ['--updated', '/KEEP_APP_DATA', '/S'];

/** A flag matches whole and regardless of case; a path that merely contains the text does not. */
const flagged = (argv: readonly unknown[], flags: readonly string[]): boolean => argv.some((arg) => {
  const a = String(arg).toLowerCase();
  return flags.some((f) => f.toLowerCase() === a);
});

/** electron-builder replacing a version, wearing the uninstaller's clothes. */
export const isUpdateRun = (argv: readonly unknown[] = []): boolean => flagged(argv, UPDATE_FLAGS);

/** A person removing the program, which is the only case the window may open in. */
export const isUninstallRun = (argv: readonly unknown[] = []): boolean => argv.includes('--uninstall') && !isUpdateRun(argv);
