import { transliterate } from "transliteration";
import type { Lyrics } from "./types";

export type RomanizeOptions = { below?: boolean };

const nonLatin = /[\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Devanagari}\p{Script=Thai}]/u;
const readText = (text: string) => nonLatin.test(text) ? transliterate(text).trim() || text : text;

export function romanizedLyrics(lyrics: Lyrics, _options: RomanizeOptions) {
  if (!lyrics.lines.some((line) => line.romanization || nonLatin.test(line.text) || line.words.some((word) => word.romanization))) return lyrics;
  return {
    ...lyrics,
    lines: lyrics.lines.map((line) => {
      const timed = line.words.some((word) => word.romanization);
      const words = timed ? line.words.map((word) => ({ ...word, text: word.romanization || word.text })) : [];
      const text = line.romanization || (timed ? words.map((word) => word.text).join("") : readText(line.text));
      if (text === line.text && !timed) return line;
      return text ? { ...line, text, words } : line;
    }),
  };
}

export function withReadings(lyrics: Lyrics, read: Lyrics): Lyrics {
  return read === lyrics ? lyrics : {
    ...lyrics,
    lines: lyrics.lines.map((line, index) => read.lines[index].text === line.text ? line : { ...line, reading: read.lines[index] }),
  };
}
