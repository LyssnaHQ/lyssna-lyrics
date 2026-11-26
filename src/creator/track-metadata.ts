import type { Host, Track as SpotifyTrack } from "../host";
import { within } from "../remote-lyrics";
import { normalizeIsrc } from "../spotify-track-metadata";
import type { MetaEntry, SongMeta } from "./ttml-creator-model";
import type { Track } from "./types";

export function creatorSpotifyTrack(track: Track): SpotifyTrack {
  return track.spotify ?? {
    id: track.id, title: track.name, artists: track.artists.map(({ name }) => name).join(", "),
    artistLinks: track.artists, album: track.album?.name, cover: track.album?.images[0]?.url ?? "",
    local: track.is_local ? true : undefined,
  };
}

export async function readCreatorTrackMetadata(host: Host, track: Track): Promise<Partial<SongMeta>> {
  if (track.is_local) return {};
  const spotify = creatorSpotifyTrack(track);
  const knownAlbum = spotify.albumUri ? within(host.lookupAlbum(spotify.albumUri), 4000) : undefined;
  const reply = await within(host.lookupTrack(track.id), 4000);
  const song = reply?.uri === track.uri ? reply : undefined;
  const albumUri = spotify.albumUri ?? song?.album?.uri;
  const [album, isrc] = await Promise.all([
    knownAlbum ?? (albumUri && /^spotify:album:/.test(albumUri) ? within(host.lookupAlbum(albumUri), 4000) : undefined),
    normalizeIsrc(spotify.isrc) ?? normalizeIsrc(song?.external_ids?.isrc) ?? within(host.lookupIsrc(track.id), 4500),
  ]);
  const release = { ...song?.album, ...album };
  const cover = release.images?.[0]?.url ?? spotify.cover;
  const fields = new Map<string, (string | number | undefined)[]>([
    ["isrc", [isrc]],
    ["spotifyAlbumId", [/^spotify:album:([A-Za-z0-9]{22})$/.exec(albumUri ?? "")?.[1]]],
    ["spotifyArtistId", (song?.artists ?? spotify.artistLinks ?? []).map(artist =>
      /^spotify:artist:([A-Za-z0-9]{22})$/.exec(artist.uri ?? "")?.[1])],
    ["albumArtists", release.artists?.map(({ name }) => name) ?? []],
    ["releaseDate", [release.release_date ?? spotify.year]],
    ["trackNumber", [song?.track_number || undefined]],
    ["discNumber", [song?.disc_number || undefined]],
    ["trackTotal", [release.total_tracks || undefined]],
    ["albumType", [release.album_type]],
    ["genres", release.genres ?? []],
    ["label", [release.label]],
    ["upc", [release.external_ids?.upc ?? spotify.albumUpc]],
    ["ean", [release.external_ids?.ean]],
    ["copyright", release.copyrights?.filter(({ type }) => type === "C").map(({ text }) => text) ?? []],
    ["phonographicCopyright", release.copyrights?.filter(({ type }) => type === "P").map(({ text }) => text) ?? []],
    ["explicit", [song?.explicit === undefined ? undefined : String(song.explicit)]],
    ["coverUrl", [cover.startsWith("https://") ? cover : undefined]],
  ]);
  const spotifyFields: MetaEntry[] = [];
  for (const [key, raw] of fields) {
    const values = [...new Set(raw.map((value) => value?.toString().trim()).filter((value): value is string => !!value))];
    if (values.length) spotifyFields.push({ key, values });
  }
  return {
    name: song?.name || track.name,
    artists: (song?.artists ?? track.artists).map(({ name }) => name).filter(Boolean),
    album: release.name || track.album?.name,
    durationMs: track.duration_ms || song?.duration_ms,
    spotifyFields,
  };
}
