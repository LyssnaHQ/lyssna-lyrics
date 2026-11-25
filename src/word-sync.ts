import { ConvertLineLyricsToExperimentalWordSync, ConvertStaticLyricsToExperimentalWordSync, ExtractBracketBackgroundVocals, RepairAppleMusicWordSync, type AudioAnalysisData } from "./experimental-word-sync";
import type { Line, Lyrics, Word } from "./lyssna/types";

type Syllable = { Text: string; StartTime: number; EndTime: number; IsPartOfWord: boolean; TransliteratedText?: string; estimated?: boolean };
type Vocal = { StartTime: number; EndTime: number; Syllables: Syllable[]; original?: Line };
type Group = { Type: "Vocal"; OppositeAligned: boolean; Lead: Vocal; Background?: Vocal[] };
type TimingResult = { Type: string; Content?: Group[]; experimentalWordSync?: boolean; lineTimingOnly?: boolean };

export function needsWordSync(lyrics: Lyrics, duration: number) {
  return !lyrics.instrumental && (lyrics.synced || (Number.isFinite(duration) && duration > 0)) &&
    lyrics.lines.length > 0 && lyrics.lines.every((line) => !line.words.length);
}

function lineTimedInput(lyrics: Lyrics) {
  return lyrics.lines.map((line) => ({ Type: "Vocal", Text: line.text, StartTime: line.start_ms / 1_000,
    EndTime: line.end_ms / 1_000, TransliteratedText: line.romanization || undefined, OppositeAligned: line.opposite }));
}

function wordTimedInput(lyrics: Lyrics) {
  const groups: Group[] = [];
  for (const line of lyrics.lines) {
    const vocal: Vocal = { StartTime: line.start_ms / 1_000, EndTime: line.end_ms / 1_000, original: line,
      Syllables: line.words.map((word, index) => ({ Text: word.text.trim(), StartTime: word.start_ms / 1_000,
        EndTime: word.end_ms / 1_000, IsPartOfWord: index + 1 < line.words.length &&
          !/\s$/.test(word.text) && !/^\s/.test(line.words[index + 1].text),
        TransliteratedText: word.romanization?.trim(), estimated: word.estimated })) };
    const last = groups.at(-1);
    if (line.background && last?.OppositeAligned === line.opposite) (last.Background ??= []).push(vocal);
    else groups.push({ Type: "Vocal", Lead: vocal, OppositeAligned: line.opposite });
  }
  return groups;
}

function normalizedOutput(result: TimingResult, lyrics: Lyrics) {
  const estimated = !!result.experimentalWordSync;
  const originalsByTime = new Map(lyrics.lines.filter((line) => !line.background).map((line) => [`${line.start_ms}:${line.opposite}`, line]));
  const originalsByText = new Map(lyrics.lines.map((line) => [line.text, line]));
  function lineFrom(vocal: Vocal, opposite: boolean, background: boolean): Line {
    const units = vocal.Syllables;
    const words: Word[] = units.map((word, index) => {
      const space = index > 0 && !units[index - 1].IsPartOfWord ? " " : "";
      return { text: space + word.Text, start_ms: Math.round(word.StartTime * 1_000), end_ms: Math.round(word.EndTime * 1_000),
        romanization: word.TransliteratedText ? space + word.TransliteratedText : undefined, estimated: estimated || word.estimated };
    });
    const start = Math.round(vocal.StartTime * 1_000);
    const text = words.map((word) => word.text).join("");
    const sameText = originalsByText.get(text);
    const original = vocal.original ?? (background ? undefined : (sameText?.background || !lyrics.synced) ? sameText : originalsByTime.get(`${start}:${opposite}`));
    const hasWordReading = words.some((word) => word.romanization);
    return { text: text || original?.text || "", words: result.lineTimingOnly ? [] : words, background: background || !!original?.background, opposite,
      start_ms: start, end_ms: Math.round(vocal.EndTime * 1_000), translation: original?.translation ?? "",
      romanization: hasWordReading ? words.map((word) => word.romanization ?? word.text).join("") : text === original?.text ? original.romanization : "" };
  }
  return result.Content?.flatMap((group) => [
    lineFrom(group.Lead, !!group.OppositeAligned, group.Lead.original?.background === true),
    ...(group.Background?.map((vocal) => lineFrom(vocal, !!group.OppositeAligned, true)) ?? []),
  ]).filter((line) => line.text) ?? [];
}

export function displayLyrics(lyrics: Lyrics | undefined, wordSync: boolean, duration: number, analysis?: AudioAnalysisData) {
  if (!lyrics) return;
  const estimate = wordSync && needsWordSync(lyrics, duration);
  const apple = lyrics.source.startsWith("Apple Music");
  const brackets = lyrics.source === "lrc.red";
  if (estimate || (lyrics.synced && (apple || brackets))) {
    const wordTimed = lyrics.lines.some((line) => line.words.length);
    const input = wordTimed ? { Type: "Syllable", Content: wordTimedInput(lyrics) } : lyrics.synced
      ? { Type: "Line", Content: lineTimedInput(lyrics) } : { Type: "Static", Lines: lineTimedInput(lyrics) };
    const result: TimingResult = estimate ? lyrics.synced
      ? ConvertLineLyricsToExperimentalWordSync(input, analysis) : ConvertStaticLyricsToExperimentalWordSync(input, analysis, duration / 1_000)
      : apple && wordTimed ? RepairAppleMusicWordSync(input)
        : brackets && wordTimed ? ExtractBracketBackgroundVocals(input, true) : input;
    if (result !== input && result.Type === "Syllable") {
      const lines = normalizedOutput(result, lyrics);
      if (lines.length) lyrics = { ...lyrics, lines, synced: true, estimated_words: !!result.experimentalWordSync,
        estimated_lines: !lyrics.synced, split_words: apple && !estimate && lines.reduce((sum, line) => sum + line.words.length, 0) >
          lyrics.lines.reduce((sum, line) => sum + line.words.length, 0) };
    }
  }
  return lyrics;
}
