import type { Host, Track } from "./host";
import { lyricsChanged, parseLocalTtml } from "./local-lyrics";
import { hasLyssnaSession, lyssnaAccountRequest } from "./lyssna-account";
import { lyssnaRequest } from "./lyssna-api";
import type { Line, Lyrics, LyssnaContributor } from "./lyssna/types";
import { normalizeIsrc, spotifyTrackMetadata } from "./spotify-track-metadata";

// What the lyrics route answers: Lyssna's lyrics (a song), Apple Music's through Lyssna (an apple_id), or a
// recording marked instrumental (no song and no lyrics).
type LyricsView = {
  source?: "lyssna" | "apple_music";
  song?: { id: string; instrumental?: boolean };
  apple_id?: string;
  isrc?: string;
  instrumental?: boolean;
  credit?: { text?: string };
  revision_id?: string;
  ttml: string;
  offset_ms: number;
  timing_kind?: Lyrics["timing_kind"];
  contributors?: LyssnaContributor[];
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
const songPaths = new Map<string, Set<string>>();
const parsed = new WeakMap<LyricsView, Lyrics>();
const appleCredits = new Map<string, Promise<boolean | undefined>>();
const songwriters = new Map<string, { expires: number; value: Promise<string[]> }>();
let disk: Promise<Cache | undefined> | undefined;
let writes = Promise.resolve();
let cacheGeneration = 0;
const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

export function readLyssnaAppleCredit(songId: string, revisionId: string) {
  if (!uuid.test(songId) || !uuid.test(revisionId)) return Promise.resolve(false);
  const existing = appleCredits.get(revisionId);
  if (existing) return existing;

  const request = (async () => {
    const response = await lyssnaRequest(`/v1/songs/${songId}/revisions`);
    if (!response?.ok) return;
    const revisions = await response.json() as { id: string; parent_id?: string; source: string; timing_kind?: Lyrics["timing_kind"] }[];
    if (!Array.isArray(revisions)) return;
    const byId = new Map(revisions.map(revision => [revision.id, revision]));
    if (!byId.has(revisionId)) return;
    let revision = byId.get(revisionId);
    while (revision) {
      if (revision.source === "apple_music") return revision.timing_kind === "word";
      byId.delete(revision.id);
      revision = revision.parent_id ? byId.get(revision.parent_id) : undefined;
    }
    return false;
  })().catch(() => undefined).then(credited => {
    if (credited === undefined && appleCredits.get(revisionId) === request) appleCredits.delete(revisionId);
    return credited;
  });
  appleCredits.set(revisionId, request);
  if (appleCredits.size > cacheLimit) appleCredits.delete(appleCredits.keys().next().value!);
  return request;
}

export function readLyssnaSongwriters(songId: string) {
  if (!uuid.test(songId)) return Promise.resolve([]);
  const cached = songwriters.get(songId);
  if (cached && cached.expires > Date.now()) return cached.value;

  const entry = { expires: Infinity, value: load() };
  songwriters.set(songId, entry);
  if (songwriters.size > cacheLimit) songwriters.delete(songwriters.keys().next().value!);
  return entry.value;

  async function load() {
    try {
      const response = await lyssnaRequest(`/v1/songs/${songId}`);
      if (!response?.ok) return [];
      const { credits } = await response.json() as { credits?: { role: string; name: string }[] };
      return [...new Set(credits?.flatMap(({ role, name }) =>
        /^(writer|composer|lyricist)$/i.test(role) && name.trim() ? [name.trim()] : []) ?? [])];
    } catch {
      return [];
    } finally {
      entry.expires = Date.now() + 60_000;
    }
  }
}

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
  appleCredits.clear();
  songwriters.clear();
  for (const approval of approvals.values()) approval.fallback = undefined;
  writes = writes.then(async () => {
    await globalThis.caches?.delete(cacheName);
    disk = undefined;
  }).catch(() => {});
}

type Source = "lyssna" | "apple_music";
export const lyssnaAppleSource = "Apple Music (via Lyssna)";
const communityPath = (trackId: string, isrc?: string) =>
  trackId.startsWith("spotify:local:") && isrc
    ? `/v1/lyrics/isrc/${isrc}?source=lyssna`
    : `/v1/lyrics/spotify/${trackId}?${isrc ? `isrc=${isrc}&` : ""}source=lyssna`;

export function revalidateLyssnaSong(trackId: string, isrc?: string, approved?: ApprovedUpload) {
  const normalizedIsrc = normalizeIsrc(isrc) ?? trackIsrc.get(trackId);
  const local = trackId.startsWith("spotify:local:");
  if (local && !normalizedIsrc) return;
  // The address a lookup used depends on whether the ISRC was known then, so both are refreshed.
  const paths = [communityPath(trackId, normalizedIsrc)];
  if (!local && normalizedIsrc) paths.push(communityPath(trackId));
  paths.push(...(songPaths.get(trackId) ?? []));
  for (const path of paths) {
    pending.delete(path);
    cooling.delete(path);
    // Keep the validator and offline result while requesting the latest revision.
    refreshes.add(path);
  }
  while (refreshes.size > cacheLimit) refreshes.delete(refreshes.keys().next().value!);
  if (approved && uuid.test(approved.songId) && uuid.test(approved.revision)) {
    for (const path of paths) {
      if (new URL(path, "https://api.lyssna.org").searchParams.get("source") === "lyssna")
        approvals.set(path, { ...approved, expires: Date.now() + 300_000 });
    }
    while (approvals.size > cacheLimit) approvals.delete(approvals.keys().next().value!);
  }
}

function coolDown(path: string) {
  cooling.set(path, Date.now() + 15_000);
  if (cooling.size > cacheLimit) cooling.delete(cooling.keys().next().value!);
}

export function resumeLyssnaRequests() { cooling.clear(); }

function validAnswer(value: LyricsView) {
  // a recording a reviewer marked instrumental counts as synced and has no song
  if (value.instrumental === true && !value.song) return value.source === "lyssna" && !!normalizeIsrc(value.isrc);
  if (typeof value.ttml !== "string" || !Number.isFinite(value.offset_ms)) return false;
  if (value.source === "apple_music") return /^\d{1,15}$/.test(value.apple_id ?? "");
  return uuid.test(value.song?.id ?? "");
}

async function lookup(path: string, current: () => boolean, revalidate: boolean): Promise<LyricsView | null | undefined> {
  const cached = await readCache(path, current);
  if (!current()) return;
  if (!revalidate && cached && Date.now() < cached.freshUntil) return cached.value;
  if (Date.now() < (cooling.get(path) ?? 0)) return cached?.value ?? undefined;
  try {
    // A cleared cache can still have a previous miss at the edge.
    const requestPath = revalidate && !cached?.value ? `${path}&fresh=${Date.now()}` : path;
    const response = await lyssnaRequest(requestPath, {
      etag: cached?.etag, revalidate: revalidate && !cached?.etag, waitForInstall: true,
    });
    if (!current()) return;
    if (!response || response.status === 429 || response.status >= 500) {
      coolDown(path);
      return cached?.value ?? undefined;
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
    if (value && !validAnswer(value)) return;
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
    return cached?.value ?? undefined;
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
    const songReply = await lyssnaRequest(`${songPath}?fresh=${approval.revision}`, { revalidate: true });
    if (!songReply?.ok || !current()) return approval.fallback?.value ?? value;
    const song = await songReply.json() as { current_revision_id?: string; links?: { platform: string; external_id: string; offset_ms: number }[] };
    if (song.current_revision_id !== approval.revision) {
      if (current()) approvals.delete(path);
      return value;
    }
    const route = path.split("?")[0];
    const link = song.links?.find(({ platform, external_id }) =>
      (platform === "spotify" || platform === "isrc") && route === `/v1/lyrics/${platform}/${external_id}`);
    if (!link || !Number.isFinite(link.offset_ms) || !current()) return value;
    const [file, credits] = await Promise.all([
      lyssnaRequest(`/v1/revisions/${approval.revision}/ttml`),
      lyssnaRequest(`${songPath}/contributors?fresh=${approval.revision}`, { revalidate: true }),
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

function read(path: string) {
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

function timedLookupPath(trackId: string, route: string, duration: number) {
  const length = duration >= 1_000 && duration <= 3_600_000 ? `&duration_ms=${Math.round(duration)}` : "";
  const path = route + length;
  const paths = songPaths.get(trackId) ?? new Set<string>();
  if (length && !paths.has(path) && refreshes.has(route)) {
    refreshes.add(path);
    const approval = approvals.get(route);
    if (approval) {
      approvals.set(path, approval);
      if (approvals.size > cacheLimit) approvals.delete(approvals.keys().next().value!);
    }
  }
  paths.add(path);
  if (paths.size > 10) paths.delete(paths.values().next().value!);
  songPaths.set(trackId, paths);
  if (songPaths.size > cacheLimit) songPaths.delete(songPaths.keys().next().value!);
  return path;
}

async function searchAppleSong(track: Track, duration: number) {
  const artistName = track.artist || track.artistLinks?.[0]?.name || track.artists;
  const normalized = (text?: string) => text?.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(" ") ?? "";
  const title = normalized(track.title);
  const artist = normalized(artistName);
  if (!title || !artist || !(duration > 0)) return null;
  const url = new URL("https://itunes.apple.com/search");
  url.search = new URLSearchParams({ term: `${track.title} ${artistName}`, media: "music", entity: "song", limit: "10" }).toString();
  try {
    const response = await fetch(url, { credentials: "omit", signal: AbortSignal.timeout(4_000) });
    if (!response.ok) return;
    const { results } = await response.json() as {
      results?: { trackId: number; trackName: string; artistName: string; trackTimeMillis: number }[];
    };
    if (!Array.isArray(results)) return;
    return results
      .filter(song => Number.isSafeInteger(song.trackId) && song.trackId > 0 &&
        normalized(song.trackName) === title && ` ${normalized(song.artistName)} `.includes(` ${artist} `) &&
        Math.abs(song.trackTimeMillis - duration) <= 2_000)
      .sort((a, b) => Math.abs(a.trackTimeMillis - duration) - Math.abs(b.trackTimeMillis - duration))[0]?.trackId ?? null;
  } catch { /* A network failure may recover on the next lyrics refresh. */ }
}

async function trackCode(track: Track, lookupIsrc: Host["lookupIsrc"]) {
  const isrc = normalizeIsrc(track.isrc) ?? (track.local ? undefined : trackIsrc.get(track.id))
    ?? normalizeIsrc(await lookupIsrc(track.id).catch(() => undefined));
  if (isrc) {
    trackIsrc.set(track.id, isrc);
    if (trackIsrc.size > cacheLimit) trackIsrc.delete(trackIsrc.keys().next().value!);
  }
  return isrc;
}

async function readAppleLyrics(track: Track, isrc: string | undefined, duration: number) {
  const metadata = track.local ? undefined : await spotifyTrackMetadata(track.id);
  const length = duration > 0 ? duration : metadata?.duration_ms ?? 0;
  const codes = [...new Set([isrc, ...(metadata?.isrcs ?? [])].filter((code): code is string => !!code))].slice(0, 4);
  if (!codes.length && !track.local) {
    const response = await lyssnaRequest(`/v1/tracks/spotify/${track.id}`).catch(() => undefined);
    if (response?.ok) {
      const body = await response.json().catch(() => undefined) as { isrcs?: string[] } | undefined;
      const additional = Array.isArray(body?.isrcs) ? body.isrcs : [];
      for (const code of new Set(additional.map(normalizeIsrc))) {
        if (code) codes.push(code);
        if (codes.length === 4) break;
      }
    }
  }
  async function byId(platform: "isrc" | "apple_music", id: string) {
    const value = await read(timedLookupPath(track.id, `/v1/lyrics/${platform}/${id}?source=apple_music`, length));
    if (value?.source === "apple_music") return parseLyrics(value, platform === "isrc" ? id : undefined, length);
    return value === undefined ? undefined : null;
  }
  for (const code of codes) {
    const lyrics = await byId("isrc", code);
    if (lyrics !== null) return lyrics;
  }
  if (track.local) return null;
  const appleId = await searchAppleSong(track, length);
  if (appleId == null) return appleId;
  return byId("apple_music", String(appleId));
}

// A definitive miss is null. An unavailable lookup is undefined.
export async function readLyssnaLyrics(track: Track, lookupIsrc: Host["lookupIsrc"], source: Source = "lyssna", duration = 0): Promise<Lyrics | null | undefined> {
  if (!track.local && !/^[A-Za-z0-9]{22}$/.test(track.id)) return;
  const isrc = await trackCode(track, lookupIsrc);
  if (source === "apple_music") return readAppleLyrics(track, isrc, duration);
  if (track.local && !isrc) return null;
  const value = await read(timedLookupPath(track.id, communityPath(track.id, isrc), duration));
  if (!value) return value;
  if (value.source !== "apple_music") return parseLyrics(value);
}

async function parseLyrics(value: LyricsView, isrc?: string, duration?: number): Promise<Lyrics | null> {
  const previous = parsed.get(value);
  if (previous) return previous;
  const apple = value.source === "apple_music";
  const sourceName = apple ? lyssnaAppleSource : "Lyssna";
  const creditText = typeof value.credit?.text === "string" ? value.credit.text.trim() : undefined;
  const credit = apple && creditText ? creditText.replace("Apple Music via Lyssna", sourceName) : creditText;
  const attribution = value.song && {
    songId: value.song.id,
    revisionId: value.revision_id,
    contributors: Array.isArray(value.contributors) ? value.contributors : [],
  };
  if ((value.instrumental || value.song?.instrumental) && !value.ttml?.trim()) {
    const result: Lyrics = { source: "Lyssna", credit, lyssna: attribution, lines: [], synced: false, instrumental: true };
    parsed.set(value, result);
    return result;
  }
  let lyrics: Lyrics;
  try { lyrics = parseLocalTtml(value.ttml, duration); }
  catch { return null; }
  if (!lyrics.lines.length) return null;
  const hash = apple && value.timing_kind === "word" && value.apple_id && isrc
    ? await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.ttml))
    : undefined;
  const appleOriginal: Lyrics["appleOriginal"] = hash && value.apple_id && isrc ? {
    apple_id: value.apple_id, isrc, timing_kind: "word",
    sha256: Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join(""),
  } : undefined;
  const offset = value.offset_ms;
  function timed(line: Line): Line {
    return {
      ...line, start_ms: line.start_ms + offset, end_ms: line.end_ms + offset,
      words: line.words.map((word) => ({ ...word, start_ms: word.start_ms + offset, end_ms: word.end_ms + offset })),
      romanization_words: line.romanization_words?.map((word) => ({ ...word, start_ms: word.start_ms + offset, end_ms: word.end_ms + offset })),
      reading: line.reading && timed(line.reading),
    };
  }
  const result: Lyrics = {
    ...lyrics, source: sourceName, credit, timing_kind: value.timing_kind, appleOriginal,
    synced: value.timing_kind !== "static" && lyrics.synced,
    lines: offset ? lyrics.lines.map(timed) : lyrics.lines,
    lyssna: attribution,
    external: apple && value.apple_id ? { source: "apple_music", id: value.apple_id } : undefined,
  };
  parsed.set(value, result);
  return result;
}

export async function markLyssnaInstrumental(track: Track, host: Host) {
  if (!/^[A-Za-z0-9]{22}$/.test(track.id)) throw new Error("Only Spotify tracks can be marked instrumental.");
  const isrc = await trackCode(track, host.lookupIsrc);
  if (!isrc) throw new Error("Spotify doesn’t have an ISRC for this recording.");
  const metadata = await spotifyTrackMetadata(track.id).catch(() => undefined);
  const isrcs = [...new Set([isrc, ...(metadata?.isrcs ?? [])])];
  const response = await lyssnaAccountRequest("/v1/submissions", {
    instrumental: true, extra_isrcs: isrcs, title: track.title, album: track.album,
    artists: track.artistLinks?.map(artist => artist.name) ?? [track.artists || track.artist].filter(Boolean),
    links: [{ platform: "isrc", external_id: isrc }, { platform: "spotify", external_id: track.id }],
  });
  if (!hasLyssnaSession() || response?.status === 401) throw new Error("Sign in to Lyssna in Settings.");
  if (response?.status === 403) throw new Error("Your Lyssna account can’t mark recordings instrumental.");
  if (!response?.ok) throw new Error("Couldn’t update this recording’s instrumental status.");
  const result = await response.json() as { status?: string };
  if (result.status === "pending") return "Sent to Lyssna for review as instrumental.";
  revalidateLyssnaSong(track.id, isrc);
  window.dispatchEvent(new CustomEvent(lyricsChanged, { detail: [track.id] }));
  return "Marked instrumental on Lyssna.";
}

export async function requestLyssnaLyrics(track: Track) {
  if (!/^[A-Za-z0-9]{22}$/.test(track.id)) throw new Error("Only Spotify songs can be requested.");
  const path = `/v1/tracks/spotify/${track.id}/request`;
  const response = hasLyssnaSession() ? await lyssnaAccountRequest(path, {})
    : await lyssnaRequest(path, { body: {}, waitForInstall: true });
  const result = await response?.json().catch(() => undefined) as { requests?: number; error?: string } | undefined;
  if (result?.error === "has_lyrics") throw new Error("This song already has lyrics on Lyssna.");
  if (result?.error === "instrumental") throw new Error("Lyssna has this song marked instrumental.");
  if (!response?.ok || !Number.isSafeInteger(result?.requests)) throw new Error("Couldn’t request lyrics. Try again later.");
  return result!.requests!;
}
