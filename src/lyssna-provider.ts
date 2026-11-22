import type { Host, Track } from "./host";
import { parseLocalTtml } from "./local-lyrics";
import { lyssnaRequest } from "./lyssna-api";
import type { Line, Lyrics, LyssnaContributor } from "./lyssna/types";
import { normalizeIsrc } from "./spotify-track-metadata";

type LyricsView = {
  song: { id: string };
  revision_id?: string;
  ttml: string;
  offset_ms: number;
  timing_kind?: "word" | "line" | "static";
  contributors: LyssnaContributor[];
};
type CacheEntry = {
  value: LyricsView | null;
  etag?: string;
  freshUntil: number;
  maxAge: number;
};
type ApprovedUpload = { songId: string; revision: string };
type RecentApproval = ApprovedUpload & { expires: number; fallback?: { value: LyricsView; freshUntil: number } };

const cacheName = "lyssna-lyrics.api-curated";
const cacheLimit = 96;
const memory = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<LyricsView | null | undefined>>();
const cooling = new Map<string, number>();
const refreshes = new Set<string>();
const approvals = new Map<string, RecentApproval>();
const trackIsrc = new Map<string, string>();
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
  refreshes.clear();
  for (const approval of approvals.values()) approval.fallback = undefined;
  writes = writes.then(async () => {
    await globalThis.caches?.delete(cacheName);
    disk = undefined;
  }).catch(() => {});
}

// One track is one lookup: the ISRC rides along and the server tries it when the Spotify id
// matches nothing, so there is no second request.
const lyricsPath = (trackId: string, isrc?: string) => `/v1/lyrics/spotify/${trackId}${isrc ? `?isrc=${isrc}` : ""}`;

export function revalidateLyssnaSong(trackId: string, isrc?: string, approved?: ApprovedUpload) {
  const normalizedIsrc = normalizeIsrc(isrc) ?? trackIsrc.get(trackId);
  // The address a lookup used depends on whether the ISRC was known then, so both are refreshed.
  const paths = [lyricsPath(trackId, normalizedIsrc)];
  if (normalizedIsrc) paths.push(lyricsPath(trackId));
  for (const path of paths) {
    pending.delete(path);
    cooling.delete(path);
    // Keep the validator and offline result while requesting the latest revision.
    refreshes.add(path);
  }
  while (refreshes.size > cacheLimit) refreshes.delete(refreshes.keys().next().value!);
  if (approved && uuid.test(approved.songId) && uuid.test(approved.revision)) {
    approvals.set(paths[0], { ...approved, expires: Date.now() + 300_000 });
    if (approvals.size > cacheLimit) approvals.delete(approvals.keys().next().value!);
  }
}

function coolDown(path: string) {
  cooling.set(path, Date.now() + 15_000);
  if (cooling.size > cacheLimit) cooling.delete(cooling.keys().next().value!);
}

export function resumeLyssnaRequests() { cooling.clear(); }

async function lookup(path: string, current: () => boolean, revalidate: boolean): Promise<LyricsView | null | undefined> {
  const cached = await readCache(path, current);
  if (!current()) return;
  if (!revalidate && cached && Date.now() < cached.freshUntil) return cached.value;
  if (Date.now() < (cooling.get(path) ?? 0)) return cached?.value;
  try {
    const response = await lyssnaRequest(path, { etag: cached?.etag, revalidate: revalidate && !cached?.etag });
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

async function lookupRefreshed(path: string, current: () => boolean, refresh: boolean) {
  const value = await lookup(path, current, refresh);
  const approval = approvals.get(path);
  if (!approval || !current()) return value;
  if (value?.revision_id === approval.revision || Date.now() >= approval.expires) {
    approvals.delete(path);
    return value;
  }
  if (!refresh && approval.fallback && approval.fallback.freshUntil > Date.now()) return approval.fallback.value;

  // The track URL can still have an older response while approval purges the edge.
  // Confirm the current revision and its timing offset before using the approved file.
  const songPath = `/v1/songs/${approval.songId}`;
  try {
    const songReply = await lyssnaRequest(songPath);
    if (!songReply?.ok || !current()) return approval.fallback?.value ?? value;
    const song = await songReply.json() as { current_revision_id?: string; links?: { platform: string; external_id: string; offset_ms: number }[] };
    if (song.current_revision_id !== approval.revision) {
      if (current()) approvals.delete(path);
      return value;
    }
    const link = song.links?.find(({ platform, external_id }) => platform === "spotify" && path.split("?")[0] === `/v1/lyrics/spotify/${external_id}`);
    if (!link || !Number.isFinite(link.offset_ms) || !current()) return value;
    const [file, credits] = await Promise.all([
      lyssnaRequest(`/v1/revisions/${approval.revision}/ttml`),
      lyssnaRequest(`${songPath}/contributors`),
    ]);
    if (!file?.ok || !credits?.ok || !current()) return approval.fallback?.value ?? value;
    const [ttml, contributors] = await Promise.all([file.text(), credits.json()]);
    if (!current() || !Array.isArray(contributors)) return value;
    const confirmed: LyricsView = { song: { id: approval.songId }, revision_id: approval.revision,
      ttml, contributors, offset_ms: link.offset_ms };
    approval.fallback = { value: confirmed, freshUntil: Date.now() + 60_000 };
    return confirmed;
  } catch {
    return approval.fallback?.value ?? value;
  }
}

function read(trackId: string, isrc?: string) {
  const path = lyricsPath(trackId, isrc);
  const existing = pending.get(path);
  if (existing) return existing;
  const generation = cacheGeneration;
  const refresh = refreshes.delete(path);
  const request: Promise<LyricsView | null | undefined> = lookupRefreshed(path,
    () => cacheGeneration === generation && pending.get(path) === request, refresh).finally(() => {
    if (pending.get(path) === request) pending.delete(path);
  });
  pending.set(path, request);
  return request;
}

export async function readLyssnaLyrics(track: Track, lookupIsrc: Host["lookupIsrc"]): Promise<Lyrics | undefined> {
  if (!/^[A-Za-z0-9]{22}$/.test(track.id)) return;
  const isrc = normalizeIsrc(track.isrc) ?? trackIsrc.get(track.id) ?? normalizeIsrc(await lookupIsrc(track.id).catch(() => undefined));
  if (isrc) {
    trackIsrc.set(track.id, isrc);
    if (trackIsrc.size > cacheLimit) trackIsrc.delete(trackIsrc.keys().next().value!);
  }
  const value = await read(track.id, isrc);
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
