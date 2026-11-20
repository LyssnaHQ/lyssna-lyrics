import type { Track } from "./host";
import { parseLocalTtml } from "./local-lyrics";
import { lyssnaRequest } from "./lyssna-api";
import type { Line, Lyrics, LyssnaContributor } from "./lyssna/types";

type LyricsView = {
  song: { id: string };
  ttml: string;
  offset_ms: number;
  timing_kind: "word" | "line" | "static";
  contributors: LyssnaContributor[];
};
type CacheEntry = {
  value: LyricsView | null;
  etag?: string;
  freshUntil: number;
  maxAge: number;
};

const cacheName = "lyssna-lyrics.api-curated";
const cacheLimit = 96;
const memory = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<LyricsView | null | undefined>>();
const cooling = new Map<string, number>();
const parsed = new WeakMap<LyricsView, Lyrics>();
let disk: Promise<Cache | undefined> | undefined;
let writes = Promise.resolve();
let cacheGeneration = 0;
const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

function remember(path: string, entry: CacheEntry) {
  memory.delete(path);
  memory.set(path, entry);
  if (memory.size > cacheLimit) memory.delete(memory.keys().next().value!);
}

function diskCache() {
  return disk ??= (globalThis.caches?.open(cacheName) ?? Promise.resolve(undefined)).catch(() => undefined);
}

// Cache Storage is scoped to the plugin's Spotify origin. These entries contain
// response data and validators only, with no install headers or tokens.
const cacheUrl = (path: string) => new URL(path, "https://api.lyssna.org").href;

async function readCache(path: string, current: () => boolean) {
  const live = memory.get(path);
  if (live) return live;
  try {
    await writes;
    const stored = await (await diskCache())?.match(cacheUrl(path));
    const entry = await stored?.json() as CacheEntry | undefined;
    if (current() && entry && Number.isFinite(entry.freshUntil) && Number.isFinite(entry.maxAge)) {
      remember(path, entry);
      return entry;
    }
  } catch { /* Unavailable browser storage falls back to memory. */ }
}

function saveCache(path: string, entry: CacheEntry) {
  remember(path, entry);
  writes = writes.then(async () => {
    const cache = await diskCache();
    if (!cache) return;
    const key = cacheUrl(path);
    await cache.delete(key);
    await cache.put(key, Response.json(entry));
    const keys = await cache.keys();
    for (const old of keys.slice(0, Math.max(0, keys.length - cacheLimit))) await cache.delete(old);
  }).catch(() => {});
}

export function clearLyssnaCache() {
  cacheGeneration++;
  memory.clear();
  pending.clear();
  cooling.clear();
  writes = writes.then(async () => {
    await globalThis.caches?.delete(cacheName);
    disk = undefined;
  }).catch(() => {});
}

export function invalidateLyssnaSong(trackId: string, isrc?: string) {
  const paths = [`/v1/lyrics/spotify/${trackId}`];
  if (isrc) paths.push(`/v1/lyrics/isrc/${isrc}`);
  for (const path of paths) {
    memory.delete(path);
    pending.delete(path);
    cooling.delete(path);
  }
  writes = writes.then(async () => {
    const cache = await diskCache();
    for (const path of paths) await cache?.delete(cacheUrl(path));
  }).catch(() => {});
}

function coolDown(path: string) {
  cooling.set(path, Date.now() + 15_000);
  if (cooling.size > cacheLimit) cooling.delete(cooling.keys().next().value!);
}

export function resumeLyssnaRequests() { cooling.clear(); }

async function lookup(path: string, current: () => boolean): Promise<LyricsView | null | undefined> {
  const cached = await readCache(path, current);
  if (!current()) return;
  if (cached && Date.now() < cached.freshUntil) return cached.value;
  if (Date.now() < (cooling.get(path) ?? 0)) return cached?.value;
  try {
    const response = await lyssnaRequest(path, { etag: cached?.etag });
    if (!current()) return;
    if (!response || response.status === 429 || response.status >= 500) {
      coolDown(path);
      return cached?.value;
    }
    if (response.status !== 304 && response.status !== 404 && !response.ok) {
      coolDown(path);
      return;
    }
    if (response.status === 304 && !cached) return;
    const etag = response.headers.get("ETag") ?? (response.status === 304 ? cached?.etag : undefined);
    const same = response.status === 304 || (response.ok && etag && cached?.etag === etag);
    const value = same ? cached!.value
      : response.status === 404 ? null : await response.json() as LyricsView;
    if (!current()) return;
    if (value && (!uuid.test(value.song?.id) || typeof value.ttml !== "string" || !Number.isFinite(value.offset_ms))) return;
    const policy = response.headers.get("Cache-Control") ?? "";
    const maxAge = Number(/\bmax-age=(\d+)/i.exec(policy)?.[1] ??
      (response.status === 304 ? cached!.maxAge : 60));
    const age = Number(response.headers.get("Age") ?? 0) || 0;
    if (!/\bno-store\b/i.test(policy)) {
      saveCache(path, { value, maxAge, freshUntil: Date.now() + Math.max(0, maxAge - age) * 1_000, etag });
    }
    return value;
  } catch {
    if (!current()) return;
    coolDown(path);
    return cached?.value;
  }
}

function read(platform: "spotify" | "isrc", id: string) {
  const path = `/v1/lyrics/${platform}/${id}`;
  const existing = pending.get(path);
  if (existing) return existing;
  const generation = cacheGeneration;
  const request: Promise<LyricsView | null | undefined> = lookup(path,
    () => cacheGeneration === generation && pending.get(path) === request).finally(() => {
    if (pending.get(path) === request) pending.delete(path);
  });
  pending.set(path, request);
  return request;
}

export async function readLyssnaLyrics(track: Track): Promise<Lyrics | undefined> {
  if (!/^[A-Za-z0-9]{22}$/.test(track.id)) return;
  let value = await read("spotify", track.id);
  const isrc = track.isrc?.replaceAll("-", "").toUpperCase();
  if (value === null && isrc && /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc)) value = await read("isrc", isrc);
  if (!value) return;
  const previous = parsed.get(value);
  if (previous) return previous;
  const lyrics = parseLocalTtml(value.ttml);
  const offset = value.offset_ms;
  function timed(line: Line): Line {
    return {
      ...line, start_ms: line.start_ms + offset, end_ms: line.end_ms + offset,
      words: line.words.map((word) => ({ ...word, start_ms: word.start_ms + offset, end_ms: word.end_ms + offset })),
      reading: line.reading && timed(line.reading),
    };
  }
  const result: Lyrics = {
    ...lyrics, source: "Lyssna", synced: value.timing_kind !== "static" && lyrics.synced,
    lines: offset ? lyrics.lines.map(timed) : lyrics.lines,
    lyssna: { songId: value.song.id, contributors: Array.isArray(value.contributors) ? value.contributors : [] },
  };
  parsed.set(value, result);
  return result;
}
