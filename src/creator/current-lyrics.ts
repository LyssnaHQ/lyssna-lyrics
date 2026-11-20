import type { Host, Track } from "../host";
import { readLyrics, type LyricSource } from "../lyric-sources";
import type { Line, Lyrics } from "../lyssna/types";
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

function parseSpotifyLyrics(response: unknown, duration: number): Lyrics | undefined {
  const lyrics = (response as { lyrics?: { syncType?: string; lines?: unknown[] } } | null)?.lyrics;
  if (!lyrics || !Array.isArray(lyrics.lines)) return;
  const synced = lyrics.syncType === "LINE_SYNCED";
  const lines: Line[] = [];
  for (const raw of lyrics.lines.slice(0, 2000)) {
    const row = raw as { words?: unknown; startTimeMs?: unknown } | null;
    const text = typeof row?.words === "string" ? row.words.trim() : "";
    if (!text || /^[\s♪♫♬]+$/u.test(text)) continue;
    const time = typeof row?.startTimeMs === "string" || typeof row?.startTimeMs === "number" ? Number(row.startTimeMs) : NaN;
    if (synced && (!Number.isFinite(time) || time < 0)) continue;
    lines.push({ text, start_ms: synced ? time : 0, end_ms: 0, words: [],
      translation: "", romanization: "", background: false, opposite: false });
  }
  if (!lines.length) return;
  if (synced) {
    lines.sort((a, b) => a.start_ms - b.start_ms);
    lines.forEach((line, index) => {
      line.end_ms = Math.max(line.start_ms, lines[index + 1]?.start_ms ?? (duration > line.start_ms ? duration : line.start_ms + 5000));
    });
  }
  return { source: "Spotify", synced, instrumental: false, lines };
}

export async function currentCreatorLyrics(host: Host, track: Track, duration: number, sources: LyricSource[]) {
  // Neither source may touch Spicy Lyrics when loading a Creator draft.
  const allowed = sources.filter((source) => source !== "spicy" && source !== "apple");
  const lyrics = await readLyrics(track, duration, allowed).catch(() => undefined);
  if (lyrics?.lines.length && canSeed(lyrics)) return lyrics;
  const response = await within(Promise.resolve().then(() => host.spotifyLyrics(track.id)), 7000);
  return parseSpotifyLyrics(response, duration);
}
