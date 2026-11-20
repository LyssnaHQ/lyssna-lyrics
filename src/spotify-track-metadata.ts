import type { TtmlTrack } from "./host";
import { fetchSpotifyMedia } from "./spotify-media";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const decoder = new TextDecoder();
const cache = new Map<string, Promise<Partial<TtmlTrack> | undefined>>();

export function normalizeIsrc(value?: string) {
  const isrc = value?.trim().replaceAll("-", "").toUpperCase();
  return isrc && /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc) ? isrc : undefined;
}

type NativeTrack = {
  name?: string;
  artist?: { name: string }[];
  number?: number;
  disc_number?: number;
  explicit?: boolean;
  external_id?: { type: string; id: string }[];
  album?: {
    name?: string;
    artist?: { name: string }[];
    type?: string;
    label?: string;
    date?: { year?: number; month?: number; day?: number };
    cover_group?: { image?: { file_id?: string; width?: number; height?: number }[] };
    external_id?: { type: string; id: string }[];
    copyright?: { type: string; text: string }[];
  };
};

function* fields(bytes: Uint8Array): Generator<[number, Uint8Array | number]> {
  let offset = 0;
  function varint() {
    let value = 0;
    for (let shift = 0; offset < bytes.length && shift < 70; shift += 7) {
      const byte = bytes[offset++];
      if (shift < 32) value |= (byte & 127) << shift;
      if (byte < 128) return value >>> 0;
    }
    throw new Error("Invalid Spotify metadata.");
  }
  while (offset < bytes.length) {
    const tag = varint();
    const number = tag >>> 3;
    switch (tag & 7) {
      case 0: yield [number, varint()]; break;
      case 1: offset += 8; break;
      case 2: {
        const length = varint();
        if (length > bytes.length - offset) throw new Error("Invalid Spotify metadata length.");
        const end = offset + length;
        yield [number, bytes.subarray(offset, end)];
        offset = end;
        break;
      }
      case 5: offset += 4; break;
      default: throw new Error("Unsupported Spotify metadata field.");
    }
  }
}

const fieldText = (field: Uint8Array | number | undefined) => field instanceof Uint8Array ? decoder.decode(field) : "";
const signed = (field: Uint8Array | number) => typeof field === "number" ? (field >>> 1) ^ -(field & 1) : undefined;

function fromProtobuf(bytes: Uint8Array): NativeTrack {
  const track: NativeTrack = { external_id: [], artist: [] };
  // spotify.metadata.Track uses field 10 for repeated ExternalId messages.
  for (const [number, field] of fields(bytes)) {
    if (number === 2) track.name = fieldText(field);
    if (number === 4 && field instanceof Uint8Array) {
      const artist = new Map(fields(field));
      track.artist!.push({ name: fieldText(artist.get(2)) });
    }
    if (number === 5) track.number = signed(field);
    if (number === 6) track.disc_number = signed(field);
    if (number === 9) track.explicit = field === 1;
    if (number === 10 && field instanceof Uint8Array) {
      const external = new Map(fields(field));
      track.external_id!.push({ type: fieldText(external.get(1)), id: fieldText(external.get(2)) });
    }
  }
  return track;
}

function normalize(raw: NativeTrack, id: string): Partial<TtmlTrack> {
  const album = raw.album;
  const date = album?.date;
  const release = date?.year && [date.year, date.month, date.month ? date.day : undefined]
    .filter(Boolean).map((part) => String(part).padStart(2, "0")).join("-");
  const albumId = (type: string) => album?.external_id?.find((entry) => entry.type?.toLowerCase() === type)?.id;
  return {
    uri: `spotify:track:${id}`, name: raw.name, artists: raw.artist?.filter(({ name }) => !!name),
    track_number: raw.number, disc_number: raw.disc_number, explicit: raw.explicit,
    external_ids: { isrc: normalizeIsrc(raw.external_id?.find(({ type }) => type?.toLowerCase() === "isrc")?.id) },
    album: album && {
      name: album.name, album_type: album.type?.toLowerCase(), label: album.label, release_date: release || undefined,
      artists: album.artist?.filter(({ name }) => !!name), copyrights: album.copyright,
      external_ids: { upc: albumId("upc"), ean: albumId("ean") },
      images: album.cover_group?.image?.flatMap(({ file_id, width, height }) => /^[a-f\d]{40}$/i.test(file_id ?? "")
        ? [{ url: `https://i.scdn.co/image/${file_id}`, width, height }] : []),
    },
  };
}

export function spotifyTrackMetadata(id: string) {
  if (!/^[A-Za-z0-9]{22}$/.test(id)) return Promise.resolve(undefined);
  const cached = cache.get(id);
  if (cached) return cached;
  const hex = [...id].reduce((value, digit) => value * 62n + BigInt(alphabet.indexOf(digit)), 0n).toString(16).padStart(32, "0");
  if (hex.length !== 32) return Promise.resolve(undefined);
  const pending = fetchSpotifyMedia(`/metadata/4/track/${hex}?market=from_token`, AbortSignal.timeout(4_000))
    .then(async (response) => {
      if (!response.ok) return;
      const content = response.headers.get("Content-Type") ?? "";
      const raw = content.includes("json") ? await response.json() as NativeTrack
        : fromProtobuf(new Uint8Array(await response.arrayBuffer()));
      return normalize(raw, id);
    }).catch(() => undefined).then((result) => {
      if (!result && cache.get(id) === pending) cache.delete(id);
      return result;
    });
  cache.set(id, pending);
  if (cache.size > 128) cache.delete(cache.keys().next().value!);
  return pending;
}
