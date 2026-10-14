/** Network failures are route problems; HTTP and content failures already explain themselves. */
export function isNetworkDownloadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /(timeout|timed out|etimedout|dns|enotfound|getaddrinfo|econnreset|econnrefused|connection|socket|fetch failed)/i.test(message);
}
