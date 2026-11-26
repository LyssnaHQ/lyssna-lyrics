import type { Host, Track } from "../host";
import { readLyrics, songLyricSource, type LyricSource } from "../lyric-sources";
import { parseSpotifyLyrics, within } from "../remote-lyrics";
import { readLyssnaLyrics } from "../lyssna-provider";
import { canSeed } from "./ttml-creator-model";

export { within } from "../remote-lyrics";

export async function readCreatorSongwriters(host: Host, track: Track, duration: number) {
  const apple = await within(readLyssnaLyrics(track, host.lookupIsrc, "apple_music", duration), 7000);
  if (apple?.songwriters?.length) return apple.songwriters;
  return within(host.lookupSongwriters(track.id, "lyricist"), 4500);
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
