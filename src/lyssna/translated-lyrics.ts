import { useEffect, useMemo, useState } from "react";
import type { Lyrics } from "./types";

const endpoint = "https://translate.googleapis.com/translate_a/single";
const cache = new Map<string, { expires: number; request: Promise<Map<string, string>> }>();
let retryAt = 0;

const lineText = (text: string) => text.replace(/\s+/gu, " ").trim();

function targetLanguage() {
  const [language, region] = navigator.language.toLowerCase().split("-");
  if (language === "zh") return region === "tw" || region === "hk" || region === "hant" ? "zh-TW" : "zh-CN";
  return /^[a-z]{2,3}$/.test(language) ? language : "en";
}

function canTranslate(lyrics: Lyrics) {
  return !lyrics.instrumental && !lyrics.source.startsWith("Imported ") && lyrics.source !== "TTML Creator";
}

async function translateBatch(lines: string[], language: string) {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ client: "gtx", sl: "auto", tl: language, dt: "t", q: lines.join("\n") }).toString();
  const response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(8_000) });
  if (response.status === 429 || response.status >= 500) retryAt = Date.now() + 60_000;
  if (!response.ok) throw new Error("Lyric translation unavailable");
  const result: unknown = await response.json();
  const parts: unknown = Array.isArray(result) ? result[0] : undefined;
  if (!Array.isArray(parts)) return [];
  const joined = (column: 0 | 1) => parts.map(part => Array.isArray(part) && typeof part[column] === "string" ? part[column] : "")
    .join("").trim().split(/\r?\n/).map(lineText);
  const originals = joined(1);
  if (originals.length !== lines.length || originals.some((line, index) => line !== lines[index])) return [];
  return joined(0);
}

async function translate(lines: string[], language: string) {
  const batches: string[][] = [];
  let size = 0;
  let batch: string[] = [];
  for (const text of lines) {
    const length = new URLSearchParams({ q: text }).toString().length;
    if (batch.length && size + length > 6_000) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(text);
    size += length;
  }
  if (batch.length) batches.push(batch);

  const translated = new Map<string, string>();
  for (const lines of batches) {
    if (Date.now() < retryAt) break;
    const result = await translateBatch(lines, language).catch(() => undefined);
    if (!result) break;
    if (result.length !== lines.length) continue;
    lines.forEach((line, index) => {
      const reading = result[index];
      if (reading && reading.toLowerCase() !== line.toLowerCase()) translated.set(line, reading);
    });
  }
  return translated;
}

function readTranslation(lines: string[], language: string) {
  const key = JSON.stringify([language, lines]);
  const saved = cache.get(key);
  if (saved && saved.expires > Date.now()) return saved.request;
  const entry = { expires: Infinity, request: translate(lines, language).then(result => {
    entry.expires = Date.now() + (result.size ? 30 * 60_000 : 60_000);
    return result;
  }) };
  cache.set(key, entry);
  if (cache.size > 32) cache.delete(cache.keys().next().value!);
  return entry.request;
}

export function useTranslatedLyrics(lyrics: Lyrics | undefined, enabled: boolean) {
  const [result, setResult] = useState<{ original: Lyrics; translated: Lyrics }>();
  const missing = useMemo(() => enabled && lyrics && canTranslate(lyrics)
    ? [...new Set(lyrics.lines.filter(line => !line.translation?.trim()).map(line => lineText(line.text)))]
      .filter(text => text.length > 0 && text.length <= 500 && /\p{L}/u.test(text)).slice(0, 250)
    : [], [enabled, lyrics]);
  useEffect(() => {
    if (!lyrics || !missing.length) return;
    let active = true;
    void readTranslation(missing, targetLanguage()).then(translations => {
      if (!active || !translations.size) return;
      setResult({ original: lyrics, translated: { ...lyrics, lines: lyrics.lines.map(line => {
        if (line.translation?.trim()) return line;
        const translation = translations.get(lineText(line.text));
        return translation ? { ...line, translation } : line;
      }) } });
    });
    return () => { active = false; };
  }, [lyrics, missing]);
  return enabled && result && result.original === lyrics ? result.translated : lyrics;
}
