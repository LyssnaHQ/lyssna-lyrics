import type { Host, Track } from "../host";
import { readLyrics, songLyricSource, type LyricSource } from "../lyric-sources";
import { parseSpotifyLyrics } from "../remote-lyrics";
import { canSeed } from "./ttml-creator-model";

export async function within<T>(request: Promise<T> | undefined, ms: number): Promise<T | undefined> {
  if (!request) return;
  let timer = 0;
  try {
    return await Promise.race([request, new Promise<undefined>((resolve) => {
      timer = window.setTimeout(resolve, ms);
    })]);
  } catch {
    return undefined;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function currentCreatorLyrics(host: Host, track: Track, duration: number, sources: LyricSource[]) {
  const allowed = sources.filter((source) => source !== "spicy");
  const preferred = songLyricSource(track);
  const lyrics = await readLyrics(track, duration, allowed, host, {
    preferred: preferred && preferred !== "spicy" && (preferred !== "local" || allowed.includes(preferred)) ? preferred : undefined,
  }).catch(() => undefined);
  if (lyrics?.instrumental && lyrics.source === "Lyssna") return lyrics;
  if (lyrics?.lines.length && canSeed(lyrics)) return lyrics;
  const response = await within(Promise.resolve().then(() => host.spotifyLyrics(track.id)), 7000);
  return parseSpotifyLyrics(response, duration);
}
