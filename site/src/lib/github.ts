/* What the build sends to GitHub's API. A runner shares its address with many others, and without a
 * token that address gets 60 requests an hour: on 2026-11-05 the releases came back refused, the
 * changelog lost every date, and the page's test stopped the deploy. site.yml passes the job's token. */
export function githubHeaders(): Record<string, string> {
  const token = process.env.GH_TOKEN;
  return { 'User-Agent': 'dota2modmanager-site', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}
