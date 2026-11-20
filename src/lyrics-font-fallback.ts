import { useEffect, useState } from "react";
import { getGlyphProbe, glyphProbeFamily } from "./fonts/glyph-probe-context";
import { fontFamily } from "./font-settings";
import type { Lyrics } from "./lyssna/types";
import { spotifyMix } from "./settings";

export async function needsDefaultLyricsFont(
  selectedFont: string,
  text: string,
  targetDocument: Document
): Promise<boolean> {
  const family = fontFamily(selectedFont);

  const characters = new Map<string, number>();
  let total = 0;
  for (const character of text.normalize("NFC")) {
    if (/[\p{White_Space}\p{Control}\p{Format}\p{Mark}]/u.test(character)) continue;
    characters.set(character, (characters.get(character) ?? 0) + 1);
    total++;
  }
  if (total === 0) return false;

  const context = await getGlyphProbe(targetDocument);
  if (!context) return false;
  const font = `700 48px ${family}`;
  try {
    await targetDocument.fonts.load(font, [...characters.keys()].join(""));
  } catch {
    // An unavailable face falls through to the blank probe, just like missing glyphs.
  }

  context.font = `700 48px ${glyphProbeFamily}`;
  context.font = `${font}, ${glyphProbeFamily}`;
  let unsupported = 0;
  for (const [character, count] of characters) {
    if (context.measureText(character).width === 0) unsupported += count;
    if (unsupported * 2 >= total) return true;
  }
  return false;
}

export function useDefaultLyricsFont(font: string | undefined, lyrics: Lyrics | undefined, page: Document) {
  const [fallback, setFallback] = useState<{ font: string; lyrics: Lyrics }>();
  useEffect(() => {
    if (!font || font === spotifyMix || !lyrics?.lines.length) return;
    let active = true;
    const text = lyrics.lines.map((line) => line.reading ? `${line.text}\n${line.reading.text}` : line.text).join("\n");
    void needsDefaultLyricsFont(font, text, page)
      .then((needed) => { if (active) setFallback(needed ? { font, lyrics } : undefined); }).catch(() => {});
    return () => { active = false; };
  }, [font, lyrics, page]);
  return !!fallback && fallback.font === font && fallback.lyrics === lyrics;
}
