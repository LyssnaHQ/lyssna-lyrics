import type { Host, Track } from "./host";
import { clearTemporaryLyrics, readLocalLyrics, lyricsChanged } from "./local-lyrics";
import type { Lyrics } from "./lyssna/types";
import { parseSpotifyLyrics, readLrcLib, readLrcRed, readNetease, within } from "./remote-lyrics";
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
  cache.delete(track.id);
  revalidateLyssnaSong(track.id, track.isrc);
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
  const available = (id: LyricSource) => !track.local || (id !== "spicy" && id !== "spotify");
  sources = sources.filter(available);
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
    if (apple.instrumental || hasWordTiming(apple)) return apple;
    const spicy = spicyEnabled ? await readSpicy() : undefined;
    if (spicy?.source === spicyCommunitySource && hasWordTiming(spicy)) return spicy;
    const lrcRed = sources.includes("lrcred") ? await fromSource("lrcred") : undefined;
    return lrcRed && hasWordTiming(lrcRed) ? lrcRed : apple;
  }

  async function fromSource(id: LyricSource, selected = false): Promise<Lyrics | undefined> {
    if (id === "local") {
      return readLocalLyrics(track.id, duration).catch(() => undefined);
    } else if (id === "lyssna") {
      return (await readLyssnaLyrics(track, lookupIsrc, "lyssna", duration).catch(() => undefined)) ?? undefined;
    } else if (id === "apple") {
      const lyrics = await readApple();
      if (lyrics) return selected ? lyrics : preferWordTiming(lyrics);
      if (selected && lyrics === undefined && spicyEnabled) {
        const fallback = await readSpicy();
        if (fallback?.source === spicyAppleSource) return fallback;
      }
    } else if (id === "spicy") {
      const lyrics = await readSpicy();
      if (selected) return lyrics?.source === spicyCommunitySource ? lyrics : undefined;
      if (!lyrics) return;
      if (lyrics.source === spicyCommunitySource) {
        if (!hasWordTiming(lyrics)) return;
        const apple = appleEnabled ? await readApple() : undefined;
        return apple && hasWordTiming(apple) ? apple : lyrics;
      }
      if (lyrics.source === "Spotify") return;
      if (lyrics.source !== spicyAppleSource) return lyrics;
      if (!appleEnabled) return;
      const apple = await readApple();
      if (apple) return preferWordTiming(apple);
      if (apple === undefined) return preferWordTiming(lyrics);
    } else if (id === "spotify") {
      const lyrics = await readCached(track.id, "spotify", async () =>
        parseSpotifyLyrics(await within(host.spotifyLyrics(track.id), 7000), duration), 30_000);
      if (lyrics) return lyrics;
      const fallback = spicyEnabled ? await readSpicy() : undefined;
      if (fallback?.source === "Spotify") return fallback;
    } else {
      const sourceTrack = id === "lrcred" && !track.isrc
        ? { ...track, isrc: await lookupIsrc(track.id, track.isrc).catch(() => undefined) } : track;
      if (id === "lrcred" && !sourceTrack.isrc) return;
      const key = id === "lrcred" ? `lrcred:${sourceTrack.isrc}` : id;
      return readCached(track.id, key, () => remoteReaders[id](sourceTrack, duration, AbortSignal.timeout(7_000)), 30_000);
    }
  }
  if (preferred && available(preferred)) {
    const lyrics = await fromSource(preferred, true);
    if (lyrics) return lyrics;
  }
  for (const id of sources) {
    // Spicy can still provide an Apple Music fallback in the usual order.
    if (id === preferred && id !== "spicy") continue;
    const lyrics = await fromSource(id);
    if (lyrics) return lyrics;
  }
}
