import { useEffect, useState } from "react";
import type { Host, Track } from "./host";
import { lyssnaRequest } from "./lyssna-api";
import { lyricsChanged } from "./local-lyrics";
import { localSongTags, spotifySongKey } from "./spotify-song";
import { normalizeIsrc, spotifyTrackMetadata } from "./spotify-track-metadata";

const matches = new Map<string, { until: number; result: Promise<string | undefined> }>();
const comparable = (name?: string) => (name ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const albumName = (name?: string) => comparable(name).replace(/\s+-\s+(single|ep)$/, "");
const matchPrefix = "lyssna-lyrics.local-isrc:";
const matchStorageKey = (trackId: string) => `${matchPrefix}${trackId}`;

export function hasSavedLocalTrackMatches() {
  try { return Object.keys(localStorage).some(key => key.startsWith(matchPrefix)); }
  catch { return false; }
}

function metadata(track: Track, duration: number) {
  const tags = localSongTags(track.id);
  const title = track.title || tags?.title;
  const artist = track.artist || tags?.artist;
  const album = albumName(track.album || tags?.album);
  const length = Number.isFinite(duration) && duration > 0 ? duration : tags?.duration;
  if (!title || !artist || !length) return;
  const key = JSON.stringify([track.id, comparable(title), comparable(artist), album, tags?.duration ?? Math.round(length)]);
  const fits = (name?: string, artists?: (string | undefined)[], ms?: number) =>
    comparable(name) === comparable(title) &&
    !!artists?.some(name => comparable(name) === comparable(artist)) &&
    typeof ms === "number" && Math.abs(ms - length) <= 2000;
  return { title, artist, album, key, length, fits };
}

type CatalogueTrack = {
  title?: string; artists?: string[]; album?: string; duration_ms?: number; isrcs?: string[];
};

async function resolveCatalogue(query: string) {
  const response = await lyssnaRequest(`/v1/tracks/resolve?${new URLSearchParams({ q: query })}`, { waitForInstall: true });
  if (response?.status === 404) return [];
  if (!response?.ok) throw new Error("The Lyssna catalogue is unavailable. Try again in a moment.");
  const result = await response.json() as { tracks?: CatalogueTrack[] };
  return Array.isArray(result.tracks) ? result.tracks : [];
}

export type LocalTrackSuggestion = {
  title: string;
  artists: string[];
  album?: string;
  duration: number;
  isrc: string;
};

export async function suggestLocalTrack(track: Track, duration: number): Promise<LocalTrackSuggestion | undefined> {
  const details = metadata(track, duration);
  if (!details) return;
  const results = await resolveCatalogue(`${details.title} ${details.artist}`);
  const tokens = (value: string) => comparable(value).match(/[\p{L}\p{N}]+/gu) ?? [];
  const titleWords = [...new Set(tokens(details.title))];
  const ranked = results.flatMap(item => {
    const { title, artists, album, duration_ms: length } = item;
    const isrcs = [...new Set(item.isrcs?.map(normalizeIsrc).filter(Boolean))];
    const isrc = isrcs[0];
    if (!title || !artists?.length || !length || !isrc || isrcs.length !== 1) return [];
    const words = new Set(tokens(title));
    const shared = titleWords.filter(word => words.has(word)).length;
    const sameArtist = artists.some(name => comparable(name) === comparable(details.artist));
    const sameTitle = comparable(title) === comparable(details.title);
    if (!sameTitle && !sameArtist && !shared) return [];
    const sameAlbum = !!details.album && albumName(album) === details.album;
    const gap = Math.abs(length - details.length);
    const titleOverlap = shared / Math.max(words.size, titleWords.length, 1);
    const score = Number(sameTitle) * 4 + Number(sameArtist) * 4 + Number(sameAlbum)
      + titleOverlap * 3 + Math.max(0, 1 - gap / 30_000);
    return [{ suggestion: { title, artists, album, duration: length, isrc }, score, gap }];
  });
  return ranked.sort((left, right) => right.score - left.score || left.gap - right.gap)[0]?.suggestion;
}

function saveLocalTrackMatch(track: Track, key: string, isrc: string) {
  localStorage.setItem(matchStorageKey(track.id), JSON.stringify({ key, isrc }));
  window.dispatchEvent(new CustomEvent(lyricsChanged, { detail: [track.id] }));
}

export function savedLocalTrackIsrc(track: Track, duration: number) {
  const tagged = normalizeIsrc(track.isrc);
  if (tagged) return tagged;
  const details = metadata(track, duration);
  if (!details) return;
  try {
    const saved = JSON.parse(localStorage.getItem(matchStorageKey(track.id)) ?? "null") as { key?: string; isrc?: string } | null;
    if (saved?.key === details.key) return normalizeIsrc(saved.isrc);
  } catch { /* Search when a saved match cannot be read. */ }
}

export function confirmLocalTrackIsrc(track: Track, duration: number, code: string) {
  const details = metadata(track, duration);
  const isrc = normalizeIsrc(code);
  if (!track.local || !details || !isrc) throw new Error("Couldn’t save this recording match.");
  saveLocalTrackMatch(track, details.key, isrc);
}

export async function matchLocalTrackIsrc(track: Track, duration: number, value: string, host: Host) {
  const details = metadata(track, duration);
  if (!track.local || !details) throw new Error("The local file needs a title, artist, and duration to verify a match.");
  const input = value.trim();
  const isrc = normalizeIsrc(input);
  const link = /^(?:spotify:|https:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?)(track|album)[:/]([A-Za-z0-9]{22})(?:[?#].*)?$/i.exec(input);
  const trackId = /^[A-Za-z0-9]{22}$/.test(input) ? input : link?.[1].toLowerCase() === "track" ? link[2] : undefined;
  const albumId = link?.[1].toLowerCase() === "album" ? link[2] : undefined;
  if (albumId) {
    const match = await albumTrackIsrc(`spotify:album:${albumId}`, details, host);
    if (!match) throw new Error("Couldn’t find a single matching recording on this album.");
    return saveLocalTrackMatch(track, details.key, match);
  }
  if (!isrc && !trackId) throw new Error("Enter an ISRC, Spotify track link, or Spotify album link.");
  const results = await resolveCatalogue(isrc ?? trackId!).catch(error => {
    if (trackId) return [];
    throw error;
  });
  const codes = new Set(results.filter(item => details.fits(item.title, item.artists, item.duration_ms))
    .flatMap(item => (item.isrcs ?? []).map(normalizeIsrc)).filter(Boolean));
  let match = isrc ? codes.has(isrc) && isrc : codes.size === 1 && [...codes][0];
  if (!match && trackId && !codes.size) {
    const original = await spotifyTrackMetadata(trackId);
    if (original && details.fits(original.name, original.artists?.map(({ name }) => name), original.duration_ms)) {
      match = normalizeIsrc(original.external_ids?.isrc);
    }
  }
  if (!match && isrc) return { unverifiedIsrc: isrc };
  if (!match) throw new Error("Couldn’t verify a single ISRC for this title, artist, and duration.");
  saveLocalTrackMatch(track, details.key, match);
}

async function albumTrackIsrc(uri: string, details: NonNullable<ReturnType<typeof metadata>>, host: Host) {
  const albumTracks = await host.albumTracks(uri);
  const ids = [...new Set(albumTracks.filter(item =>
    details.fits(item.name, item.artists.map(({ name }) => name), item.duration_ms))
    .map(item => spotifySongKey(item.uri)))];
  if (!ids.length || ids.length > 5 || ids.some(id => !id)) return;
  const codes = await Promise.all(ids.map(id => host.lookupIsrc(id!).catch(() => undefined)));
  const match = normalizeIsrc(codes[0]);
  if (match && codes.every(code => normalizeIsrc(code) === match)) return match;
}

export function localTrackIsrc(track: Track, duration: number, host: Host) {
  const tagged = normalizeIsrc(track.isrc);
  const details = metadata(track, duration);
  if (tagged) {
    if (details) rememberLocalTrackIsrc(track.id, details.key, tagged);
    return Promise.resolve(tagged);
  }
  const saved = savedLocalTrackIsrc(track, duration);
  if (saved) return Promise.resolve(saved);
  if (!details) return Promise.resolve(undefined);
  const { title, artist, album, key, fits } = details;
  const cached = matches.get(key);
  if (cached && Date.now() < cached.until) return cached.result;
  function shortlist<T>(candidates: T[], albums: (candidate: T) => (string | undefined)[]) {
    const sameAlbum = album ? candidates.filter(candidate => albums(candidate).some(name => albumName(name) === album)) : [];
    return sameAlbum.length ? sameAlbum : candidates;
  }
  function uniqueCode(candidates: (string | undefined)[][]) {
    if (!candidates.length || candidates.length > 5) return;
    const codes = candidates.flatMap(candidate => candidate.length ? candidate : [undefined]);
    const isrc = normalizeIsrc(codes[0]);
    if (isrc && codes.every(code => normalizeIsrc(code) === isrc)) return isrc;
  }

  async function find() {
    const query = `${title} ${artist}`;
    const tracks = await host.searchTracks(query, 10).catch(() => []);
    const candidates = tracks.filter(candidate => fits(candidate.name, candidate.artists.map(({ name }) => name), candidate.duration_ms));
    if (candidates.length) {
      const selected = shortlist(candidates, candidate => [candidate.album?.name]);
      if (selected.length > 5) return;
      const codes = await Promise.all(selected.map(async candidate =>
        [await host.lookupIsrc(spotifySongKey(candidate.uri)!, candidate.external_ids?.isrc).catch(() => undefined)]));
      if (codes.some(candidate => candidate[0])) return uniqueCode(codes);
    }
    const catalogue = (await resolveCatalogue(query).catch(() => []))
      .filter(item => fits(item.title, item.artists, item.duration_ms));
    const selected = shortlist(catalogue, item => [item.album]);
    if (selected.some(item => item.isrcs?.length)) return uniqueCode(selected.map(item => item.isrcs ?? []));
    if (track.albumUri && /^spotify:album:[A-Za-z0-9]{22}$/.test(track.albumUri)) {
      const code = await albumTrackIsrc(track.albumUri, details!, host).catch(() => undefined);
      if (code) return code;
    }

    const escape = (value: string) => value.replace(/[\\"]/g, "\\$&");
    const params = new URLSearchParams({
      query: `recording:"${escape(title)}" AND artist:"${escape(artist)}" AND isrc:[* TO *]`,
      fmt: "json", limit: "15",
    });
    const response = await fetch(`https://musicbrainz.org/ws/2/recording?${params}`, {
      credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return;
    const data = await response.json() as {
      recordings?: {
        title?: string; length?: number; isrcs?: string[];
        "artist-credit"?: { name?: string; artist?: { name?: string } }[];
        releases?: { title?: string }[];
      }[];
    };
    const recordings = (data.recordings ?? []).filter(item => fits(item.title,
      item["artist-credit"]?.flatMap(credit => [credit.name, credit.artist?.name]), item.length));
    return uniqueCode(shortlist(recordings, item => item.releases?.map(release => release.title) ?? [])
      .map(item => item.isrcs ?? []));
  }
  const entry = {
    until: Date.now() + 60_000,
    result: find().then(isrc => {
      if (isrc) {
        entry.until = Date.now() + 30 * 60_000;
        const chosen = savedLocalTrackIsrc(track, duration);
        if (chosen) return chosen;
        rememberLocalTrackIsrc(track.id, key, isrc);
      }
      return isrc;
    }).catch(() => undefined),
  };
  matches.set(key, entry);
  if (matches.size > 96) matches.delete(matches.keys().next().value!);
  return entry.result;
}

function rememberLocalTrackIsrc(id: string, key: string, isrc: string) {
  try {
    const value = JSON.stringify({ key, isrc });
    const storageKey = matchStorageKey(id);
    if (localStorage.getItem(storageKey) !== value) localStorage.setItem(storageKey, value);
  } catch { /* The current match remains usable when storage is unavailable. */ }
}

export function useLocalTrackIsrc(track: Track | null, duration: number, host: Host, enabled: boolean) {
  const [result, setResult] = useState<{ track: Track; isrc: string }>();
  useEffect(() => {
    if (!enabled || !track?.local || normalizeIsrc(track.isrc)) return;
    let generation = 0;
    let retry = 0;
    function resolve(song: Track) {
      window.clearTimeout(retry);
      const request = ++generation;
      void localTrackIsrc(song, duration, host).then(isrc => {
        if (request !== generation) return;
        if (isrc) setResult({ track: song, isrc });
        else retry = window.setTimeout(() => resolve(song), 60_000);
      });
    }
    const onLyrics = (event: Event) => {
      const ids = (event as CustomEvent<string[] | undefined>).detail;
      if (Array.isArray(ids) && track && ids.includes(track.id)) resolve(track);
    };
    resolve(track);
    window.addEventListener(lyricsChanged, onLyrics);
    return () => {
      generation++;
      window.clearTimeout(retry);
      window.removeEventListener(lyricsChanged, onLyrics);
    };
  }, [track, duration, host, enabled]);
  return normalizeIsrc(track?.isrc) ?? (result?.track === track ? result?.isrc : undefined);
}
