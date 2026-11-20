import type { Track } from "./host";
import { clearTemporaryLyrics, readLocalLyrics, lyricsChanged } from "./local-lyrics";
import type { Lyrics } from "./lyssna/types";
import { readLrcLib, readLrcRed, readNetease } from "./remote-lyrics";
import type { Settings } from "./settings";
import { readSpicyLyrics } from "./spicy";
import { clearLyssnaCache, readLyssnaLyrics, revalidateLyssnaSong } from "./lyssna-provider";

export const lyricSources = {
  local: { name: "Imported TTML", help: "Lyrics you loaded for the playing song." },
  lyssna: { name: "Lyssna Lyrics API", help: "Approved community lyrics from Lyssna. Receives the Spotify track ID and may check its ISRC." },
  spicy: { name: "Spicy Lyrics", help: "Community lyrics supplied by the Spicy Lyrics plugin." },
  apple: { name: "Apple Music", help: "Apple Music lyrics when supplied by Spicy Lyrics." },
  lrcred: { name: "lrc.red", help: "Word-timed lyrics. Receives the song's ISRC." },
  lrclib: { name: "LRCLIB", help: "Open lyrics database. Receives the song title, artist, album and length." },
  netease: { name: "Netease", help: "Community lyrics through a third-party proxy. Receives the song title and artist." },
};

export type LyricSource = keyof typeof lyricSources;
export const sourceIds = Object.keys(lyricSources) as LyricSource[];

export function orderedSources(order: string[]) {
  return [...new Set<LyricSource>(["local", "lyssna", ...order.filter((id): id is LyricSource => Object.hasOwn(lyricSources, id)), ...sourceIds])];
}

export function enabledSources(settings: Settings) {
  const order = orderedSources(settings.lyrics_source_order).filter((id) => !settings.lyrics_sources_disabled.includes(id));
  if (settings.lyrics_prefer_apple && order.includes("apple")) {
    const prioritized: LyricSource[] = order.filter((id) => id !== "apple");
    prioritized.splice(prioritized.filter((id) => id === "local" || id === "lyssna").length, 0, "apple");
    return prioritized;
  }
  return order;
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

function readCached(trackId: string, id: string, reader: () => Promise<Lyrics | undefined>, missMs: number) {
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
      entry.expires = Date.now() + (lyrics ? 60_000 : missMs);
      return lyrics;
    }),
  };
  entries.set(id, entry);
  return entry.value;
}

export async function readLyrics(track: Track, duration: number, sources: LyricSource[]) {
  for (const id of sources) {
    if (id === "local") {
      const lyrics = await readLocalLyrics(track.id, duration).catch(() => undefined);
      if (lyrics) return lyrics;
    } else if (id === "lyssna") {
      const lyrics = await readLyssnaLyrics(track).catch(() => undefined);
      if (lyrics) return lyrics;
    } else if (id === "spicy" || id === "apple") {
      const lyrics = await readCached(track.id, "spicy", () => readSpicyLyrics(track.id), 350);
      if (lyrics && (lyrics.source === "Apple Music") === (id === "apple")) return lyrics;
    } else {
      const lyrics = await readCached(track.id, id, () => remoteReaders[id](track, duration, AbortSignal.timeout(7_000)), 30_000);
      if (lyrics) return lyrics;
    }
  }
}
