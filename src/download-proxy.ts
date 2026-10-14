// The optional HTTP/HTTPS route for app downloads, kept separate from Electron's browser session
// so catalog, archive, toolchain and update requests can share one tested transport.
import { ProxyAgent } from 'undici';

export type DownloadProxyResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

let agent: ProxyAgent | null = null;
let configured: string | null = null;

/** Validate the user-facing value without putting the address into an error message. */
export function validateDownloadProxy(value: unknown): DownloadProxyResult {
  if (typeof value !== 'string') return { ok: false, error: 'Прокси должен быть адресом' };
  const text = value.trim();
  if (!text) return { ok: true, value: null };
  if (!/^https?:\/\/(?!\/)/i.test(text)) return { ok: false, error: 'Неверный адрес прокси' };

  let url: URL;
  try { url = new URL(text); } catch { return { ok: false, error: 'Неверный адрес прокси' }; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, error: 'Прокси должен использовать HTTP или HTTPS' };
  if (!url.hostname || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    return { ok: false, error: 'Укажи прокси в формате http://host:port' };
  }
  if (url.port && (!/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535)) {
    return { ok: false, error: 'Порт прокси должен быть от 1 до 65535' };
  }
  return { ok: true, value: text };
}
export function setDownloadProxy(value: string | null): void {
  const next = value ? validateDownloadProxy(value) : { ok: true as const, value: null };
  const nextValue = next.ok ? next.value : null;
  if (nextValue === configured) return;
  closeDownloadProxy();
  configured = nextValue;
  if (configured) agent = new ProxyAgent(configured);
}

export function downloadProxyFetchInit(): { dispatcher?: ProxyAgent } {
  return agent ? { dispatcher: agent } : {};
}

export function closeDownloadProxy(): void {
  if (agent) void agent.close();
  agent = null;
  configured = null;
}

export async function testDownloadProxy(value: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<{ ok: true } | { error: string }> {
  const checked = validateDownloadProxy(value);
  if (!checked.ok) return { error: checked.error };
  if (!checked.value) return { ok: true };

  const probe = new ProxyAgent(checked.value);
  try {
    const response = await fetchImpl('https://raw.githubusercontent.com/dota2modmanager/dota2-mod-manager/main/README.md', {
      method: 'HEAD',
      signal: AbortSignal.timeout(10000),
      dispatcher: probe,
    } as unknown as RequestInit & { dispatcher?: unknown });
    if (!response.ok) return { error: 'Прокси не ответил успешно' };
    return { ok: true };
  } catch {
    return { error: 'Не удалось подключиться через прокси' };
  } finally {
    await probe.close();
  }
}
