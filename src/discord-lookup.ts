export const DEFAULT_DISCORD_LOOKUP_ENDPOINT = "https://discord-lookup.lookupbotdc.workers.dev/search/";
export const DISCORD_ID = /^\d{15,20}$/;
export const CREDIT_NAME_OVERRIDES: Readonly<Record<string, string>> = { "622852916092469278": "Arashii" };

export type DiscordIdentity = { id: string; username: string; avatarUrl?: string };
const cache = new Map<string, { until: number; value: DiscordIdentity | null }>();
const pending = new Map<string, Promise<DiscordIdentity | null>>();
const pausedUntil = new Map<string, number>();
const FOUND_MS = 5 * 60_000;
const FAILED_MS = 30_000;

export function discordLookupUrl(endpoint: string, id: string): string | null {
  if (!DISCORD_ID.test(id)) return null;
  try {
    const url = new URL(endpoint.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    url.pathname = `${url.pathname.replace(/\/$/, "")}/${id}`;
    return url.href;
  } catch { return null; }
}

export function safeAvatarUrl(value: unknown, id?: string): string | undefined {
  if (typeof value !== "string" || !value.trim()) return;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password) return url.href;
  } catch {
    if (id && DISCORD_ID.test(id) && /^(?:a_)?[a-f0-9]{16,64}$/i.test(value)) {
      return `https://cdn.discordapp.com/avatars/${id}/${value}.webp?size=64`;
    }
  }
}

export function lookupDiscordUser(id: string, endpoint = DEFAULT_DISCORD_LOOKUP_ENDPOINT): Promise<DiscordIdentity | null> {
  const url = discordLookupUrl(endpoint, id);
  if (!url) return Promise.resolve(null);
  const hit = cache.get(url);
  if (hit && hit.until > Date.now()) return Promise.resolve(hit.value);
  const active = pending.get(url);
  if (active) return active;
  if ((pausedUntil.get(endpoint) ?? 0) > Date.now()) return Promise.resolve(null);

  const request = fetchIdentity(url, endpoint, id).then(value => {
    if (cache.size >= 512) {
      for (const [key, entry] of cache) if (entry.until <= Date.now()) cache.delete(key);
      if (cache.size >= 512) cache.delete(cache.keys().next().value!);
    }
    cache.set(url, { until: Date.now() + (value ? FOUND_MS : FAILED_MS), value });
    return value;
  }).finally(() => pending.delete(url));
  pending.set(url, request);
  return request;
}

async function fetchIdentity(url: string, endpoint: string, id: string): Promise<DiscordIdentity | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", signal: controller.signal });
    if (response.status === 429) {
      const header = response.headers.get("Retry-After");
      const seconds = header ? Number(header) : NaN;
      const wait = Number.isFinite(seconds) ? seconds * 1000 : header ? Date.parse(header) - Date.now() : 60_000;
      pausedUntil.set(endpoint, Date.now() + Math.min(600_000, Math.max(5000, Number.isFinite(wait) ? wait : 60_000)));
      return null;
    }
    if (!response.ok) return null;
    const text = await response.text();
    if (text.length > 65_536) return null;
    const data = JSON.parse(text);
    const user = data?.user;
    if (typeof user?.id !== "string" || user.id !== id || typeof user.username !== "string") return null;
    const username = user.username.trim();
    if (!username || username.length > 64) return null;
    return { id, username, avatarUrl: safeAvatarUrl(data.avatar_url, id) ?? safeAvatarUrl(user.avatar, id) };
  } catch { return null; }
  finally { clearTimeout(timer); }
}
