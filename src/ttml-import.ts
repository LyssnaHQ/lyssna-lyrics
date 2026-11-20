import type { Host, TtmlTrack, Track } from "./host";
import { loadLocalLyrics, saveLocalLyrics, type LoadMode } from "./local-lyrics";
import type { TransferLyrics } from "./lyssna/transfer-format";

export type BulkFile = { filename: string; file: File };
export type BulkLyric = { filename: string; song: TtmlTrack | null; query: string; error: string | null; invalid?: boolean };

const sizeLimit = 2_000_000;
const trackId = /^[A-Za-z0-9]{22}$/;
const amll = "http://www.example.com/ns/amll";

export const importError = (error: unknown) => error instanceof Error ? error.message : "Couldn’t load lyrics.";

async function readFile(file: File) {
  if (file.size > sizeLimit) throw new Error("Lyric file exceeds 2 MB.");
  if (!/\.(ttml|xml|lrc)$/i.test(file.name)) throw new Error("Choose a TTML, XML or LRC lyric file.");
  return { text: await file.text(), kind: /\.lrc$/i.test(file.name) ? "lrc" as const : "ttml" as const };
}

export async function importLyricFile(file: File, song: Track, mode: LoadMode, currentSong: () => string | undefined) {
  const input = await readFile(file);
  if (mode === "temporary" && currentSong() !== song.id) throw new Error("The song changed before the lyrics loaded.");
  await loadLocalLyrics({ ...input, uri: `spotify:track:${song.id}`, name: song.title, artists: song.artists, image: song.cover }, mode);
}

function readTtmlDocument(text: string) {
  if (/<!DOCTYPE/i.test(text)) throw new Error("TTML document types are unsupported.");
  const xml = new DOMParser().parseFromString(text, "application/xml");
  if (xml.documentElement.localName !== "tt" || xml.querySelector("parsererror")) {
    throw new Error("Choose a valid TTML lyrics file.");
  }
  return xml;
}

function spotifyId(value: string) {
  const id = value.trim().split(":").at(-1) ?? "";
  return trackId.test(id) ? id : undefined;
}

function songHint(filename: string, xml?: Document) {
  const stem = filename.replace(/\.[^.]+$/, "");
  const filenameId = stem.split(/[^a-z0-9]+/i).find((word) => trackId.test(word) && /[a-z]/i.test(word) && /\d/.test(word));
  const metadata = Array.from(xml?.getElementsByTagNameNS("*", "meta") ?? []);
  const values = (key: string) => metadata.filter((meta) => meta.getAttribute("key") === key)
    .map((meta) => meta.getAttribute("value")?.trim() ?? "").filter(Boolean);
  const title = values("musicName")[0];
  const rawIsrc = values("isrc")[0]?.replace(/-/g, "").toUpperCase();
  const isrc = rawIsrc && /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(rawIsrc) ? rawIsrc : undefined;
  const words = title ? [title, ...values("artists")].join(" ")
    : (filenameId ? stem.replace(filenameId, " ") : stem).replace(/ - |[_.]/g, " ");
  return { id: values("spotifyId").map(spotifyId).find(Boolean) ?? filenameId, isrc, query: words.trim().replace(/\s+/g, " ") };
}

function withSpotifyId(text: string, id: string) {
  const xml = readTtmlDocument(text);
  const root = xml.documentElement;
  if (Array.from(root.getElementsByTagNameNS("*", "meta"))
    .some((meta) => meta.getAttribute("key") === "spotifyId" && spotifyId(meta.getAttribute("value") ?? ""))) return text;
  const head = Array.from(root.children).find((child) => child.localName === "head") ?? xml.createElementNS(root.namespaceURI, "head");
  if (!head.parentNode) root.prepend(head);
  const metadata = Array.from(head.children).find((child) => child.localName === "metadata") ?? xml.createElementNS(root.namespaceURI, "metadata");
  if (!metadata.parentNode) head.prepend(metadata);
  const meta = xml.createElementNS(amll, "amll:meta");
  meta.setAttribute("key", "spotifyId");
  meta.setAttribute("value", id);
  metadata.append(meta);
  return new XMLSerializer().serializeToString(xml);
}

function savedFile(input: Awaited<ReturnType<typeof readFile>>, song: TtmlTrack): TransferLyrics {
  return { ...input, uri: song.uri, name: song.name, artists: song.artists.map(({ name }) => name).join(", "),
    image: song.album?.images?.at(-1)?.url,
    text: input.kind === "ttml" ? withSpotifyId(input.text, song.uri.slice("spotify:track:".length)) : input.text };
}

export async function attachBulkLyrics(file: BulkFile, songs: TtmlTrack[]) {
  const input = await readFile(file.file);
  await saveLocalLyrics(songs.map((song) => savedFile(input, song)));
}

export async function loadBulkLyrics(files: BulkFile[], host: Host, signal: AbortSignal) {
  const results: BulkLyric[] = [];
  const matches = new Map<string, TtmlTrack | undefined>();
  for (const { file, filename } of files) {
    signal.throwIfAborted();
    let input;
    let hint;
    try {
      input = await readFile(file);
      hint = songHint(filename, input.kind === "ttml" ? readTtmlDocument(input.text) : undefined);
    } catch (error) {
      results.push({ filename, song: null, query: "", error: importError(error), invalid: true });
      continue;
    }
    const result: BulkLyric = { filename, song: null, query: hint.query, error: null };
    results.push(result);
    const key = hint.id ? `track:${hint.id}` : hint.isrc && `isrc:${hint.isrc}`;
    if (!key) continue;
    try {
      if (!matches.has(key)) {
        const match = hint.id ? await host.lookupTrack(hint.id) : (await host.searchTracks(key, 1))[0];
        matches.set(key, match);
      }
      signal.throwIfAborted();
      const track = matches.get(key);
      if (!track) result.error = "Spotify didn’t find the song this file names.";
      else {
        await saveLocalLyrics([savedFile(input, track)]);
        result.song = track;
      }
    } catch (error) {
      signal.throwIfAborted();
      result.error = importError(error);
    }
  }
  return results;
}
