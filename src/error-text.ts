/* What a caught error says, as one line of text.
 *
 * A catch block gets `unknown`: usually an Error, sometimes a string somebody threw, now and then
 * nothing at all. Every IPC answer and log line that reports a failure wants the same thing out of
 * it, the message when there is one and the thrown value itself when there is not.
 */

/** The error's message, or the thrown value as text when it carries none. */
export function errorText(err: unknown): string {
  return String((err as Error | null)?.message || err);
}
