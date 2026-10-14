/* Errors that usually mean the download route cannot reach its host. A proxy or VPN can help
 * those failures, but it cannot fix a bad archive, a full disk or a Dota installation problem. */
export function suggestsProxy(error: string): boolean {
  return /timeout|timed out|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|ENOTFOUND|ECONNREFUSED|ECONNRESET|network|socket hang up/i.test(error);
}
