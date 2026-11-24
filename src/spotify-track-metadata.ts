import type { TtmlTrack } from "./host";
import { fetchSpotifyMedia } from "./spotify-media";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const decoder = new TextDecoder();
type TrackMetadata = Partial<TtmlTrack> & { isrcs: string[] };
const cache = new Map<string, Promise<TrackMetadata | undefined>>();

export function normalizeIsrc(value?: string) {
  const isrc = value?.trim().replaceAll("-", "").toUpperCase();
  return isrc && /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc) ? isrc : undefined;
}

type NativeTrack = {
  name?: string;
  artist?: { name: string }[];
  number?: number;
  disc_number?: number;
  duration?: number;
  explicit?: boolean;
  external_id?: { type: string; id: string }[];
  alternative?: { external_id?: NativeTrack["external_id"] }[];
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

function readExternalId(bytes: Uint8Array) {
  const fieldsByNumber = new Map(fields(bytes));
  return { type: fieldText(fieldsByNumber.get(1)), id: fieldText(fieldsByNumber.get(2)) };
}

function fromProtobuf(bytes: Uint8Array): NativeTrack {
  const track: NativeTrack = { external_id: [], artist: [], alternative: [] };
  for (const [number, field] of fields(bytes)) {
    if (number === 2) track.name = fieldText(field);
    if (number === 4 && field instanceof Uint8Array) {
      const artist = new Map(fields(field));
      track.artist!.push({ name: fieldText(artist.get(2)) });
    }
    if (number === 5) track.number = signed(field);
    if (number === 6) track.disc_number = signed(field);
    if (number === 7) track.duration = signed(field);
    if (number === 9) track.explicit = field === 1;
    if (number === 10 && field instanceof Uint8Array) {
      track.external_id!.push(readExternalId(field));
    }
    if (number === 13 && field instanceof Uint8Array) {
      const externalIds = [];
      for (const [tag, value] of fields(field)) {
        if (tag === 10 && value instanceof Uint8Array) externalIds.push(readExternalId(value));
      }
      track.alternative!.push({ external_id: externalIds });
    }
  }
  return track;
}

function normalize(raw: NativeTrack, id: string): TrackMetadata {
  const album = raw.album;
  const date = album?.date;
  const release = date?.year && [date.year, date.month, date.month ? date.day : undefined]
    .filter(Boolean).map((part) => String(part).padStart(2, "0")).join("-");
  const albumId = (type: string) => album?.external_id?.find((entry) => entry.type?.toLowerCase() === type)?.id;
  const codes = (tracks: Pick<NativeTrack, "external_id">[]) => tracks.flatMap(track =>
    (track.external_id ?? []).flatMap(({ type, id }) => {
      const isrc = type?.toLowerCase() === "isrc" && normalizeIsrc(id);
      return isrc ? [isrc] : [];
    }),
  );
  const primary = codes([raw]);
  const isrcs = [...new Set([...primary, ...codes(raw.alternative ?? [])])];
  return {
    uri: `spotify:track:${id}`, name: raw.name, artists: raw.artist?.filter(({ name }) => !!name),
    duration_ms: raw.duration,
    track_number: raw.number, disc_number: raw.disc_number, explicit: raw.explicit,
    external_ids: { isrc: primary[0] }, isrcs,
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
