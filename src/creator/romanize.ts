import { transliterate } from "transliteration";
import type { Lyrics } from "./types";

const script = /(?!\p{Script=Latin})\p{L}/u;
const reading = (text: string) => {
  if (!script.test(text)) return text;
  const leading = /^\s*/u.exec(text)?.[0] ?? "";
  return leading + (transliterate(text.trim()).trim() || text.trim());
};

export function romanizeCreatorLyrics(lyrics: Lyrics): Lyrics {
  return { ...lyrics, lines: lyrics.lines.map((line) => {
    const words = line.words.map((word) => ({ ...word, text: word.romanization || reading(word.text) }));
    return { ...line, words, text: words.length ? words.map((word) => word.text).join("") : line.romanization || reading(line.text) };
  }) };
}
