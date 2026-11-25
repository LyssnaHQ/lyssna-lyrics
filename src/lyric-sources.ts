import type { Host, Track } from "./host";
import { clearTemporaryLyrics, readLocalLyrics, lyricsChanged } from "./local-lyrics";
import type { Lyrics } from "./lyssna/types";
import { parseSpotifyLyrics, readLrcLib, readLrcRed, readNetease } from "./remote-lyrics";
import type { Settings } from "./settings";
import { readSpicyLyrics, spicyAppleSource, spicyCommunitySource } from "./spicy";
import { clearLyssnaCache, readLyssnaLyrics, revalidateLyssnaSong } from "./lyssna-provider";
import { localTrackIsrc } from "./local-track-isrc";

export const lyricSources = {
  local: { name: "Imported TTML", help: "Lyrics you loaded for the playing song." },
  lyssna: { name: "Lyssna Lyrics", help: "Approved community lyrics from Lyssna. Receives the Spotify track ID and may check its ISRC." },
  apple: { name: "Apple Music", help: "Finds lyrics through Lyssna by ISRC, or searches Apple by title and artist." },
  spicy: { name: "Spicy Lyrics", help: "Word-synced community lyrics and Apple Music when Lyssna’s Apple Music source is unavailable. Sends the track ID to Spicy Lyrics." },
  spotify: { name: "Spotify", help: "Spotify’s lyrics through your signed-in Spotify session." },
  lrcred: { name: "lrc.red", help: "Word-timed lyrics. Receives the song's ISRC." },
  lrclib: { name: "LRCLIB", help: "Open lyrics database. Receives the song title, artist, album and length." },
  netease: { name: "Netease", help: "Community lyrics through a third-party proxy. Receives the song title and artist." },
};

export type LyricSource = keyof typeof lyricSources;
export const sourceIds = Object.keys(lyricSources) as LyricSource[];
const songSourceKey = (track: Track) => `lyssna-lyrics.song-source.${track.id}`;

export function songLyricSource(track: Track) {
  try {
    const value = localStorage.getItem(songSourceKey(track));
    return sourceIds.find(id => id === value);
  } catch { return undefined; }
}

export function setSongLyricSource(track: Track, source?: LyricSource) {
  if (source) localStorage.setItem(songSourceKey(track), source);
  else localStorage.removeItem(songSourceKey(track));
  window.dispatchEvent(new CustomEvent(lyricsChanged, { detail: [track.id] }));
}

export function orderedSources(order: string[]) {
  const saved = order.filter((id): id is LyricSource => Object.hasOwn(lyricSources, id));
  const spicy = saved.indexOf("spicy");
  if (spicy >= 0 && !saved.includes("spotify")) saved.splice(spicy + 1, 0, "spotify");
  return [...new Set<LyricSource>(["local", "lyssna", ...saved, ...sourceIds])];
}

export function enabledSources(settings: Settings) {
  return orderedSources(settings.lyrics_source_order).filter((id) => !settings.lyrics_sources_disabled.includes(id));
}

const remoteReaders = { lrcred: readLrcRed, lrclib: readLrcLib, netease: readNetease };
type Cached = { expires: number; value: Promise<Lyrics | undefined> };
const cache = new Map<string, Map<string, Cached>>();

export function refreshLyrics(track?: Track, action: Settings["lyrics_cache_action"] = "reload") {
  const trackId = track?.id;
  clearTemporaryLyrics(action === "all" ? undefined : trackId);
  if (action === "all") {
    cache.clear();
    clearLyssnaCache();
  }
  else if (trackId) {
    if (action === "song") cache.delete(trackId);
    else for (const entry of cache.get(trackId)?.values() ?? []) entry.expires = 0;
  }
  if (track) revalidateLyssnaSong(track.id, track.isrc);
  window.dispatchEvent(trackId && action !== "all" ? new CustomEvent(lyricsChanged, { detail: [trackId] }) : new Event(lyricsChanged));
}

function readCached(trackId: string, id: string, reader: () => Promise<Lyrics | undefined>, missMs: number, hitMs = 60_000) {
  let entries = cache.get(trackId);
  if (!entries) {
    entries = new Map();
    cache.set(trackId, entries);
    if (cache.size > 100) cache.delete(cache.keys().next().value!);
  }
  const cached = entries.get(id);
  if (cached && cached.expires > Date.now()) return cached.value;
  const entry: Cached = {
    expires: Infinity,
    value: reader().catch(() => undefined).then((lyrics) => {
      entry.expires = Date.now() + (lyrics ? hitMs : missMs);
      return lyrics;
    }),
  };
  entries.set(id, entry);
  return entry.value;
}

function hasWordTiming(lyrics: Lyrics) {
  return lyrics.synced && (lyrics.timing_kind === undefined || lyrics.timing_kind === "word") &&
    lyrics.lines.some((line) => line.words.some((word) => word.end_ms > word.start_ms));
}

export async function readLyrics(track: Track, duration: number, sources: LyricSource[], host: Host, {
  preferred, onAppleUnavailable,
}: { preferred?: LyricSource; onAppleUnavailable?: () => void } = {}): Promise<Lyrics | undefined> {
  if (preferred) {
    const selected = await readLyrics(track, duration, [preferred], host, { onAppleUnavailable });
    if (selected) return selected;
  }
  if (track.local) sources = sources.filter(id => id !== "spicy" && id !== "spotify");
  let isrcLookup: Promise<string | undefined> | undefined;
  const lookupIsrc = track.local ? () => isrcLookup ??= localTrackIsrc(track, duration, host) : host.lookupIsrc;
  const appleEnabled = sources.includes("apple");
  const spicyEnabled = sources.includes("spicy");
  let appleLookup: Promise<Lyrics | null | undefined> | undefined;
  const readApple = () => appleLookup ??= readLyssnaLyrics(track, lookupIsrc, "apple_music", duration).catch(() => undefined).then(lyrics => {
    if (lyrics === undefined) onAppleUnavailable?.();
    return lyrics;
  });
  const readSpicy = () => readCached(track.id, "spicy", () => readSpicyLyrics(track.id), 60_000, 5 * 60_000);

  async function preferWordTiming(apple: Lyrics) {
    if (!spicyEnabled || hasWordTiming(apple)) return apple;
    const spicy = await readSpicy();
    return spicy?.source === spicyCommunitySource && hasWordTiming(spicy) ? spicy : apple;
  }

  for (const id of sources) {
    if (id === "local") {
      const lyrics = await readLocalLyrics(track.id, duration).catch(() => undefined);
      if (lyrics) return lyrics;
    } else if (id === "lyssna") {
      const lyrics = await readLyssnaLyrics(track, lookupIsrc, "lyssna", duration).catch(() => undefined);
      if (lyrics) return lyrics;
    } else if (id === "apple") {
      const lyrics = await readApple();
      if (lyrics) return preferWordTiming(lyrics);
    } else if (id === "spicy") {
      const lyrics = await readSpicy();
      if (!lyrics) continue;
      if (lyrics.source === spicyCommunitySource) {
        if (!hasWordTiming(lyrics)) continue;
        const apple = appleEnabled ? await readApple() : undefined;
        return apple && hasWordTiming(apple) ? apple : lyrics;
      }
      if (lyrics.source === "Spotify") continue;
      if (lyrics.source !== spicyAppleSource) return lyrics;
      if (!appleEnabled) continue;
      const preferred = await readApple();
      if (preferred) return preferred;
      if (preferred === undefined) return lyrics;
    } else if (id === "spotify") {
      const lyrics = await readCached(track.id, "spotify", async () => parseSpotifyLyrics(await host.spotifyLyrics(track.id), duration), 30_000);
      if (lyrics) return lyrics;
      const fallback = spicyEnabled ? await readSpicy() : undefined;
      if (fallback?.source === "Spotify") return fallback;
    } else {
      const sourceTrack = id === "lrcred" && track.local ? { ...track, isrc: await lookupIsrc(track.id, track.isrc) } : track;
      if (id === "lrcred" && !sourceTrack.isrc) continue;
      const key = id === "lrcred" ? `lrcred:${sourceTrack.isrc}` : id;
      const lyrics = await readCached(track.id, key, () => remoteReaders[id](sourceTrack, duration, AbortSignal.timeout(7_000)), 30_000);
      if (lyrics) return lyrics;
    }
  }
}
