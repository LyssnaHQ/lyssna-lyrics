import type { Host, Track } from "./host";
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
  const entry = {
    until: Date.now() + 60_000,
    result: host.searchTracks(`${title} ${artist}`, 10).then(async tracks => {
      const candidates = tracks.filter(candidate => {
        const ms = candidate.duration_ms;
        return comparable(candidate.name) === comparable(title) &&
          candidate.artists.some(({ name }) => comparable(name) === comparable(artist)) &&
          typeof ms === "number" && Math.abs(ms - length) <= 2000;
      });
      const sameAlbum = album ? candidates.filter(candidate => comparable(candidate.album?.name) === album) : [];
      const shortlisted = sameAlbum.length ? sameAlbum : candidates;
      if (!shortlisted.length || shortlisted.length > 5) return;
      const codes = await Promise.all(shortlisted.map(candidate => {
        const id = spotifySongKey(candidate.uri);
        return id && host.lookupIsrc(id, candidate.external_ids?.isrc);
      }));
      const isrc = codes[0];
      if (isrc && codes.every(code => code === isrc)) {
        entry.until = Date.now() + 30 * 60_000;
        return isrc;
      }
    }).catch(() => undefined),
  };
  matches.set(key, entry);
  if (matches.size > 96) matches.delete(matches.keys().next().value!);
  return entry.result;
}
