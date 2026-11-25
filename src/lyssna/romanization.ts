import { useEffect, useState } from "react";
import { transliterate } from "transliteration";
import asset from "./romanization-asset.json";
import workerSource from "./romanization-worker.js?raw";
import type { Lyrics, Word } from "./types";

type RomanizedWord = Pick<Word, "text" | "start_ms" | "end_ms"> & { from: number | null; estimated: boolean };
type RomanizedLine = { text: string; words: RomanizedWord[] } | null;
type Request = {
  lines: { text: string; romanization: string; words: Word[]; romanization_words?: Word[] }[];
  options: { romaji_as_written: boolean };
};

const needsReading = /(?!\p{Script=Latin})\p{L}/u;
const pending = new Map<number, (lines: RomanizedLine[] | null) => void>();
let worker: Worker | undefined;
let timeout: ReturnType<typeof setTimeout> | undefined;
let requestId = 0;

function closeWorker() {
  worker?.terminate();
  worker = undefined;
  clearTimeout(timeout);
  for (const complete of pending.values()) complete(null);
  pending.clear();
}

function requestReadings(request: Request): Promise<RomanizedLine[] | null> {
  return new Promise(resolve => {
    try {
      if (!worker) {
        const url = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
        try { worker = new Worker(url); }
        finally { URL.revokeObjectURL(url); }
        worker.onmessage = ({ data }: MessageEvent<{ id: number; lines: RomanizedLine[] | null }>) => {
          if (!data.lines) return closeWorker();
          const complete = pending.get(data.id);
          pending.delete(data.id);
          complete?.(data.lines);
          if (!pending.size) {
            clearTimeout(timeout);
            timeout = setTimeout(closeWorker, 120_000);
          }
        };
        worker.onerror = closeWorker;
        worker.onmessageerror = closeWorker;
      }
      const id = ++requestId;
      pending.set(id, resolve);
      clearTimeout(timeout);
      timeout = setTimeout(closeWorker, 90_000);
      worker.postMessage({ id, request, asset });
    } catch {
      closeWorker();
      resolve(null);
    }
  });
}

function automaticFallback(text: string) {
  if (!needsReading.test(text)) return text;
  return text.replace(/\S(?:[\s\S]*\S)?/u, content => transliterate(content).trim() || content);
}

function suppliedWord(word: Word, text: string) {
  const reading = word.romanization;
  return reading?.trim() ? reading : text;
}

export async function romanizeLyrics(lyrics: Lyrics, romajiAsWritten = true): Promise<Lyrics> {
  if (!lyrics.lines.some(line => line.romanization_words?.length || line.romanization || needsReading.test(line.text) ||
      line.words.some(word => word.romanization || needsReading.test(word.text)))) return lyrics;

  const readings = await requestReadings({
    lines: lyrics.lines.map(line => ({
      text: line.text,
      romanization: line.words.some(word => word.romanization?.trim()) ? "" : line.romanization,
      romanization_words: line.romanization_words,
      words: line.words.map(({ text, start_ms, end_ms }) => ({ text, start_ms, end_ms })),
    })),
    options: { romaji_as_written: romajiAsWritten },
  });
  let changed = false;
  let estimated = !!lyrics.estimated_words;
  const lines = lyrics.lines.map((line, index) => {
    const converted = readings?.[index];
    const authoredWords = line.words.some(word => word.romanization?.trim());
    if (!converted && !authoredWords && readings) return line;

    const convertedWords = converted?.words.map(({ text, start_ms, end_ms, from, estimated: guess }): Word => {
      const source = from === null ? undefined : line.words[from];
      estimated ||= guess;
      return {
        ...source,
        text: source && !line.romanization_words?.length ? suppliedWord(source, text) : text,
        start_ms,
        end_ms,
        ...(guess ? { estimated: true } : {}),
      };
    });
    const words = convertedWords ?? (
      !readings && line.romanization && !authoredWords ? [] :
      line.words.map(word => ({ ...word, text: suppliedWord(word, readings ? word.text : automaticFallback(word.text)) }))
    );
    const text = words.length ? words.map(word => word.text).join("") :
      converted?.text ?? (line.romanization || automaticFallback(line.text));
    if (!text.trim() || (text === line.text && words.length === line.words.length &&
        words.every((word, i) => word.text === line.words[i].text))) return line;
    changed = true;
    return { ...line, text, words, romanization: "", romanization_words: undefined };
  });
  return changed ? { ...lyrics, lines, estimated_words: estimated } : lyrics;
}

const cache = [new WeakMap<Lyrics, Promise<Lyrics>>(), new WeakMap<Lyrics, Promise<Lyrics>>()];
const readings = new WeakMap<Lyrics, Lyrics>();
const letters = (text: string) => text.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const mostlyLatin = (text: string) => {
  const characters = text.match(/\p{L}/gu) ?? [];
  return characters.length > 0 && characters.filter(character => /\p{Script=Latin}/u.test(character)).length / characters.length >= 0.9;
};

function withReadings(lyrics: Lyrics, romanized: Lyrics) {
  if (lyrics === romanized) return lyrics;
  let result = readings.get(romanized);
  if (!result) {
    result = {
      ...lyrics,
      lines: lyrics.lines.map((line, index) => {
        const reading = romanized.lines[index];
        return reading && !mostlyLatin(line.text) && letters(line.text) !== letters(reading.text) ? { ...line, reading } : line;
      }),
    };
    readings.set(romanized, result);
  }
  return result;
}

export function useRomanizedLyrics(lyrics: Lyrics | undefined, enabled: boolean, below: boolean, romajiAsWritten: boolean) {
  const [ready, setReady] = useState<{ source: Lyrics; romajiAsWritten: boolean; result: Lyrics }>();
  useEffect(() => {
    if (!enabled || !lyrics) return;
    let active = true;
    const slot = cache[romajiAsWritten ? 0 : 1];
    let result = slot.get(lyrics);
    if (!result) {
      result = romanizeLyrics(lyrics, romajiAsWritten);
      slot.set(lyrics, result);
    }
    void result.then(result => {
      if (active) setReady({ source: lyrics, romajiAsWritten, result });
    }).catch(() => slot.delete(lyrics));
    return () => { active = false; };
  }, [lyrics, enabled, romajiAsWritten]);
  if (!enabled || !lyrics || ready?.source !== lyrics || ready.romajiAsWritten !== romajiAsWritten) return lyrics;
  return below ? withReadings(lyrics, ready.result) : ready.result;
}
