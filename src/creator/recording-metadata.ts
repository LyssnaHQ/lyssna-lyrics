import type { Host, Track } from "../host";
import { spotifySongUri } from "../spotify-song";
import { within } from "./current-lyrics";
import type { SavedRecording } from "./captured-replay";
import { downloadRecording, type RecordingFormat } from "./recording-export";
import { formatTime } from "./ttml-creator-model";

type Tag = { name: string; value: string; id3?: string; riff?: string };
type Cover = { blob: Blob; type: "image/jpeg" | "image/png" };
export type RecordingMetadata = { tags: Tag[]; cover?: Cover };

export async function exportSavedAudio(host: Host, track: Track, recording: SavedRecording, format: RecordingFormat, writers?: string[]) {
  const metadata = await readRecordingMetadata(host, track, writers);
  const title = [metadata.tags.find(({ name }) => name === "TITLE")?.value,
    metadata.tags.find(({ name }) => name === "ARTIST")?.value].filter(Boolean).join(" - ");
  const name = recording.full ? title : `${title} [${formatTime(recording.startMs)}–${formatTime(recording.endMs)}]`;
  await downloadRecording(recording.blob, name, format, metadata);
}

function spotifyUrl(uri: string | undefined, type: "track" | "album") {
  const [scheme, kind, id] = (uri ?? "").split(":");
  return scheme === "spotify" && kind === type && /^[A-Za-z0-9]{22}$/.test(id ?? "")
    ? `https://open.spotify.com/${type}/${id}` : undefined;
}

async function fetchCover(url: string): Promise<Cover | undefined> {
  try {
    if (new URL(url).protocol !== "https:") return;
    const response = await fetch(url, { credentials: "omit", signal: AbortSignal.timeout(4000) });
    if (!response.ok) return;
    const blob = await response.blob();
    if (blob.size > 8 * 1024 * 1024) return;
    const bytes = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { blob, type: "image/jpeg" };
    if (bytes.length === 8 && new DataView(bytes.buffer).getBigUint64(0) === 0x89504e470d0a1a0an) return { blob, type: "image/png" };
  } catch {
    // Keep the text metadata if the image server is unavailable.
  }
}

export async function readRecordingMetadata(host: Host, track: Track, writers?: string[]): Promise<RecordingMetadata> {
  const albumRequest = track.albumUri ? within(host.lookupAlbum(track.albumUri), 4000) : undefined;
  const song = await within(host.lookupTrack(track.id), 4000);
  const albumUri = song?.album?.uri ?? track.albumUri;
  const album = await (albumRequest ?? (albumUri ? within(host.lookupAlbum(albumUri), 4000) : undefined));
  const date = album?.release_date || song?.album?.release_date || track.year ||
    (albumUri ? await within(host.releaseYear(albumUri), 3000) : undefined);
  const albumType = album?.album_type || song?.album?.album_type;
  const tags: Tag[] = [];
  function add(name: string, value: string | number | undefined, id3?: string, riff?: string) {
    const text = value?.toString().replaceAll("\0", "").trim();
    if (text) tags.push({ name, value: text, id3, riff });
  }
  add("TITLE", song?.name || track.title, "TIT2", "INAM");
  add("ARTIST", song?.artists.map(({ name }) => name).filter(Boolean).join(", ") || track.artists, "TPE1", "IART");
  add("ALBUM", album?.name || song?.album?.name || track.album, "TALB", "IPRD");
  add("ALBUMARTIST", (album?.artists ?? song?.album?.artists)?.map(({ name }) => name).filter(Boolean).join(", "), "TPE2");
  add("DATE", date, "TDRC", "ICRD");
  add("TRACKNUMBER", song?.track_number || undefined, "TRCK", "ITRK");
  add("DISCNUMBER", song?.disc_number || undefined, "TPOS");
  add("TRACKTOTAL", album?.total_tracks || song?.album?.total_tracks);
  add("GENRE", album?.genres?.join("; "), "TCON", "IGNR");
  add("SONGWRITER", writers?.join(", "));
  add("LABEL", album?.label, "TPUB");
  add("COPYRIGHT", album?.copyrights?.filter(({ type }) => type === "C").map(({ text }) => text).join("; "), "TCOP", "ICOP");
  add("PHONOGRAPHIC_COPYRIGHT", album?.copyrights?.filter(({ type }) => type === "P").map(({ text }) => text).join("; "));
  add("ALBUMTYPE", albumType);
  add("COMPILATION", albumType === "compilation" ? "1" : undefined, "TCMP");
  add("ISRC", song?.external_ids?.isrc || track.isrc, "TSRC");
  add("UPC", album?.external_ids?.upc || track.albumUpc);
  add("EAN", album?.external_ids?.ean);
  add("EXPLICIT", song?.explicit === undefined ? undefined : song.explicit ? "1" : "0");
  add("SPOTIFY_TRACK_URL", spotifyUrl(song?.uri ?? spotifySongUri(track.id), "track"), "WOAS");
  add("SPOTIFY_ALBUM_URL", spotifyUrl(albumUri, "album"));

  const images = [...(album?.images ?? []), ...(song?.album?.images ?? [])];
  const size = (image: (typeof images)[number]) => image.width ?? image.height ?? 0;
  images.sort((a, b) => size(b) - size(a));
  const coverUrl = images.find(({ url }) => url)?.url;
  const cover = (coverUrl && await fetchCover(coverUrl)) ||
    (track.cover && track.cover !== coverUrl ? await fetchCover(track.cover) : undefined);
  return { tags, cover: cover || undefined };
}
