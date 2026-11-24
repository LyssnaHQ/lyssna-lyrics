import { useEffect, useState } from "react";
import type { Host, Track } from "./host";
import { lyssnaRequest } from "./lyssna-api";
import { localSongTags, spotifySongKey } from "./spotify-song";
import { normalizeIsrc } from "./spotify-track-metadata";

const matches = new Map<string, { until: number; result: Promise<string | undefined> }>();
const comparable = (name?: string) => (name ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

export function localTrackIsrc(track: Track, duration: number, host: Host) {
  const tagged = normalizeIsrc(track.isrc);
  if (tagged) return Promise.resolve(tagged);
  const tags = localSongTags(track.id);
  const title = track.title || tags?.title;
  const artist = track.artist || tags?.artist;
  const album = comparable(track.album || tags?.album);
  const length = Number.isFinite(duration) && duration > 0 ? duration : tags?.duration;
  if (!title || !artist || !length) return Promise.resolve(undefined);

  const key = JSON.stringify([track.id, title, artist, album, Math.round(length / 1000)]);
  const cached = matches.get(key);
  if (cached && Date.now() < cached.until) return cached.result;
  const fits = (name?: string, artists?: string[], ms?: number) =>
    comparable(name) === comparable(title) &&
    artists?.some(name => comparable(name) === comparable(artist)) &&
    typeof ms === "number" && Math.abs(ms - length) <= 2000;
  function uniqueCode(candidates: { album?: string; codes: (string | undefined)[] }[]) {
    const sameAlbum = album ? candidates.filter(candidate => comparable(candidate.album) === album) : [];
    const shortlist = sameAlbum.length ? sameAlbum : candidates;
    if (!shortlist.length || shortlist.length > 5) return;
    const codes = shortlist.flatMap(candidate => candidate.codes.length ? candidate.codes : [undefined]);
    const isrc = normalizeIsrc(codes[0]);
    if (isrc && codes.every(code => normalizeIsrc(code) === isrc)) return isrc;
  }

  async function find() {
    const query = `${title} ${artist}`;
    const tracks = await host.searchTracks(query, 10).catch(() => []);
    const candidates = tracks.filter(candidate => fits(candidate.name, candidate.artists.map(({ name }) => name), candidate.duration_ms));
    if (candidates.length) {
      const sameAlbum = album ? candidates.filter(candidate => comparable(candidate.album?.name) === album) : [];
      const shortlist = sameAlbum.length ? sameAlbum : candidates;
      if (shortlist.length > 5) return;
      return uniqueCode(await Promise.all(shortlist.map(async candidate => ({
        album: candidate.album?.name,
        codes: [await host.lookupIsrc(spotifySongKey(candidate.uri)!, candidate.external_ids?.isrc).catch(() => undefined)],
      }))));
    }
    const response = await lyssnaRequest(`/v1/tracks/resolve?${new URLSearchParams({ q: query })}`);
    if (!response?.ok) return;
    const result = await response.json() as {
      tracks?: { title?: string; artists?: string[]; album?: string; duration_ms?: number; isrcs?: string[] }[];
    };
    if (Array.isArray(result.tracks)) {
      return uniqueCode(result.tracks.filter(track => fits(track.title, track.artists, track.duration_ms))
        .map(track => ({ album: track.album, codes: track.isrcs ?? [] })));
    }
  }
  const entry = {
    until: Date.now() + 60_000,
    result: find().then(isrc => {
      if (isrc) entry.until = Date.now() + 30 * 60_000;
      return isrc;
    }).catch(() => undefined),
  };
  matches.set(key, entry);
  if (matches.size > 96) matches.delete(matches.keys().next().value!);
  return entry.result;
}

export function useLocalTrackIsrc(track: Track | null, duration: number, host: Host, enabled: boolean) {
  const [result, setResult] = useState<{ track: Track; isrc: string }>();
  useEffect(() => {
    if (!enabled || !track?.local || normalizeIsrc(track.isrc)) return;
    let active = true;
    let retry = 0;
    function resolve(song: Track) {
      void localTrackIsrc(song, duration, host).then(isrc => {
        if (!active) return;
        if (isrc) setResult({ track: song, isrc });
        else retry = window.setTimeout(() => resolve(song), 60_000);
      });
    }
    resolve(track);
    return () => { active = false; window.clearTimeout(retry); };
  }, [track, duration, host, enabled]);
  return normalizeIsrc(track?.isrc) ?? (result?.track === track ? result?.isrc : undefined);
}
