import type { Track } from "./host";
import type { Line, Lyrics } from "./lyssna/types";
import { parseLocalTtml } from "./local-lyrics";
import { fromLrc } from "./lrc";

async function request(url: URL, signal: AbortSignal) {
  const response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", signal });
  return response.ok ? response : undefined;
}

export async function readLrcRed(track: Track, _duration: number, signal: AbortSignal) {
  if (!track.isrc || !/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(track.isrc)) return;
  const response = await request(new URL(`https://lrc.red/s/${track.isrc}.ttml`), signal);
  if (!response) return;
  const lyrics = parseLocalTtml(await response.text());
  return { ...lyrics, source: "lrc.red" };
}

export async function readLrcLib(track: Track, duration: number, signal: AbortSignal) {
  if (!track.title || !track.artist) return;
  const url = new URL("https://lrclib.net/api/get");
  url.searchParams.set("track_name", track.title);
  url.searchParams.set("artist_name", track.artist);
  if (track.album) url.searchParams.set("album_name", track.album);
  if (duration > 0) url.searchParams.set("duration", String(Math.floor(duration / 1000)));
  const response = await request(url, signal);
  if (!response) return;
  const result = await response.json() as { instrumental?: boolean; syncedLyrics?: string; plainLyrics?: string };
  if (result.instrumental === true) return { source: "LRCLIB", lines: [], synced: false, instrumental: true };
  return fromLrc("LRCLIB", result.syncedLyrics ?? "", result.plainLyrics ?? "", duration);
}

const neteaseBase = "https://music.xianqiao.wang/neteaseapiv2/";
const titleKey = (value = "") => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export async function readNetease(track: Track, duration: number, signal: AbortSignal) {
  if (!track.title || !track.artist) return;
  const lookup = new URL("search", neteaseBase);
  lookup.search = new URLSearchParams({ limit: "10", type: "1", keywords: `${track.title} ${track.artist}` }).toString();
  const response = await request(lookup, signal);
  if (!response) return;
  type Song = { id?: number; name?: string; duration?: number; album?: { name?: string } };
  const data = await response.json() as { result?: { songs?: Song[] } };
  const candidates = data.result?.songs?.filter((song) => titleKey(song.name) === titleKey(track.title)) ?? [];
  const match = candidates.find((song) => track.album && titleKey(song.album?.name) === titleKey(track.album))
    ?? candidates.find((song) => Math.abs((song.duration ?? 0) - duration) < 3000) ?? candidates[0];
  if (!match || !Number.isSafeInteger(match.id)) return;
  const url = new URL("lyric", neteaseBase);
  url.searchParams.set("id", String(match.id));
  const reply = await request(url, signal);
  if (!reply) return;
  const result = await reply.json() as { lrc?: { lyric?: string }; tlyric?: { lyric?: string } };
  const lyrics = fromLrc("Netease", result.lrc?.lyric ?? "", "", duration);
  if (!lyrics || !result.tlyric?.lyric) return lyrics;
  const translation = fromLrc("Netease", result.tlyric.lyric, "", duration);
  const aligned = new Map(translation?.lines.map((line) => [line.start_ms, line.text]));
  for (const line of lyrics.lines) line.translation = aligned.get(line.start_ms) ?? "";
  return lyrics;
}
export function parseSpotifyLyrics(response: unknown, duration: number): Lyrics | undefined {
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
