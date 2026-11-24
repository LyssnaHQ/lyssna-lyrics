import type { Line, Lyrics, Word } from "./lyssna/types";
import type { TransferLyrics } from "./lyssna/transfer-format";
import { fromLrc } from "./lrc";
import { voicesOf } from "./creator/song-parts";
import { spotifySongKey, spotifySongUri } from "./spotify-song";

export const lyricsChanged = "lyssna-lyrics:lyrics";
export type LoadMode = "persistent" | "temporary" | "session";
const session = new Map<string, TransferLyrics>();
let temporary: TransferLyrics | undefined;
let database: Promise<IDBDatabase> | undefined;

function openDatabase() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("lyssna-lyrics-local", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("ttml", { keyPath: "uri" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
}

async function read<T>(get: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = get(db.transaction("ttml").objectStore("ttml"));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function write(change: (store: IDBObjectStore) => void) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("ttml", "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Could not save lyrics."));
    change(transaction.objectStore("ttml"));
  });
}

function timestamp(value: string | null): number | undefined {
  value = value?.trim() || null;
  if (!value) return;
  const unit = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(value);
  if (unit) {
    const factors = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
    const time = Number(unit[1]) * factors[(unit[2] as keyof typeof factors) || "s"];
    return time <= 604_800_000 ? Math.round(time) : undefined;
  }
  const clock = /^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)$/.exec(value);
  if (clock) {
    const time = (Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3])) * 1000;
    return time <= 604_800_000 ? Math.round(time) : undefined;
  }
}

const attribute = (element: Element, name: string) => Array.from(element.attributes).find((attribute) => attribute.localName === name)?.value;
const role = (element: Element) => attribute(element, "role") ?? "";

function backgroundWrapper(text: string) {
  const pair = ["()", "[]", "（）", "［］"].find(([first, last]) => text.startsWith(first) && text.endsWith(last));
  if (!pair) return;
  const [first, last] = pair;
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === first) depth++;
    else if (text[index] === last) {
      depth--;
      if (depth === 0 && index !== text.length - 1) return;
    }
  }
  if (depth === 0) return { first, last };
}

function lyricLine(element: Element, start: number, end: number, background: boolean, opposite: boolean,
  voiceOf: (agent?: string) => Word["sung_by"], agent?: string): Line {
  let text = "";
  let translation = "";
  let romanization = "";
  const words: Word[] = [];
  function collect(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = (node.nodeValue ?? "").replace(/\s+/g, " ");
      text += value;
      if (words.length) words[words.length - 1].text += value;
    } else if (node instanceof Element && role(node) !== "x-bg") {
      const annotation = role(node);
      if (annotation.includes("translation") && !annotation.includes("transliteration")) {
        translation = node.textContent?.trim() ?? "";
        return;
      }
      if (annotation.includes("roman") || annotation.includes("transliteration")) {
        romanization = node.textContent?.trim() ?? "";
        return;
      }
      const begin = timestamp(node.getAttribute("begin"));
      if (begin !== undefined && node.localName === "span" && !node.querySelector("[begin]")) {
        const value = node.textContent ?? "";
        text += value;
        const wordAgent = attribute(node, "agent");
        const sung_by = wordAgent && wordAgent !== agent ? voiceOf(wordAgent) : undefined;
        words.push({ text: value, start_ms: begin, end_ms: Math.max(begin, timestamp(node.getAttribute("end")) ?? end),
          ...(sung_by && { sung_by }) });
      } else if (node.localName === "br") {
        text += " ";
        if (words.length) words[words.length - 1].text += " ";
      } else node.childNodes.forEach(collect);
    }
  }
  element.childNodes.forEach(collect);
  text = text.trim();
  if (background) {
    const wrapper = backgroundWrapper(text);
    if (wrapper) {
      text = text.slice(1, -1).trim();
      const first = words.find((word) => word.text.trim());
      const last = words.findLast((word) => word.text.trim());
      if (first?.text.trimStart().startsWith(wrapper.first)) first.text = first.text.trimStart().slice(1);
      if (last?.text.trimEnd().endsWith(wrapper.last)) last.text = last.text.trimEnd().slice(0, -1);
    }
    if (backgroundWrapper(romanization)) romanization = romanization.slice(1, -1).trim();
  }
  const voice = voiceOf(agent);
  const startAt = words[0]?.start_ms ?? start;
  return {
    text, words: background ? words.filter((word) => word.text.trim()) : words,
    start_ms: startAt, end_ms: Math.max(startAt, end, words.at(-1)?.end_ms ?? 0),
    background, opposite, translation, romanization,
    ...(voice && voice !== "first" && { sung_by: voice }),
  };
}

export function parseLocalTtml(text: string, recordingDuration?: number): Lyrics {
  if (/<!DOCTYPE/i.test(text)) throw new Error("TTML document types are unsupported.");
  const xml = new DOMParser().parseFromString(text, "application/xml");
  const body = xml.getElementsByTagNameNS("*", "body")[0];
  if (xml.documentElement.localName !== "tt" || !body || xml.querySelector("parsererror")) {
    throw new Error("Choose a valid TTML lyrics file.");
  }
  const bodyDuration = recordingDuration ? timestamp(body.getAttribute("dur")) : undefined;
  if (recordingDuration && bodyDuration !== undefined && Math.abs(bodyDuration - recordingDuration) > 10_000) {
    throw new RangeError("This TTML is timed to a different recording.");
  }
  const paragraphs = Array.from(body.getElementsByTagNameNS("*", "p"));
  const agents = Array.from(xml.getElementsByTagNameNS("*", "agent"));
  const lead = agents.find((agent) => attribute(agent, "type") === "person");
  const names = new Map(agents.map(agent => [
    attribute(agent, "id"), agent.getElementsByTagNameNS("*", "name")[0]?.textContent?.trim(),
  ]));
  const leadId = lead ? attribute(lead, "id") ?? "v1" : "v1";
  const annotations = new Map<string, { translation?: string; romanization?: string }>();
  for (const entry of Array.from(xml.getElementsByTagNameNS("*", "text"))) {
    const key = attribute(entry, "for");
    const kind = entry.parentElement?.localName;
    if (!key || (kind !== "translation" && kind !== "transliteration")) continue;
    const data = annotations.get(key) ?? {};
    data[kind === "translation" ? "translation" : "romanization"] = entry.textContent?.trim() ?? "";
    annotations.set(key, data);
  }
  let previousSection: Element | null = null;
  const groups = paragraphs.map((element, index) => {
    const firstWord = element.querySelector("span[begin]");
    const start = timestamp(element.getAttribute("begin")) ?? timestamp(firstWord?.getAttribute("begin") ?? null) ?? 0;
    const next = paragraphs[index + 1]?.getAttribute("begin") ?? null;
    const duration = timestamp(element.getAttribute("dur"));
    const end = timestamp(element.getAttribute("end")) ?? (duration === undefined ? timestamp(next) ?? start + 2_000 : start + duration);
    const agent = attribute(element, "agent");
    const opposite = Boolean(agent && agent !== leadId && !agent.endsWith("000"));
    const section = element.closest("div");
    const singer = section && attribute(section, "singer");
    const voices = singer ? voicesOf(singer) : [];
    const voiceOf = (id?: string): Word["sung_by"] => {
      if (!id || voices.length < 2) return;
      const index = id === "v1000" ? voices.findIndex(voice => voice.includes(" & "))
        : voices.findIndex(voice => voice.toLowerCase() === names.get(id)?.toLowerCase());
      return (["first", "second", "third"] as const)[index];
    };
    const main = lyricLine(element, start, end, role(element) === "x-bg", opposite, voiceOf, agent);
    const data = annotations.get(attribute(element, "key") ?? "");
    main.translation ||= data?.translation ?? "";
    main.romanization ||= data?.romanization ?? "";
    const background = Array.from(element.getElementsByTagNameNS("*", "span"))
      .filter((vocal) => role(vocal) === "x-bg")
      .map((vocal) => lyricLine(vocal, timestamp(vocal.getAttribute("begin")) ?? start,
        timestamp(vocal.getAttribute("end")) ?? end, true, opposite, voiceOf, attribute(vocal, "agent") ?? agent));
    const result = [main, ...background].filter((line) => line.text);
    const part = section && attribute(section, "songPart");
    if (result.length && section !== previousSection) {
      previousSection = section;
      if (part) {
        result[0].section = part;
        if (singer) result[0].section_singer = singer;
      }
    }
    const timed = result.filter(line => line.words.length);
    const order = timed.length ? Math.min(...timed.map(line => line.words[0].start_ms)) : start;
    return { order, lines: result };
  });
  const lines = groups.sort((a, b) => a.order - b.order).flatMap(group => group.lines);
  if (!lines.length) throw new Error("No lyric lines found in this TTML file.");
  const songwriters = Array.from(xml.getElementsByTagNameNS("*", "songwriter")).map((writer) => writer.textContent?.trim() ?? "").filter(Boolean).slice(0, 100);
  return { lines, songwriters, source: "Imported TTML", synced: paragraphs.some((line) => line.hasAttribute("begin") || line.querySelector("[begin]")), instrumental: false };
}

export function listLocalLyrics(): Promise<TransferLyrics[]> {
  return read((store) => store.getAll());
}

function readImport(entry: TransferLyrics, duration: number) {
  if (entry.kind === "ttml") return parseLocalTtml(entry.text);
  if (entry.kind === "lrc") {
    const plain = entry.text.replace(/^\s*\[[a-z]+:[^\]\r\n]*\][\t ]*$/gim, "");
    const result = fromLrc("Imported LRC", entry.text, plain, duration);
    if (result) return result;
  }
  throw new Error("Choose a TTML or LRC file with lyric lines.");
}

export async function readLocalLyrics(trackId: string, duration: number) {
  const uri = spotifySongUri(trackId);
  const entry = (temporary?.uri === uri ? temporary : session.get(uri)) ??
    await read<TransferLyrics | undefined>((store) => store.get(uri));
  return entry && readImport(entry, duration);
}

export function hasTemporaryTtml(trackId?: string) {
  return !!trackId && temporary?.kind === "ttml" && temporary.uri === spotifySongUri(trackId);
}

function validateImport(entry: TransferLyrics) {
  if (!spotifySongKey(entry.uri) || new TextEncoder().encode(entry.text).length > 2_000_000) {
    throw new Error("Choose a TTML or LRC file under 2 MB for a Spotify track.");
  }
  readImport(entry, 0);
}

const notify = (uris: string[]) => window.dispatchEvent(new CustomEvent(lyricsChanged, {
  detail: uris.map(spotifySongKey),
}));

export function clearTemporaryLyrics(trackId?: string) {
  if (!trackId || temporary?.uri === spotifySongUri(trackId)) temporary = undefined;
}

export function keepTemporaryLyricsFor(trackId?: string) {
  if (temporary && (!trackId || temporary.uri !== spotifySongUri(trackId))) temporary = undefined;
}

export async function saveLocalLyrics(entries: TransferLyrics[]) {
  entries.forEach(validateImport);
  await write((store) => { for (const entry of entries) store.put(entry); });
  for (const entry of entries) {
    session.delete(entry.uri);
    if (temporary?.uri === entry.uri) temporary = undefined;
  }
  notify(entries.map(({ uri }) => uri));
}

export async function loadLocalLyrics(entry: TransferLyrics, mode: LoadMode) {
  if (mode === "persistent") return saveLocalLyrics([entry]);
  validateImport(entry);
  if (mode === "temporary") temporary = entry;
  else {
    session.set(entry.uri, entry);
    if (temporary?.uri === entry.uri) temporary = undefined;
  }
  notify([entry.uri]);
}

export async function removeLocalLyrics(uri: string, reset = false) {
  await write((store) => { store.delete(uri); });
  if (reset) {
    session.delete(uri);
    if (temporary?.uri === uri) temporary = undefined;
  }
  notify([uri]);
}

export function downloadTtml(entry: TransferLyrics) {
  const url = URL.createObjectURL(new Blob([entry.text], { type: entry.kind === "ttml" ? "application/ttml+xml" : "text/plain" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  const name = [entry.name || entry.uri, entry.artists].filter(Boolean).join(" - ");
  anchor.download = `${name.replace(/[<>:"/\\|?*]/g, "_")}.${entry.kind}`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
