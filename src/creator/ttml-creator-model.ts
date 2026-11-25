import type { Line, Lyrics, Word } from "./types";
import { repeatedPieces, symbolPieces } from "./ttml-syllables";
import {
  sectionLabel,
  songSection,
  voicesOf,
  type SongSection,
} from "./song-parts";

export interface CreatorUnit {
  text: string;
  joined: boolean;
  /** The reading, split with "|" into the pieces it's sung in: 命 as "i|no|chi". */
  roman?: string;
  /** The reading came from Auto romanize, so running it again may replace it. */
  romanAuto?: boolean;
  /**
   * Whether the reading starts a new word. Japanese syllables have no
   * spaces between them, so the romanizer or the file says where words
   * break; unknown falls back to the word's own spacing.
   */
  romanSpaced?: boolean;
  /** When each reading piece after the first starts; missing ones are spread evenly. */
  romanStarts?: (number | null)[];
  start?: number;
  end?: number;
  /** Which of the section's voices sings this word, when not the line's. */
  sungBy?: string;
}
export interface CreatorLine {
  units: CreatorUnit[];
  background: boolean;
  opposite: boolean;
  translation?: string;
  romanization?: string;
  /** A space typed after the last word, waiting for the next one. */
  spaceAfter?: boolean;
  /** The song section starting at this line, like "Chorus". Optional. */
  part?: string;
  /** Who sings that section, when the song has more than one artist. */
  singer?: string;
  /** Which of the section's voices sings this line; the first when unset. */
  sungBy?: string;
}
export interface Cursor {
  line: number;
  unit: number;
  /** Which piece of a split reading is being timed. */
  part?: number;
}
export interface SongMeta {
  name: string;
  artists: string[];
  album?: string;
  spotifyId?: string;
  durationMs?: number;
  songwriters?: string[];
}
export interface MetaEntry {
  key: string;
  values: string[];
}

// Key names as the AMLL TTML DB stores them. Songwriters go to
// iTunesMetadata instead of an amll:meta tag.
export const META_KEYS = [
  "musicName",
  "artists",
  "isrc",
  "appleMusicId",
  "ncmMusicId",
  "qqMusicId",
  "ttmlAuthorGithub",
  "ttmlAuthorGithubLogin",
] as const;
export const AUTHOR_KEYS = ["ttmlAuthorGithub", "ttmlAuthorGithubLogin"];
/** Always the song's own; not editable. */
export const SONG_KEYS = ["album", "spotifyId"];

export function defaultMetadata(
  meta: SongMeta,
  author: MetaEntry[] = [],
): MetaEntry[] {
  const known: Record<string, string[]> = {
    musicName: meta.name ? [meta.name] : [],
    artists: meta.artists,
  };
  for (const entry of author)
    if (AUTHOR_KEYS.includes(entry.key)) known[entry.key] = entry.values;
  return withSongwriters(
    META_KEYS.map((key) => ({ key, values: [...(known[key] ?? [])] })),
    meta,
  );
}

/** Fills Songwriter from the song's credits unless the entries already
 *  have one, even an emptied one the person cleared on purpose. */
export function withSongwriters(
  entries: MetaEntry[],
  meta: SongMeta,
): MetaEntry[] {
  const names = filled(meta.songwriters ?? []);
  if (!names.length || entries.some((entry) => entry.key === "songwriters"))
    return entries;
  const after = entries.findIndex((entry) => entry.key === "artists") + 1;
  const at = after > 0 ? after : entries.length;
  return [
    ...entries.slice(0, at),
    { key: "songwriters", values: names },
    ...entries.slice(at),
  ];
}

export function metaProblem(key: string, value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (key === "isrc" && !/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(text))
    return "An ISRC is 12 characters, like USUM71703861.";
  if (
    (key === "appleMusicId" ||
      key === "ncmMusicId" ||
      key === "ttmlAuthorGithub") &&
    !/^\d+$/.test(text)
  )
    return "Use digits only.";
  if (key === "spotifyId" && !/^[A-Za-z0-9]{22}$/.test(text))
    return "A Spotify ID is 22 letters and digits.";
  if (key === "qqMusicId" && !/^[A-Za-z0-9]+$/.test(text))
    return "Use letters and digits only.";
  if (key === "ttmlAuthorGithubLogin" && !/^[A-Za-z0-9-]{1,39}$/.test(text))
    return "That isn't a GitHub username.";
  return null;
}

const OPPOSITE_PREFIX = "v2:";

/**
 * Plain text to lines. One lyric line per text line; `|` splits a word into
 * syllables; a line wrapped in parentheses is a background vocal; a `v2:`
 * prefix gives the line to the second singer.
 */
/**
 * Genius brackets backing vocals inside the line they echo, with ";"
 * between separate ones. Each bracketed part moves to a background line of
 * its own after the line, so "Who am I? (I'm a star; I'm a star)" becomes
 * the line plus two background lines. Lines with unbalanced brackets stay.
 */
export function geniusBackgrounds(text: string): string {
  return text
    .split(/\r?\n/)
    .flatMap((raw) => {
      let body = raw.trim();
      let prefix = "";
      if (body.toLowerCase().startsWith(OPPOSITE_PREFIX)) {
        prefix = `${OPPOSITE_PREFIX} `;
        body = body.slice(OPPOSITE_PREFIX.length).trim();
      }
      const groups: string[] = [];
      let main = "";
      let depth = 0;
      let group = "";
      for (const character of body) {
        if (character === "(") {
          if (depth++ > 0) group += character;
        } else if (character === ")" && depth > 0) {
          if (--depth > 0) group += character;
          else {
            groups.push(group);
            group = "";
            main += " ";
          }
        } else if (depth > 0) group += character;
        else main += character;
      }
      if (depth > 0 || !groups.length) return [raw];
      const backgrounds = groups.flatMap((inner) =>
        inner
          .split(";")
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part) => `${prefix}(${part})`),
      );
      main = main
        .replace(/\s+/g, " ")
        .replace(/\s+([,.!?])/g, "$1")
        .trim();
      return [...(main ? [`${prefix}${main}`] : []), ...backgrounds];
    })
    .join("\n");
}

/**
 * The Genius section a "[Chorus]" style line names, in any language Genius
 * writes them: "[Verse 2: Someone]" names a Verse, "[Refrão]" a Chorus.
 * Undefined for "[]" and names Genius doesn't use; such lines are still
 * never lyrics.
 */
export function sectionName(text: string): string | undefined {
  return sectionOf(text)?.part;
}
export function sectionOf(text: string): SongSection | undefined {
  const match = /^\[([^\]]*)\]$/.exec(text.trim());
  return match ? songSection(match[1]) : undefined;
}
const sectionFrom = (line: CreatorLine): SongSection | undefined =>
  line.part
    ? { part: line.part, ...(line.singer && { singer: line.singer }) }
    : undefined;
const isSectionLine = (text: string) => /^\[[^\]]*\]$/.test(text.trim());

const plain = (text: string) =>
  text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const words = (text: string) =>
  text.split(/[^\p{L}\p{N}']+/u).map(plain).filter(Boolean);
const lineWords = (line: CreatorLine) =>
  words(
    line.units
      .map((unit, index) => (index && !unit.joined ? " " : "") + unit.text)
      .join(""),
  );

function edits(a: string, b: string) {
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        row[j] + 1,
        next[j - 1] + 1,
        row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    row = next;
  }
  return row[b.length];
}

// Spellings drift between Genius and a draft ("walkin'" against "walking"),
// so longer words a letter apart still match.
const sameWord = (a: string, b: string) =>
  a === b || (Math.min(a.length, b.length) >= 4 && edits(a, b) <= 1);

/** Word positions the two lists share, in order, as many as fit (longest common subsequence). */
function alignWords(ours: string[], theirs: string[]) {
  const width = theirs.length + 1;
  const best = new Uint16Array((ours.length + 1) * width);
  for (let i = ours.length - 1; i >= 0; i--)
    for (let j = theirs.length - 1; j >= 0; j--)
      best[i * width + j] = sameWord(ours[i], theirs[j])
        ? best[(i + 1) * width + j + 1] + 1
        : Math.max(best[(i + 1) * width + j], best[i * width + j + 1]);
  const pairs = new Map<number, number>();
  let i = 0;
  let j = 0;
  while (i < ours.length && j < theirs.length) {
    if (
      sameWord(ours[i], theirs[j]) &&
      best[i * width + j] === best[(i + 1) * width + j + 1] + 1
    )
      pairs.set(j++, i++);
    else if (best[(i + 1) * width + j] >= best[i * width + j + 1]) i++;
    else j++;
  }
  return pairs;
}

// Lyssna marks Genius's italic and bold with these when asked to.
const STYLE_MARKS: Record<string, [style: number, opens: boolean]> = {
  "\uE000": [1, true],
  "\uE001": [1, false],
  "\uE002": [2, true],
  "\uE003": [2, false],
};
const unmark = (text: string) => text.replace(/[\uE000-\uE003]/g, "");

/** Styled text with each line reopening the styles still running into it. */
function balanceStyles(text: string): string[] {
  const on = new Set<number>();
  return text.split(/\r?\n/).map((line) => {
    const open = [...on].map((style) => (style === 1 ? "\uE000" : "\uE002"));
    for (const char of line) {
      const mark = STYLE_MARKS[char];
      if (mark) mark[1] ? on.add(mark[0]) : on.delete(mark[0]);
    }
    return open.join("") + line;
  });
}

/**
 * Who sings a word in Genius's style: plain is the section's first voice;
 * italic and bold are whoever its header sets in that style, else the
 * second and third voice.
 */
function styleVoice(
  style: number,
  voices: string[],
  styled?: { italic?: string; bold?: string },
) {
  if (voices.length < 2) return;
  if (style === 1) return styled?.italic ?? voices[1];
  if (style === 2) return styled?.bold ?? voices[2];
  return voices[0];
}

/** The voices a styled header line sets in italic and in bold. */
function headerStyles(raw: string, voices: string[]) {
  const named = (open: string, close: string) => {
    const spans = [...raw.matchAll(new RegExp(`${open}([^${close}]*)${close}`, "g"))]
      .map((match) => match[1].replace(/^[\s,&]+|[\s,&\]]+$/g, ""))
      .filter(Boolean);
    return voices.find((voice) => spans.includes(voice));
  };
  return { italic: named("\uE000", "\uE001"), bold: named("\uE002", "\uE003") };
}

/**
 * Puts the sections named in `text` ("[Chorus]" lines, as Genius writes
 * them) on the matching lines of a synced draft. Words and timings stay
 * as they are. Genius often breaks lines elsewhere than the draft does, so
 * the two are lined up word by word, and each section starts at the draft
 * line nearest its first word.
 * Undefined when no section could be placed.
 */
export function applySections(
  lines: CreatorLine[],
  text: string,
): CreatorLine[] | undefined {
  const ours: string[] = [];
  const lineOf: number[] = [];
  const firstWord = new Map<number, number>();
  const leads: number[] = [];
  lines.forEach((line, index) => {
    if (line.background) return;
    leads.push(index);
    firstWord.set(index, ours.length);
    for (const word of lineWords(line)) {
      ours.push(word);
      lineOf.push(index);
    }
  });

  // Section headers lose their styling here; it says which voice is which.
  const headers = styledHeaders(text);
  const unstyled = balanceStyles(text)
    .map((raw) => (isSectionLine(unmark(raw)) ? unmark(raw) : raw))
    .join("\n");
  // Backing vocals don't line up with the draft's leads, unless they are
  // all a section has: Genius writes an intro of ad-libs as "(Giga)".
  const parsed = parseText(geniusBackgrounds(unstyled));
  const isLead = (line: CreatorLine) =>
    !line.background && lineWords(line).length > 0;
  const sectionHasLead = (index: number) => {
    let from = index;
    while (from > 0 && !sectionFrom(parsed[from])) from--;
    let to = index + 1;
    while (to < parsed.length && !sectionFrom(parsed[to])) to++;
    return parsed.slice(from, to).some(isLead);
  };
  const theirs: string[] = [];
  const lineStart: number[] = [];
  const sections: { section: SongSection; from: number; to: number }[] = [];
  let pending: SongSection | undefined;
  for (const [index, line] of parsed.entries()) {
    pending = sectionFrom(line) ?? pending;
    if (line.background && sectionHasLead(index)) continue;
    const found = lineWords(line);
    if (!found.length) continue;
    if (pending)
      sections.push({ section: pending, from: theirs.length, to: 0 });
    pending = undefined;
    for (const _ of found) lineStart.push(theirs.length);
    theirs.push(...found);
    if (sections.length) sections[sections.length - 1].to = theirs.length;
  }

  const pairs = alignWords(ours, theirs);
  const parts = new Map<number, SongSection>();
  for (const { section, from, to } of sections) {
    let j = from;
    while (j < to && !pairs.has(j)) j++;
    if (j === to) continue;
    // Step back over words of that Genius line the draft left out, then
    // round to the nearest line start.
    let before = j - 1;
    while (before >= 0 && !pairs.has(before)) before--;
    const word = Math.max(
      before < 0 ? 0 : pairs.get(before)! + 1,
      pairs.get(j)! - (j - lineStart[j]),
    );
    const lead = leads.indexOf(lineOf[word]);
    const start = firstWord.get(leads[lead])!;
    const end = firstWord.get(leads[lead + 1]) ?? ours.length;
    const at = word - start <= (end - start) / 2 ? lead : lead + 1;
    if (at < leads.length && !parts.has(leads[at]))
      parts.set(leads[at], section);
  }
  if (!parts.size) return;
  const tagged = lines.map((line, index) => {
    const { part: _, singer: __, ...rest } = line;
    const section = parts.get(index);
    return section ? { ...rest, ...section } : rest;
  });
  return geniusVoices(tagged, text, headers);
}

interface Token {
  word: string;
  /** As written. */
  text: string;
  /** 0 plain, 1 italic, 2 bold. */
  style: number;
  /** The bracketed run it sits in, or -1. */
  group: number;
  units: number[];
}

// Kana and kanji have no spaces, and Genius and a draft break them into
// words differently, so each is matched on its own.
const OWN_WORD = /[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Hangul}]/u;
const WORD_CHAR = /[\p{L}\p{N}\p{M}'’]/u;
// Genius swaps some Latin letters in its lyrics for Cyrillic twins.
const TWINS: Record<string, string> = {
  а: "a",
  е: "e",
  о: "o",
  р: "p",
  с: "c",
  у: "y",
  х: "x",
  і: "i",
  ј: "j",
  ѕ: "s",
  ԁ: "d",
  ӏ: "l",
};
const wordOf = (text: string) => {
  const word = plain(text);
  return /[a-z]/.test(word)
    ? word.replace(/[аеорсухіјѕԁӏ]/g, (twin) => TWINS[twin])
    : word;
};

function tokenize(
  chars: [char: string, unit: number][],
  count: { groups: number },
): Token[] {
  const tokens: Token[] = [];
  let italic = false;
  let bold = false;
  let depth = 0;
  let group = -1;
  let current = "";
  let style = 0;
  let inGroup = -1;
  let units: number[] = [];
  const end = () => {
    const word = wordOf(current);
    if (word) tokens.push({ word, text: current, style, group: inGroup, units });
    current = "";
    units = [];
  };
  for (const [char, unit] of chars) {
    if (WORD_CHAR.test(char)) {
      const own = OWN_WORD.test(char);
      if (own) end();
      if (!current) {
        style = bold ? 2 : italic ? 1 : 0;
        inGroup = depth > 0 ? group : -1;
      }
      current += char;
      if (unit >= 0 && units[units.length - 1] !== unit) units.push(unit);
      if (own) end();
      continue;
    }
    end();
    if (char === "(" || char === "（") {
      if (depth++ === 0) group = count.groups++;
    } else if (char === ")" || char === "）") depth = Math.max(0, depth - 1);
    const mark = STYLE_MARKS[char];
    if (mark?.[0] === 1) italic = mark[1];
    else if (mark) bold = mark[1];
  }
  end();
  return tokens;
}

const unitChars = (line: CreatorLine) =>
  line.units.flatMap((unit, index) =>
    [...((index && !unit.joined ? " " : "") + unit.text)].map(
      (char): [string, number] => [char, index],
    ),
  );

type GeniusWord = {
  word: string;
  voice?: string;
  group: number;
  /** Starts its Genius line with a capital. */
  capital: boolean;
  /** Which Genius section it is in, counting headers. */
  section: number;
};

/**
 * The draft words that sit in one of Genius's bracketed runs, as
 * [from, to) unit ranges. A run counts when it holds at least half of
 * that bracket's words, so a stray match doesn't pull a word out.
 */
function bracketRuns(
  line: CreatorLine,
  tokens: Token[],
  match: Map<Token, GeniusWord>,
  groupSize: Map<number, number>,
): [number, number][] {
  const status: (number | undefined)[] = line.units.map(() => undefined);
  const lettered: number[] = [];
  for (const token of tokens) {
    const found = match.get(token);
    for (const unit of token.units) {
      if (lettered[lettered.length - 1] !== unit) lettered.push(unit);
      if (found && status[unit] === undefined) status[unit] = found.group;
    }
  }
  // A word spelled differently than on Genius goes with the words around
  // it when they agree.
  for (let at = 0; at < lettered.length; at++) {
    if (status[lettered[at]] !== undefined) continue;
    let end = at;
    while (end < lettered.length && status[lettered[end]] === undefined) end++;
    const before = at > 0 ? status[lettered[at - 1]] : undefined;
    const after = end < lettered.length ? status[lettered[end]] : undefined;
    const fill = before !== undefined && before === after ? before : -1;
    for (let gap = at; gap < end; gap++) status[lettered[gap]] = fill;
    at = end - 1;
  }
  // Punctuation goes with the word before it.
  for (let unit = 0; unit < status.length; unit++)
    status[unit] ??= status[unit - 1] ?? status[unit + 1] ?? -1;
  for (let unit = status.length - 1; unit >= 0; unit--)
    if (status[unit] === undefined) status[unit] = status[unit + 1] ?? -1;

  const runs: [number, number][] = [];
  for (let from = 0; from < status.length; ) {
    const group = status[from]!;
    let to = from + 1;
    while (to < status.length && status[to] === group) to++;
    if (group >= 0) {
      const hits = tokens.filter(
        (token) =>
          match.get(token)?.group === group &&
          token.units.every((unit) => unit >= from && unit < to),
      ).length;
      if (hits * 2 >= (groupSize.get(group) ?? 1)) runs.push([from, to]);
    }
    from = to;
  }
  return runs;
}

/** The voices each styled section header sets in italic and in bold. */
function styledHeaders(text: string) {
  const headers = new Map<string, { italic?: string; bold?: string }>();
  for (const raw of balanceStyles(text)) {
    const bare = unmark(raw);
    if (!isSectionLine(bare)) continue;
    const singer = sectionOf(bare)?.singer;
    if (singer && !headers.has(singer))
      headers.set(singer, headerStyles(raw, voicesOf(singer)));
  }
  return headers;
}

/** The draft's words lined up with Genius's, every one, brackets too. */
function alignGenius(
  lines: CreatorLine[],
  text: string,
  headers: Map<string, { italic?: string; bold?: string }>,
) {
  const theirs: GeniusWord[] = [];
  const groupSize = new Map<number, number>();
  const count = { groups: 0 };
  let who: string | undefined;
  let section = 0;
  for (const raw of balanceStyles(text)) {
    const bare = unmark(raw).trim();
    if (isSectionLine(bare)) {
      who = sectionOf(bare)?.singer;
      section++;
      continue;
    }
    const voices = voicesOf(who ?? "");
    const styled = headers.get(who ?? "");
    for (const [at, token] of tokenize(
      [...raw].map((char): [string, number] => [char, -1]),
      count,
    ).entries()) {
      theirs.push({
        word: token.word,
        voice: styleVoice(token.style, voices, styled),
        group: token.group,
        capital: at === 0 && /^\p{Lu}/u.test(token.text),
        section,
      });
      if (token.group >= 0)
        groupSize.set(token.group, (groupSize.get(token.group) ?? 0) + 1);
    }
  }
  const tokensOf = lines.map((line) =>
    tokenize(unitChars(line), { groups: 0 }),
  );
  const ours = tokensOf.flat();
  const match = new Map<Token, GeniusWord>();
  for (const [j, i] of alignWords(
    ours.map((token) => token.word),
    theirs.map((word) => word.word),
  ))
    match.set(ours[i], theirs[j]);
  return { tokensOf, match, groupSize, theirs };
}

export interface MissingLine {
  /** The draft line it goes after; -1 is before the first. */
  after: number;
  text: string;
  background: boolean;
  voice?: string;
}

/**
 * What Genius sings that the draft leaves out: a bracketed part or the
 * rest of a Genius line with none of its words in the draft. Each goes
 * after the draft line holding the Genius words just before it.
 */
const NUMBERS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];
// Numbers written either way ("4", "four") aren't a real difference.
const asNumber = (word: string) => {
  const number = NUMBERS.indexOf(word);
  return number >= 0 ? String(number) : word;
};
const looseWord = (a: string, b: string) =>
  sameWord(a, b) || asNumber(a) === asNumber(b);

/**
 * The line brought in line with Genius without touching its timings:
 * characters it lacks put into their word ("パレー" to "パレード"), or
 * whole words swapped for Genius's where both have as many words. A word
 * split into syllables is left alone, since there's no telling where its
 * new spelling would split. Undefined when nothing can be fixed.
 */
export function fixFromGenius(
  line: CreatorLine,
  genius: string,
): CreatorLine | undefined {
  return addCharacters(line, genius) ?? swapWords(line, genius);
}

function swapWords(
  line: CreatorLine,
  genius: string,
): CreatorLine | undefined {
  const core = (text: string) =>
    text.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’-]*/u)?.[0] ?? "";
  const words: number[][] = [];
  line.units.forEach((unit, index) => {
    if (unit.joined && words.length) words[words.length - 1].push(index);
    else words.push([index]);
  });
  const latin = (text: string) => !!text && !OWN_WORD.test(text);
  const ours = words.filter((units) =>
    latin(core(units.map((index) => line.units[index].text).join(""))),
  );
  const theirs = unmark(genius)
    .split(/\s+/)
    .map(core)
    .filter(latin);
  // Japanese and the like must already match; only Latin words swap.
  const own = (text: string) =>
    Array.from(text)
      .filter((char) => OWN_WORD.test(char))
      .join("");
  if (
    ours.length !== theirs.length ||
    own(line.units.map((unit) => unit.text).join("")) !== own(unmark(genius))
  )
    return;
  const units = [...line.units];
  let changed = false;
  ours.forEach((group, at) => {
    const text = group.map((index) => line.units[index].text).join("");
    const mine = core(text);
    let wanted = theirs[at];
    if (looseWord(wordOf(mine), wordOf(wanted)) || group.length > 1) return;
    // Keep the draft's capitalisation of the word's first letter.
    if (mine[0] !== mine[0].toLowerCase())
      wanted = wanted[0].toUpperCase() + wanted.slice(1);
    else if (wanted[0] !== wanted[0].toLowerCase() && at > 0)
      wanted = wanted[0].toLowerCase() + wanted.slice(1);
    const unit = units[group[0]];
    units[group[0]] = { ...unit, text: unit.text.replace(mine, wanted) };
    changed = true;
  });
  return changed ? { ...line, units } : undefined;
}

function addCharacters(
  line: CreatorLine,
  genius: string,
): CreatorLine | undefined {
  const isLetter = (char: string) => /[\p{L}\p{N}]/u.test(char);
  const ours: { unit: number; at: number; char: string }[] = [];
  line.units.forEach((unit, index) =>
    Array.from(unit.text).forEach((char, at) => {
      if (isLetter(char)) ours.push({ unit: index, at, char });
    }),
  );
  const added = new Map<string, string>();
  let next = 0;
  for (const char of Array.from(unmark(genius))) {
    if (!isLetter(char)) continue;
    if (next < ours.length && ours[next].char.toLowerCase() === char.toLowerCase()) {
      next++;
      continue;
    }
    if (!OWN_WORD.test(char)) return;
    const before = ours[next - 1];
    const key = before ? `${before.unit}:${before.at + 1}` : "0:0";
    added.set(key, (added.get(key) ?? "") + char);
  }
  if (next < ours.length || !added.size) return;
  return {
    ...line,
    units: line.units.map((unit, index) => {
      const chars = Array.from(unit.text);
      let changed = false;
      for (let at = chars.length; at >= 0; at--) {
        const extra = added.get(`${index}:${at}`);
        if (!extra) continue;
        chars.splice(at, 0, extra);
        changed = true;
      }
      return changed ? { ...unit, text: chars.join("") } : unit;
    }),
  };
}

export const geniusMissing = (lines: CreatorLine[], text: string) =>
  geniusGaps(lines, text).missing;

/**
 * Where Genius and the draft part ways: Genius parts the draft leaves out,
 * and draft lines missing some of Genius's words or characters
 * ("パレー" where Genius has "パレード").
 */
function geniusGaps(lines: CreatorLine[], text: string) {
  const { tokensOf, match, theirs } = alignGenius(
    lines,
    text,
    styledHeaders(text),
  );
  const lineOf = new Map<GeniusWord, number>();
  tokensOf.forEach((tokens, index) => {
    for (const token of tokens) {
      const found = match.get(token);
      if (found) lineOf.set(found, index);
    }
  });
  const missing: MissingLine[] = [];
  const differs = new Map<number, string[]>();
  let next = 0;
  let after = -1;
  for (const raw of balanceStyles(text)) {
    if (isSectionLine(unmark(raw))) continue;
    // Bracketed parts and the words between them, as Genius sets them.
    const parts: { text: string; background: boolean }[] = [];
    let depth = 0;
    let part = "";
    const end = (background: boolean) => {
      if (part.trim()) parts.push({ text: part, background });
      part = "";
    };
    for (const char of raw) {
      if (char === "(" || char === "（") {
        if (depth++ === 0) {
          end(false);
          continue;
        }
      } else if ((char === ")" || char === "）") && depth > 0) {
        if (--depth === 0) {
          end(true);
          continue;
        }
      }
      part += char;
    }
    end(depth > 0);
    for (const each of parts) {
      const words = tokenize(
        [...each.text].map((char): [string, number] => [char, -1]),
        { groups: 0 },
      ).length;
      const own = theirs.slice(next, next + words);
      next += words;
      if (!own.length) continue;
      const kept = own.filter((word) => lineOf.has(word));
      // A backing line comes after its lead in the draft even where Genius
      // brackets it first, so the in-order match can miss it; its words in
      // a line nearby mean it's there.
      const nearby = () =>
        tokensOf
          .slice(Math.max(0, after - 4), Math.max(0, after + 5))
          .some((tokens) => {
            const left = tokens.map((token) => token.word);
            let found = 0;
            for (const word of own) {
              const at = left.findIndex((each) => sameWord(each, word.word));
              if (at < 0) continue;
              left.splice(at, 1);
              found++;
            }
            return found * 2 >= own.length;
          });
      const bare = unmark(each.text)
        .trim()
        .replace(/^[,，、\s]+|[,，、\s]+$/gu, "")
        .replace(/^\p{Ll}/u, (letter) => letter.toUpperCase());
      if (kept.length * 4 < own.length && !nearby()) {
        if (bare)
          missing.push({
            after,
            text: bare,
            background: each.background,
            voice: own[0].voice,
          });
      } else if (kept.length) {
        // Words of it that no draft line around its own has.
        const at = kept.map((word) => lineOf.get(word)!);
        const near = tokensOf
          .slice(Math.max(0, Math.min(...at) - 1), Math.max(...at) + 2)
          .flat()
          .map((token) => token.word);
        const lost = own.filter((word) => {
          const found = near.findIndex((each) => looseWord(each, word.word));
          if (found >= 0) near.splice(found, 1);
          return found < 0;
        });
        if (lost.length && bare) {
          const line = Math.min(...at);
          differs.set(line, [
            ...(differs.get(line) ?? []),
            each.background ? `(${bare})` : bare,
          ]);
        }
      }
      for (const word of own) {
        const line = lineOf.get(word);
        if (line !== undefined) after = Math.max(after, line);
      }
    }
  }
  return {
    missing,
    differs: [...differs]
      .sort((a, b) => a[0] - b[0])
      .map(([line, parts]) => {
        const genius = parts.join(" ");
        return {
          line,
          text: lines[line].units.map((unit) => unit.text).join(" "),
          genius,
          fixable: !!fixFromGenius(lines[line], genius),
        };
      }),
  };
}

/** Adds Genius lines the draft left out, untimed, where they go. */
export function addMissing(
  lines: CreatorLine[],
  missing: MissingLine[],
): CreatorLine[] {
  const made = (item: MissingLine): CreatorLine => {
    const voices = sectionVoices(lines, Math.max(item.after, 0));
    const at = lines[Math.max(item.after, 0)];
    return {
      units: parseText(item.text.replace(/[()（）]/g, ""))[0]?.units ?? [],
      background: item.background,
      opposite: at?.opposite ?? false,
      ...(item.voice &&
        voices.includes(item.voice) &&
        item.voice !== voices[0] && { sungBy: item.voice }),
    };
  };
  const at = (index: number) =>
    missing.filter((item) => item.after === index).map(made);
  return [
    ...at(-1),
    ...lines.flatMap((line, index) => [line, ...at(index)]),
  ].filter((line) => line.units.length);
}

/**
 * Whole lines the draft and Genius disagree on: background lines Genius
 * sings outside any bracket, and lead lines it has all in brackets. A
 * draft may set either apart on purpose, so they are only pointed out.
 */
function geniusDisputes(lines: CreatorLine[], text: string) {
  const { tokensOf, match } = alignGenius(lines, text, new Map());
  const first = lines.findIndex((line) => line.units.length);
  const leads: number[] = [];
  const echoes: number[] = [];
  lines.forEach((line, index) => {
    const found = tokensOf[index].map((token) => match.get(token));
    const lead = found.filter((word) => word?.group === -1).length;
    const bracketed = found.filter((word) => word && word.group >= 0).length;
    if (line.background) {
      if (lead && lead * 2 >= found.length && !bracketed) leads.push(index);
    } else if (
      // A song's opening ad-libs are its lead.
      index !== first &&
      bracketed &&
      bracketed * 2 >= found.length &&
      !lead
    )
      echoes.push(index);
  });
  return { leads, echoes };
}

/** Background lines Genius sings as lead, outside any bracket. */
export const geniusLeads = (lines: CreatorLine[], text: string) =>
  geniusDisputes(lines, text).leads;

/** Lead lines Genius has all in brackets, as backing vocals. */
export const geniusEchoes = (lines: CreatorLine[], text: string) =>
  geniusDisputes(lines, text).echoes;

/**
 * Who sings and what's a backing vocal, from Genius's styling: italic and
 * bold say who sings, so a line takes the voice of its first word and
 * words another voice sings keep theirs; what Genius brackets moves to a
 * background line, even where the draft sings it in the lead line.
 */
function geniusVoices(
  placed: CreatorLine[],
  text: string,
  headers: Map<string, { italic?: string; bold?: string }>,
): CreatorLine[] {
  const { tokensOf, match, groupSize } = alignGenius(placed, text, headers);

  // Placing sections skips Genius's bracketed words, so a section whose
  // first lines the draft sings from them ("Waking something ancient")
  // started late. It moves back over lead lines Genius has in it.
  const sectionOfLine = tokensOf.map(
    (tokens) =>
      tokens.map((token) => match.get(token)).find(Boolean)?.section,
  );
  const tagged = [...placed];
  tagged.forEach((line, index) => {
    const at = sectionOfLine[index];
    if (!line.part || at === undefined) return;
    let start = index;
    for (let before = index - 1; before >= 0; before--) {
      if (tagged[before].part) break;
      if (tagged[before].background) continue;
      if (sectionOfLine[before] !== at) break;
      start = before;
    }
    if (start === index) return;
    const { part, singer, ...rest } = line;
    tagged[index] = rest;
    tagged[start] = {
      ...tagged[start],
      part,
      ...(singer !== undefined && { singer }),
    };
  });

  const voicedLines = tagged.map((unpunctuated, index) => {
    // Genius ends a line where a draft split it after a comma ("廻れ、").
    const original = {
      ...unpunctuated,
      units: dropEndComma(unpunctuated.units),
    };
    // A lead line Genius starts with a capital starts with one here too.
    const opening = tokensOf[index][0];
    const line =
      !original.background &&
      opening?.units[0] === 0 &&
      match.get(opening)?.capital
        ? {
            ...original,
            units: [capitalFirst(original.units[0]), ...original.units.slice(1)],
          }
        : original;
    const voices = sectionVoices(tagged, index);
    if (voices.length < 2) return line;
    let lineVoice: string | undefined;
    const unitVoices = new Map<number, string>();
    for (const token of tokensOf[index]) {
      const voice = match.get(token)?.voice;
      if (!voice || !voices.includes(voice)) continue;
      lineVoice ??= voice;
      for (const unit of token.units)
        if (!unitVoices.has(unit)) unitVoices.set(unit, voice);
    }
    if (!lineVoice) return line;
    const { sungBy: _, ...rest } = line;
    return {
      ...rest,
      ...(lineVoice !== voices[0] && { sungBy: lineVoice }),
      units: line.units.map((unit, at) => {
        const voice = unitVoices.get(at);
        if (!voice) return unit;
        const { sungBy: __, ...bare } = unit;
        return voice === lineVoice ? bare : { ...bare, sungBy: voice };
      }),
    };
  });

  return voicedLines.flatMap((line, index) => {
    const runs = bracketRuns(line, tokensOf[index], match, groupSize);
    if (!runs.length) return [line];
    // A background line Genius brackets only part of holds a lead too
    // ("この刻が say my name"): the rest goes back to the lead, when
    // several of its words are ones Genius sings outside brackets.
    if (line.background) {
      const inRun = (unit: number) =>
        runs.some(([from, to]) => unit >= from && unit < to);
      const lead = tokensOf[index].filter(
        (token) => !token.units.some(inRun),
      );
      const sung = lead.filter((token) => match.get(token)?.group === -1);
      if (sung.length < 2 || sung.length * 2 < lead.length) return [line];
    }
    const units = [...line.units];
    const inRun = (at: number) =>
      runs.some(([from, to]) => at >= from && at < to);
    for (const [from, to] of runs) {
      units[from] = {
        ...units[from],
        joined: false,
        text: `(${units[from].text.replace(/^[(（]/, "")}`,
      };
      // A comma after the bracket ("ancient), oh") belongs to the lead.
      const [, word, comma] = units[to - 1].text.match(
        /^(.*?)[)）]?([,，、;]*)$/su,
      )!;
      units[to - 1] = { ...units[to - 1], text: `${word})` };
      const before = units[from - 1];
      if (
        comma &&
        before &&
        !inRun(from - 1) &&
        to < units.length &&
        !/[,，、;.!?。！？…]$/u.test(before.text)
      )
        units[from - 1] = { ...before, text: before.text + comma };
      if (units[to]) units[to] = { ...units[to], joined: false };
    }
    // A draft line that is all one Genius bracket was set apart as a line
    // on purpose, often a voice sung over the lead, so it stays a lead.
    const split = splitBrackets(
      { ...line, units, background: false },
      true,
    );
    if (split.length === 1 && !split[0].background) return [line];
    const voices = sectionVoices(voicedLines, index);
    const own = line.sungBy ?? voices[0];
    return split.map((part, at) => {
      const units = dropEndComma(part.units);
      if (voices.length < 2) return { ...part, units };
      const sung = units.map((unit) => unit.sungBy ?? own);
      const { sungBy: _, ...rest } = part;
      return {
        ...rest,
        ...(sung[0] !== voices[0] && { sungBy: sung[0] }),
        units: units.map((unit, at) => {
          const { sungBy: __, ...bare } = unit;
          return sung[at] === sung[0] ? bare : { ...bare, sungBy: sung[at] };
        }),
      };
    });
  });
}

export interface GeniusChanges {
  sections: { line: number; part: string }[];
  /** Lines that became background vocals. */
  backgrounds: { line: number; text: string }[];
  /** Lines each voice other than a section's first sings. */
  singers: { voice: string; lines: number[] }[];
  /** Lines with words another voice sings. */
  mixed: number[];
  /** Background lines Genius sings as lead. */
  leads: { line: number; text: string }[];
  /** Lead lines Genius has all in brackets. */
  echoes: { line: number; text: string }[];
  /** What Genius sings that the draft leaves out. */
  missing: MissingLine[];
  /** Lines that lost a comma left at their end. */
  commas: number[];
  /** Draft lines missing some of what Genius has there. */
  differs: { line: number; text: string; genius: string; fixable: boolean }[];
  /** Sections, backing vocals and singers the draft already had. */
  earlier: { line: number; label: string }[];
}

const textOf = (line: CreatorLine) =>
  line.units
    .map((unit, index) => (index && !unit.joined ? " " : "") + unit.text)
    .join("");

/** What Sections from Genius changed, for a look before keeping it. */
export function geniusChanges(
  before: CreatorLine[],
  after: CreatorLine[],
  genius?: string,
): GeniusChanges {
  const { leads, echoes: bracketed } = genius
    ? geniusDisputes(after, genius)
    : { leads: [], echoes: [] };
  // What the draft already had isn't a change: each line's state before,
  // counted so a repeated chorus line matches once per copy.
  const had = (key: (line: CreatorLine) => string | undefined) => {
    const left = new Map<string, number>();
    for (const line of before) {
      const each = key(line);
      if (each !== undefined) left.set(each, (left.get(each) ?? 0) + 1);
    }
    return (line: CreatorLine) => {
      const each = key(line);
      const count = each === undefined ? 0 : (left.get(each) ?? 0);
      if (count) left.set(each!, count - 1);
      return count > 0;
    };
  };
  const hadSection = had((line) =>
    line.part ? `${textOf(line)}\u0000${line.part}` : undefined,
  );
  const hadBackground = had((line) =>
    line.background ? textOf(line) : undefined,
  );
  const hadSinger = had((line) =>
    line.sungBy ? `${textOf(line)}\u0000${line.sungBy}` : undefined,
  );
  const hadMixed = had((line) =>
    line.units.some((unit) => unit.sungBy)
      ? line.units.map((unit) => `${unit.text}\u0000${unit.sungBy ?? ""}`).join("\u0001")
      : undefined,
  );
  const changes: GeniusChanges = {
    sections: [],
    backgrounds: [],
    singers: [],
    mixed: [],
    leads: leads.map((line) => ({ line, text: textOf(after[line]) })),
    echoes: bracketed.map((line) => ({ line, text: textOf(after[line]) })),
    ...(genius
      ? geniusGaps(after, genius)
      : { missing: [], differs: [] }),
    commas: [],
    earlier: [],
  };
  const earlier = (line: number, label: string) =>
    changes.earlier.push({ line, label });
  const trimmed = new Map<string, number>();
  for (const line of before) {
    const text = textOf(line);
    const bare = text.replace(/[,，、]+$/u, "");
    if (bare !== text) trimmed.set(bare, (trimmed.get(bare) ?? 0) + 1);
  }
  after.forEach((line, index) => {
    if (line.part) {
      if (!hadSection(line))
        changes.sections.push({ line: index, part: line.part });
      else earlier(index, line.part);
    }
    if (line.background) {
      if (!hadBackground(line))
        changes.backgrounds.push({ line: index, text: textOf(line) });
      else earlier(index, `(${textOf(line)})`);
    }
    if (line.sungBy && hadSinger(line))
      earlier(index, `Sung by ${line.sungBy}`);
    else if (line.sungBy) {
      let group = changes.singers.find((each) => each.voice === line.sungBy);
      if (!group) {
        group = { voice: line.sungBy, lines: [] };
        changes.singers.push(group);
      }
      group.lines.push(index);
    }
    if (line.units.some((unit) => unit.sungBy)) {
      if (!hadMixed(line)) changes.mixed.push(index);
      else earlier(index, "Words sung by another voice");
    }
    const left = trimmed.get(textOf(line)) ?? 0;
    if (left) {
      trimmed.set(textOf(line), left - 1);
      changes.commas.push(index);
    }
  });
  return changes;
}

/** "[...]" lines that name no Genius section, so add no tag. */
export function unknownSections(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) => isSectionLine(line) && line !== "[]" && !sectionName(line),
    );
}

/** Whether one pair of brackets holds the whole text: "(a) b (c)" is two. */
function enclosed(text: string) {
  if (!text.startsWith("(") || !text.endsWith(")")) return false;
  let depth = 0;
  for (let at = 0; at < text.length; at++) {
    if (text[at] === "(") depth++;
    else if (text[at] === ")" && --depth === 0 && at < text.length - 1)
      return false;
  }
  return true;
}

export function parseText(text: string): CreatorLine[] {
  const lines: CreatorLine[] = [];
  let section: SongSection | undefined;
  for (const raw of text.split(/\r?\n/)) {
    if (isSectionLine(raw)) {
      section = sectionOf(raw);
      continue;
    }
    let body = raw.trim();
    let opposite = false;
    if (body.toLowerCase().startsWith(OPPOSITE_PREFIX)) {
      opposite = true;
      body = body.slice(OPPOSITE_PREFIX.length).trim();
    }
    let background = false;
    if (body.length > 2 && enclosed(body)) {
      background = true;
      body = body.slice(1, -1).trim();
    }
    const units: CreatorUnit[] = [];
    for (const word of body.split(/\s+/)) {
      word
        .split("|")
        .filter(Boolean)
        .flatMap(symbolPieces)
        .flatMap(repeatedPieces)
        .forEach((text, index) =>
          units.push({
            text,
            joined:
              units.length > 0 &&
              (index > 0 || runsOn(units[units.length - 1].text)),
          }),
        );
    }
    if (units.length) {
      lines.push({ units, background, opposite, ...section });
      section = undefined;
    }
  }
  return lines;
}

/** "eigh-" runs straight on into the next word, with no space. */
export const runsOn = (text: string) => /[\p{L}\p{N}’']-$/u.test(text);

/**
 * Joins every word that follows one left open with a hyphen, fixing drafts
 * and files written before such words ran on. The same lines come back
 * when nothing needed joining.
 */
export function joinHyphenated(lines: CreatorLine[]): CreatorLine[] {
  let changed = false;
  const fixed = lines.map((line) => {
    if (!line.units.some((unit, index) => openBefore(line.units, index)))
      return line;
    changed = true;
    return {
      ...line,
      units: line.units.map((unit, index) =>
        openBefore(line.units, index) ? { ...unit, joined: true } : unit,
      ),
    };
  });
  return changed ? fixed : lines;
}
const openBefore = (units: CreatorUnit[], index: number) =>
  index > 0 && !units[index].joined && runsOn(units[index - 1].text);

export function toText(lines: CreatorLine[]): string {
  return lines
    .map((line) => {
      const body = line.units
        .map((unit, index) =>
          index === 0 ? unit.text : `${unit.joined ? "|" : " "}${unit.text}`,
        )
        .join("");
      const wrapped = line.background ? `(${body})` : body;
      const text = line.opposite ? `${OPPOSITE_PREFIX} ${wrapped}` : wrapped;
      const section = sectionFrom(line);
      return section ? `[${sectionLabel(section)}]\n${text}` : text;
    })
    .join("\n");
}

const shape = (line: CreatorLine) =>
  line.units.map((unit) => `${unit.joined ? "|" : " "}${unit.text}`).join("");

export function keepTimings(
  previous: CreatorLine[],
  next: CreatorLine[],
): CreatorLine[] {
  const pool = new Map<string, CreatorLine[]>();
  for (const line of previous) {
    const key = shape(line);
    pool.set(key, [...(pool.get(key) ?? []), line]);
  }
  return next.map((line) => {
    const match = pool.get(shape(line))?.shift();
    return match
      ? {
          ...line,
          translation: match.translation,
          romanization: match.romanization,
          ...(match.sungBy && { sungBy: match.sungBy }),
          units: line.units.map((unit, index) => ({
            ...unit,
            start: match.units[index].start,
            end: match.units[index].end,
            ...(match.units[index].roman && {
              roman: match.units[index].roman,
            }),
            ...(match.units[index].sungBy && {
              sungBy: match.units[index].sungBy,
            }),
          })),
        }
      : line;
  });
}

/** Spicy Lyrics results never seed a draft, so the creator
 * is not a way to copy them out. */
export function canSeed(lyrics: Lyrics) {
  return ["Imported TTML", "Imported LRC", "Lyssna", "Apple Music (via Lyssna)", "lrc.red", "LRCLIB", "Netease", "Spotify"].includes(lyrics.source);
}

const STYLE_INDEX = { first: 0, second: 1, third: 2 } as const;

function attachTrailingPunctuation(line: CreatorLine): CreatorLine {
  const units: CreatorUnit[] = [];
  for (const unit of line.units) {
    const previous = units.at(-1);
    if (previous && /^[\p{Pe}\p{Pf},.!?:;…、。，．？！；：؟،؛।॥]+$/u.test(unit.text)) {
      // Punctuation follows the word in print, even when the source gave it a separate beat.
      units[units.length - 1] = {
        ...previous,
        text: previous.text + unit.text,
        ...(previous.roman && { roman: previous.roman + unit.text }),
      };
    } else units.push(unit);
  }
  return units.length === line.units.length ? line : { ...line, units };
}

export function fromLyrics(lyrics: Lyrics): CreatorLine[] {
  let voices: string[] = [];
  const firstLine = lyrics.lines.findIndex((line) => line.text.trim());
  return lyrics.lines
    .flatMap((line, lineIndex): CreatorLine[] => {
      if (line.section) voices = voicesOf(line.section_singer ?? "");
      const voiceFor = (style?: keyof typeof STYLE_INDEX) =>
        style && voices.length > 1 ? voices[STYLE_INDEX[style]] : undefined;
      const authored =
        lyrics.synced &&
        line.words.length > 0 &&
        line.words.every((word) => Number.isFinite(word.start_ms) && Number.isFinite(word.end_ms));
      const units: CreatorUnit[] = authored ? [] : untimedUnits(line.text);
      if (authored) {
        let gap = true;
        for (const word of line.words) {
          const text = word.text.trim();
          if (!text) {
            gap ||= /\s/u.test(word.text);
            continue;
          }
          const sungBy = voiceFor(word.sung_by);
          units.push({
            text,
            ...(sungBy && { sungBy }),
            joined: !gap && !/^\s/u.test(word.text),
            start: word.start_ms,
            end: word.end_ms,
            ...(word.romanization?.trim() && { roman: word.romanization.trim() }),
          });
          gap = /\s$/u.test(word.text);
        }
      }
      const pieces = authored ? piecesByUnit(units, line.romanization_words) : undefined;
      const readings = line.romanization.trim().split(/\s+/);
      const perWord = !!pieces || (authored && units.length > 1 && readings.length === units.length);
      const lead: CreatorLine = {
        units: pieces
          ? units.map((unit, index) => withPieces(unit, pieces[index]))
          : perWord
            ? units.map((unit, index) => ({ ...unit, roman: unit.roman ?? readings[index] }))
            : units,
        background: line.background,
        opposite: line.opposite,
        ...(line.translation && { translation: line.translation }),
        ...(line.romanization &&
          !perWord && { romanization: line.romanization }),
        ...(line.section && { part: line.section }),
        ...(line.section && line.section_singer && { singer: line.section_singer }),
        ...(voiceFor(line.sung_by) && { sungBy: voiceFor(line.sung_by) }),
      };
      const [main, ...echoes] = splitBrackets(lead, lineIndex === firstLine).map(attachTrailingPunctuation);
      if (
        !authored &&
        lyrics.synced &&
        !lyrics.estimated_lines &&
        main.units.length &&
        line.end_ms > line.start_ms
      ) {
        const units = [...main.units];
        units[0] = { ...units[0], start: line.start_ms };
        const last = units.length - 1;
        units[last] = { ...units[last], end: line.end_ms };
        return [{ ...main, units }, ...echoes];
      }
      return [main, ...echoes];
    })
    .filter((line) => line.units.length > 0);
}

/**
 * Words in brackets are backing vocals: each bracketed run moves to a
 * background line of its own after the line, keeping its timings and
 * readings, and a line all in brackets becomes a background line. The
 * song's first line stays as it is even then: an intro of ad-libs such as
 * "(Giga, TeddyLoid)" is the lead.
 */
export function splitBrackets(
  line: CreatorLine,
  firstOfSong = false,
): CreatorLine[] {
  if (line.background || !line.units.length) return [line];
  const main: CreatorUnit[] = [];
  const echoes: CreatorUnit[][] = [];
  let open: CreatorUnit[] | undefined;
  for (const [index, unit] of line.units.entries()) {
    if (!open && (index === 0 || !unit.joined) && unit.text.startsWith("("))
      open = [];
    if (!open) {
      main.push(unit);
      continue;
    }
    open.push(unit);
    if (unit.text.endsWith(")")) {
      echoes.push(open);
      open = undefined;
    }
  }
  if (open || !echoes.length) return [line];
  if (!main.length && firstOfSong) return [line];
  const strip = (units: CreatorUnit[]): CreatorUnit[] =>
    units
      .map((unit, index) => {
        let text = unit.text;
        // A backing line starts like any other line, with a capital.
        if (index === 0)
          text = text
            .slice(1)
            .replace(/^\p{Ll}/u, (letter) => letter.toUpperCase());
        if (index === units.length - 1) text = text.replace(/\)$/, "");
        return { ...unit, text, joined: index > 0 && unit.joined };
      })
      .filter((unit) => unit.text);
  const backgrounds = echoes.map(
    (units): CreatorLine => ({
      units: strip(units),
      background: true,
      opposite: line.opposite,
    }),
  );
  if (!main.length) {
    // The line itself turns background, keeping its section and notes.
    const [first, ...rest] = backgrounds;
    return [{ ...line, ...first }, ...rest].filter((each) => each.units.length);
  }
  // The lead line now starts where a bracket ended: "(Watch it) you're".
  const lead =
    main[0] === line.units[0] ? main : [capitalFirst(main[0]), ...main.slice(1)];
  return [{ ...line, units: lead }, ...backgrounds].filter(
    (each) => each.units.length,
  );
}

const capitalFirst = (unit: CreatorUnit): CreatorUnit => ({
  ...unit,
  text: unit.text.replace(/^\p{Ll}/u, (letter) => letter.toUpperCase()),
});

/** A line's words, with the brackets of a line all in brackets kept on them. */
function untimedUnits(text: string): CreatorUnit[] {
  const [parsed] = parseText(text.replace(/\|/g, ""));
  if (!parsed) return [];
  if (!parsed.background) return parsed.units;
  const units = [...parsed.units];
  const last = units.length - 1;
  units[0] = { ...units[0], text: `(${units[0].text}` };
  units[last] = { ...units[last], text: `${units[last].text})` };
  return units;
}

/** Brackets to background lines over a whole draft; the same lines when none moved. */
export function bracketsToBackground(lines: CreatorLine[]): CreatorLine[] {
  const first = lines.findIndex((line) => line.units.length);
  let changed = false;
  const next = lines.flatMap((line, index) => {
    const split = splitBrackets(line, index === first);
    if (split.length !== 1 || split[0] !== line) changed = true;
    return split;
  });
  return changed ? next : lines;
}

/** Each timed reading piece in the word it starts in; undefined when one fits none. */
function piecesByUnit(units: CreatorUnit[], pieces: Word[] = []) {
  if (!pieces.length) return;
  const owned = units.map((): Word[] => []);
  for (const piece of pieces) {
    const at = units.findIndex(
      (unit) =>
        unit.start !== undefined &&
        piece.start_ms + 1 >= unit.start &&
        piece.start_ms < Math.max(unit.end ?? unit.start, unit.start + 1),
    );
    if (at < 0) return;
    owned[at].push(piece);
  }
  return owned;
}

function withPieces(unit: CreatorUnit, pieces: Word[]): CreatorUnit {
  const texts = pieces.map((piece) => piece.text.trim()).filter(Boolean);
  // A Latin word the transliteration left out comes back as itself.
  if (!texts.length || (texts.length === 1 && texts[0] === unit.text)) return unit;
  return {
    ...unit,
    roman: texts.join("|"),
    romanSpaced: /^\s/.test(pieces[0].text),
    ...(pieces.length > 1 && {
      romanStarts: pieces.slice(1).map((piece) => piece.start_ms),
    }),
  };
}

/**
 * Where a romanized reading splits into syllables, as letter offsets:
 * "inochi" to i|no|chi, "konrinzai" to kon|rin|zai, "chotto" to chot|to.
 */
export function romajiSyllables(reading: string): number[] {
  const chars = Array.from(reading.toLowerCase());
  const vowel = (char?: string) => !!char && "aeiouāēīōū".includes(char);
  const letter = (char?: string) => !!char && /\p{L}/u.test(char);
  const cuts: number[] = [];
  for (let at = 1; at < chars.length; at++) {
    const [before, here, after] = [chars[at - 1], chars[at], chars[at + 1]];
    if (!letter(here) || !letter(before) || vowel(here)) continue;
    // A closing n stays with its syllable: kon|rin.
    const closingN = here === "n" && !vowel(after) && after !== "y";
    // A doubled consonant splits between its two letters: chot|to.
    const doubled = here === after;
    if (
      (vowel(before) && !closingN && !doubled) ||
      (here === before && here !== "n")
    )
      cuts.push(at);
    else if (before === "n" && !vowel(here) && here !== "y") cuts.push(at);
  }
  return cuts;
}

/** The pieces a reading is sung in. */
export const romanParts = (unit: CreatorUnit) =>
  (unit.roman ?? "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);

/**
 * A timed word's reading piece by piece, each with its own timing. Pieces
 * not yet tapped share the time around them evenly.
 */
export function romanPieces(unit: CreatorUnit) {
  if (unit.start === undefined || unit.end === undefined) return [];
  const parts = romanParts(unit);
  const texts = parts.length ? parts : [unit.text];
  const end = Math.max(unit.start, unit.end);
  const starts: number[] = [unit.start];
  for (let index = 1; index < texts.length; index++) {
    const given = unit.romanStarts?.[index - 1];
    starts.push(
      typeof given === "number" && given > starts[index - 1] && given < end
        ? given
        : NaN,
    );
  }
  for (let index = 1; index < starts.length; index++) {
    if (!Number.isNaN(starts[index])) continue;
    let known = index;
    while (known < starts.length && Number.isNaN(starts[known])) known++;
    const to = known < starts.length ? starts[known] : end;
    const step = (to - starts[index - 1]) / (known - index + 1);
    for (let at = index; at < known; at++)
      starts[at] = starts[index - 1] + step * (at - index + 1);
  }
  return texts.map((text, index) => ({
    text,
    start: starts[index],
    end: index + 1 < starts.length ? starts[index + 1] : end,
  }));
}

export const timed = (unit: CreatorUnit) =>
  unit.start !== undefined && unit.end !== undefined;

export function progress(lines: CreatorLine[]) {
  let done = 0,
    total = 0;
  for (const line of lines)
    for (const unit of line.units) {
      total++;
      if (timed(unit)) done++;
    }
  return { done, total };
}

export function nextCursor(lines: CreatorLine[], at: Cursor): Cursor | null {
  const unit = lines[at.line]?.units[at.unit];
  const part = at.part ?? 0;
  if (unit && part + 1 < romanParts(unit).length)
    return { line: at.line, unit: at.unit, part: part + 1 };
  if (at.unit + 1 < (lines[at.line]?.units.length ?? 0))
    return { line: at.line, unit: at.unit + 1 };
  for (let line = at.line + 1; line < lines.length; line++)
    if (lines[line].units.length) return { line, unit: 0 };
  return null;
}

export function previousCursor(
  lines: CreatorLine[],
  at: Cursor,
): Cursor | null {
  if (at.part) return { ...at, part: at.part - 1 };
  if (at.unit > 0) return { line: at.line, unit: at.unit - 1 };
  for (let line = at.line - 1; line >= 0; line--)
    if (lines[line].units.length)
      return { line, unit: lines[line].units.length - 1 };
  return null;
}

export function clampCursor(lines: CreatorLine[], at: Cursor): Cursor {
  if (!lines.length) return { line: 0, unit: 0 };
  const line = Math.min(Math.max(0, at.line), lines.length - 1);
  const unit = Math.min(
    Math.max(0, at.unit),
    Math.max(0, lines[line].units.length - 1),
  );
  return { line, unit };
}

function patch(
  lines: CreatorLine[],
  at: Cursor,
  change: Partial<CreatorUnit>,
): CreatorLine[] {
  return lines.map((line, index) =>
    index === at.line
      ? {
          ...line,
          units: line.units.map((unit, position) =>
            position === at.unit ? { ...unit, ...change } : unit,
          ),
        }
      : line,
  );
}

/** Sets when piece `part` of a split reading starts. */
function startPiece(unit: CreatorUnit, part: number, time: number) {
  const starts = Array.from(
    { length: romanParts(unit).length - 1 },
    (_, index) => unit.romanStarts?.[index] ?? null,
  );
  starts[part - 1] = time;
  return { romanStarts: starts };
}

export function markStart(lines: CreatorLine[], at: Cursor, time: number) {
  const unit = lines[at.line]?.units[at.unit];
  if (!unit) return lines;
  if (at.part) return patch(lines, at, startPiece(unit, at.part, time));
  return patch(lines, at, {
    start: time,
    end: unit.end !== undefined && unit.end > time ? unit.end : undefined,
  });
}

export function markEnd(
  lines: CreatorLine[],
  at: Cursor,
  time: number,
): { lines: CreatorLine[]; cursor: Cursor } {
  const unit = lines[at.line]?.units[at.unit];
  if (!unit) return { lines, cursor: at };
  const part = at.part ?? 0;
  // Ending a piece before the last starts the next one; the word goes on.
  if (part + 1 < romanParts(unit).length)
    return {
      lines: patch(lines, at, {
        ...(part === 0 && unit.start === undefined && { start: time }),
        ...startPiece(unit, part + 1, time),
      }),
      cursor: nextCursor(lines, at) ?? at,
    };
  const start = Math.min(unit.start ?? time, time);
  return {
    lines: patch(lines, at, { start, end: time }),
    cursor: nextCursor(lines, at) ?? at,
  };
}

/**
 * Where a tap at `time` lands. A tap earlier than anything already timed
 * on the cursor's line belongs to an earlier line still being timed: the
 * word that line is singing, or the first one after its timed words.
 */
export function timingCursor(
  lines: CreatorLine[],
  at: Cursor,
  time: number,
): Cursor {
  const known = (lines[at.line]?.units ?? []).flatMap((unit) =>
    [unit.start, unit.end].filter((value) => value !== undefined),
  );
  if (!known.length || time >= Math.min(...known)) return at;
  for (let line = at.line - 1; line >= 0; line--) {
    const units = lines[line].units;
    let last = -1;
    units.forEach((unit, index) => {
      if (unit.start !== undefined && unit.start <= time) last = index;
    });
    if (last < 0) continue;
    if (units[last].end === undefined) return { line, unit: last };
    const next = units.findIndex(
      (unit, index) => index > last && unit.start === undefined,
    );
    return next < 0 ? at : { line, unit: next };
  }
  return at;
}

export function markNext(
  lines: CreatorLine[],
  at: Cursor,
  time: number,
): { lines: CreatorLine[]; cursor: Cursor } {
  const ended = markEnd(lines, at, time);
  const next = nextCursor(lines, at);
  if (!next) return ended;
  return { lines: markStart(ended.lines, next, time), cursor: next };
}

export function clearTiming(lines: CreatorLine[], at: Cursor) {
  return patch(lines, at, {
    start: undefined,
    end: undefined,
    romanStarts: undefined,
  });
}

export function clearAll(lines: CreatorLine[]): CreatorLine[] {
  return lines.map((line) => ({
    ...line,
    units: line.units.map(({ text, joined }) => ({ text, joined })),
  }));
}

export function toggleLine(
  lines: CreatorLine[],
  index: number,
  key: "background" | "opposite",
): CreatorLine[] {
  return lines.map((line, position) =>
    position === index ? { ...line, [key]: !line[key] } : line,
  );
}

export function setLineFlag(
  lines: CreatorLine[],
  picked: ReadonlySet<number>,
  key: "background" | "opposite",
  on: boolean,
): CreatorLine[] {
  return lines.map((line, index) =>
    picked.has(index) ? { ...line, [key]: on } : line,
  );
}

export function shiftLines(
  lines: CreatorLine[],
  picked: ReadonlySet<number>,
  ms: number,
): CreatorLine[] {
  const move = (time?: number) =>
    time === undefined ? undefined : Math.max(0, time + ms);
  return lines.map((line, index) =>
    picked.has(index)
      ? {
          ...line,
          units: line.units.map((unit) => ({
            ...unit,
            start: move(unit.start),
            end: move(unit.end),
          })),
        }
      : line,
  );
}

export function clearLines(
  lines: CreatorLine[],
  picked: ReadonlySet<number>,
): CreatorLine[] {
  return lines.map((line, index) =>
    picked.has(index)
      ? {
          ...line,
          units: line.units.map((unit) => ({
            ...unit,
            start: undefined,
            end: undefined,
          })),
        }
      : line,
  );
}

export const removeLines = (
  lines: CreatorLine[],
  picked: ReadonlySet<number>,
) => lines.filter((_, index) => !picked.has(index));

export function editUnit(
  lines: CreatorLine[],
  at: Cursor,
  text: string,
): CreatorLine[] {
  const line = lines[at.line];
  const unit = line?.units[at.unit];
  if (!unit) return lines;
  const parts = parseText(text.replace(/[()]/g, ""))[0]?.units ?? [];
  if (parts.length === 1 && parts[0].text === unit.text) return lines;
  const replaced = parts.map((part, index) => ({
    text: part.text,
    joined: index === 0 ? unit.joined : part.joined,
    ...(parts.length === 1 && { start: unit.start, end: unit.end }),
  }));
  const after = line.units.slice(at.unit + 1);
  // Deleting a word's first syllable makes the next syllable start the word.
  if (!replaced.length && !unit.joined && after[0]?.joined)
    after[0] = { ...after[0], joined: false };
  const units = [...line.units.slice(0, at.unit), ...replaced, ...after];
  if (units.length) units[0] = { ...units[0], joined: false };
  return units.length
    ? lines.map((each, index) =>
        index === at.line ? { ...each, units } : each,
      )
    : lines.filter((_, index) => index !== at.line);
}

const SHORTEST_MS = 10;

/** Moves one edge of a timed syllable, dragging a neighbour that shares it. */
export function moveEdge(
  lines: CreatorLine[],
  at: Cursor,
  edge: "start" | "end",
  time: number,
  detach = false,
): CreatorLine[] {
  const units = lines[at.line]?.units;
  const unit = units?.[at.unit];
  if (!unit || unit.start === undefined || unit.end === undefined) return lines;
  const before = units[at.unit - 1];
  const after = units[at.unit + 1];
  // Detached, a touching neighbour stays where it is and the edge can only
  // pull away from it, leaving a gap.
  const shared =
    !detach &&
    (edge === "start"
      ? before?.end !== undefined && before.end === unit.start
      : after?.start !== undefined && after.start === unit.end);
  const [low, high] =
    edge === "start"
      ? [
          shared
            ? (before.start ?? 0) + SHORTEST_MS
            : (before?.end ?? before?.start ?? 0),
          unit.end - SHORTEST_MS,
        ]
      : [
          unit.start + SHORTEST_MS,
          shared
            ? (after.end ?? Infinity) - SHORTEST_MS
            : (after?.start ?? Infinity),
        ];
  const moved = Math.round(Math.min(high, Math.max(low, Math.max(0, time))));
  if (moved === unit[edge]) return lines;
  const next = units.map((each, index) => {
    if (index === at.unit) return { ...each, [edge]: moved };
    if (shared && index === at.unit + (edge === "start" ? -1 : 1))
      return { ...each, [edge === "start" ? "end" : "start"]: moved };
    return each;
  });
  return lines.map((line, index) =>
    index === at.line ? { ...line, units: next } : line,
  );
}

/**
 * Slides a timed syllable to start at `time`, keeping its length. A
 * neighbour sharing an edge stretches or shrinks with it; any other
 * neighbour stops it.
 */
export function panUnit(
  lines: CreatorLine[],
  at: Cursor,
  time: number,
  detach = false,
): CreatorLine[] {
  const units = lines[at.line]?.units;
  const unit = units?.[at.unit];
  if (!unit || unit.start === undefined || unit.end === undefined) return lines;
  const length = unit.end - unit.start;
  const before = units[at.unit - 1];
  const after = units[at.unit + 1];
  const sharedBefore =
    !detach && before?.end !== undefined && before.end === unit.start;
  const sharedAfter =
    !detach && after?.start !== undefined && after.start === unit.end;
  const low = sharedBefore
    ? (before.start ?? 0) + SHORTEST_MS
    : (before?.end ?? before?.start ?? 0);
  const high =
    (sharedAfter
      ? (after.end ?? Infinity) - SHORTEST_MS
      : (after?.start ?? Infinity)) - length;
  const start = Math.round(Math.min(high, Math.max(low, Math.max(0, time))));
  if (start === unit.start || high < low) return lines;
  const next = units.map((each, index) => {
    if (index === at.unit) return { ...each, start, end: start + length };
    if (sharedBefore && index === at.unit - 1) return { ...each, end: start };
    if (sharedAfter && index === at.unit + 1)
      return { ...each, start: start + length };
    return each;
  });
  return lines.map((line, index) =>
    index === at.line ? { ...line, units: next } : line,
  );
}

export function replaceMatching(
  lines: CreatorLine[],
  text: string,
  value: string,
  matchCase: boolean,
): CreatorLine[] {
  const same = (other: string) =>
    matchCase ? other === text : other.toLowerCase() === text.toLowerCase();
  let next = lines;
  for (let line = lines.length - 1; line >= 0; line--)
    for (let unit = lines[line].units.length - 1; unit >= 0; unit--)
      if (same(lines[line].units[unit].text))
        next = editUnit(next, { line, unit }, value);
  return next;
}

export function appendWords(
  lines: CreatorLine[],
  lineIndex: number,
  text: string,
): CreatorLine[] {
  const line = lines[lineIndex];
  const clean = text.replace(/[()]/g, "");
  const added = parseText(clean)[0]?.units ?? [];
  const spaceAfter = /\s$/.test(clean);
  if (!line || (!added.length && (!spaceAfter || line.spaceAfter)))
    return lines;
  // A leading | continues the last word as a syllable, as does anything
  // after a word left open with a hyphen.
  const last = line.units[line.units.length - 1];
  if (added.length)
    added[0] = {
      ...added[0],
      joined:
        !!last && !line.spaceAfter && (/^\|/.test(clean) || runsOn(last.text)),
    };
  const { spaceAfter: _, ...rest } = line;
  const next: CreatorLine = { ...rest, units: [...line.units, ...added] };
  if (spaceAfter || (!added.length && line.spaceAfter)) next.spaceAfter = true;
  return lines.map((each, index) => (index === lineIndex ? next : each));
}

export const dropTrailingSpace = (lines: CreatorLine[], lineIndex: number) =>
  lines.map((line, index): CreatorLine => {
    if (index !== lineIndex) return line;
    const { spaceAfter: _, ...rest } = line;
    return rest;
  });

function divided(unit: CreatorUnit, parts: string[]): CreatorUnit[] {
  const { start, end } = unit;
  const total = parts.length;
  let before = 0;
  return parts.map((text, index) => {
    const piece: CreatorUnit = { text, joined: index ? true : unit.joined };
    if (start !== undefined && end !== undefined) {
      piece.start = Math.round(start + ((end - start) * before) / total);
      before += 1;
      piece.end = Math.round(start + ((end - start) * before) / total);
    } else {
      if (index === 0 && start !== undefined) piece.start = start;
      if (index === parts.length - 1 && end !== undefined) piece.end = end;
    }
    return piece;
  });
}

export function splitUnit(
  lines: CreatorLine[],
  at: Cursor,
  parts: string[],
): CreatorLine[] {
  const unit = lines[at.line]?.units[at.unit];
  const kept = parts.filter(Boolean);
  if (!unit || kept.length < 2) return lines;
  return lines.map((line, index) =>
    index === at.line
      ? {
          ...line,
          units: [
            ...line.units.slice(0, at.unit),
            ...divided(unit, kept),
            ...line.units.slice(at.unit + 1),
          ],
        }
      : line,
  );
}

export function splitMatching(
  lines: CreatorLine[],
  text: string,
  cut: (text: string) => string[],
  ignoreCase: boolean,
): CreatorLine[] {
  const same = (other: string) =>
    ignoreCase ? other.toLowerCase() === text.toLowerCase() : other === text;
  return lines.map((line) => ({
    ...line,
    units: line.units.flatMap((unit) =>
      same(unit.text) ? divided(unit, cut(unit.text).filter(Boolean)) : [unit],
    ),
  }));
}

/** A line split in two ends where a comma stood; the comma goes. */
function dropEndComma(units: CreatorUnit[]): CreatorUnit[] {
  const last = units[units.length - 1];
  const text = last?.text.replace(/[,，、]+$/u, "");
  if (!last || !text || text === last.text) return units;
  return [...units.slice(0, -1), { ...last, text }];
}

export function breakLine(
  lines: CreatorLine[],
  at: Cursor,
  onlyThisWord: boolean,
  picked: Cursor[] = [],
): CreatorLine[] {
  const line = lines[at.line];
  if (!line?.units[at.unit]) return lines;
  const chosen =
    picked.length > 1 &&
    picked.some((each) => each.line === at.line && each.unit === at.unit);
  if (chosen && onlyThisWord) return picksToNewLine(lines, picked, at.line);
  if (chosen)
    at = {
      line: at.line,
      unit: Math.min(
        ...picked
          .filter((each) => each.line === at.line)
          .map((each) => each.unit),
      ),
    };
  const moved = onlyThisWord
    ? [line.units[at.unit]]
    : line.units.slice(at.unit);
  const stay = onlyThisWord
    ? line.units.filter((_, index) => index !== at.unit)
    : line.units.slice(0, at.unit);
  if (!stay.length) return lines;
  const capital = capitalised(line.units[0]);
  const fresh = (units: CreatorUnit[]) =>
    units.map((unit, index) =>
      index
        ? unit
        : capital
          ? cased({ ...unit, joined: false }, true)
          : { ...unit, joined: false },
    );
  return [
    ...lines.slice(0, at.line),
    { ...line, units: dropEndComma(fresh(stay)) },
    {
      units: dropEndComma(fresh(moved)),
      background: line.background,
      opposite: line.opposite,
    },
    ...lines.slice(at.line + 1),
  ];
}

function picksToNewLine(
  lines: CreatorLine[],
  picked: Cursor[],
  after: number,
): CreatorLine[] {
  const { taken, words, moved } = gather(lines, picked);
  if (!words.length) return lines;
  const fresh: CreatorUnit[] = words.map((unit, index) =>
    index === 0
      ? capitalised(lines[after].units[0])
        ? cased(unit, true)
        : unit
      : moved[index].first
        ? cased(unit, false)
        : unit,
  );
  return lines.flatMap((line, index) => {
    const units = without(line.units, taken);
    if (units[0]?.joined) units[0] = { ...units[0], joined: false };
    recase(line.units, units, -1, moved);
    const kept =
      units.length || !line.units.length
        ? [{ ...line, units: units.length < line.units.length ? dropEndComma(units) : units }]
        : [];
    return index === after
      ? [
          ...kept,
          {
            units: dropEndComma(fresh),
            background: line.background,
            opposite: line.opposite,
          },
        ]
      : kept;
  });
}

// Picked words are found by identity, so the copy needs its own words or
// an edit to either line would land on both.
export const duplicateLine = (lines: CreatorLine[], index: number) =>
  lines[index]
    ? [
        ...lines.slice(0, index + 1),
        {
          ...lines[index],
          units: lines[index].units.map((unit) => ({ ...unit })),
        },
        ...lines.slice(index + 1),
      ]
    : lines;

export function toggleJoin(lines: CreatorLine[], at: Cursor): CreatorLine[] {
  if (at.unit === 0) return lines;
  return lines.map((line, index) =>
    index === at.line
      ? {
          ...line,
          units: line.units.map((unit, position) =>
            position === at.unit ? { ...unit, joined: !unit.joined } : unit,
          ),
        }
      : line,
  );
}

/** Removes the Space blocks before each `unit`; past the last word, the
 * trailing space. */
export function removeSpaces(
  lines: CreatorLine[],
  gaps: Cursor[],
): CreatorLine[] {
  return lines.map((line, index): CreatorLine => {
    const here = gaps.filter((gap) => gap.line === index);
    if (!here.length) return line;
    const { spaceAfter, ...rest } = line;
    const next: CreatorLine = {
      ...rest,
      units: line.units.map((unit, position) =>
        position && here.some((gap) => gap.unit === position)
          ? { ...unit, joined: true }
          : unit,
      ),
    };
    if (spaceAfter && !here.some((gap) => gap.unit === line.units.length))
      next.spaceAfter = true;
    return next;
  });
}

export function insertLines(
  lines: CreatorLine[],
  after: number,
  text: string,
): CreatorLine[] {
  const added = parseText(text);
  return [...lines.slice(0, after + 1), ...added, ...lines.slice(after + 1)];
}

/** Deletes the picked words and Space blocks in one go. */
/**
 * `units` less `gone`. A syllable left behind starts its own word when the
 * word it belonged to lost its first syllable; `joins` lose their space.
 */
function without(
  units: CreatorUnit[],
  gone: ReadonlySet<CreatorUnit>,
  joins: ReadonlySet<CreatorUnit> = new Set(),
) {
  const kept: CreatorUnit[] = [];
  let parted = false;
  for (const unit of units) {
    if (gone.has(unit)) {
      if (!unit.joined) parted = true;
      continue;
    }
    const joined =
      kept.length > 0 && ((unit.joined && !parted) || joins.has(unit));
    kept.push(joined === unit.joined ? unit : { ...unit, joined });
    parted = false;
  }
  return kept;
}

export function deletePicked(
  lines: CreatorLine[],
  words: Cursor[],
  gaps: Cursor[],
): CreatorLine[] {
  const gone = new Set(
    words.flatMap((at) => lines[at.line]?.units[at.unit] ?? []),
  );
  const joins = new Set(
    gaps.flatMap((gap) => lines[gap.line]?.units[gap.unit] ?? []),
  );
  return lines
    .map((line, index): CreatorLine => {
      const { spaceAfter, ...rest } = line;
      const units = without(line.units, gone, joins);
      const next: CreatorLine = { ...rest, units };
      const trailing = gaps.some(
        (gap) => gap.line === index && gap.unit === line.units.length,
      );
      if (spaceAfter && !trailing) next.spaceAfter = true;
      return next;
    })
    .filter((line, index) => line.units.length || !lines[index].units.length);
}

export const insertBlankLine = (lines: CreatorLine[], after: number) => [
  ...lines.slice(0, after + 1),
  { units: [], background: false, opposite: false },
  ...lines.slice(after + 1),
];

export const removeLine = (lines: CreatorLine[], index: number) =>
  lines.filter((_, position) => position !== index);

/** `before` counts positions in the list before the move. */
export function moveLine(lines: CreatorLine[], from: number, before: number) {
  if (!lines[from] || before === from || before === from + 1) return lines;
  const rest = lines.filter((_, index) => index !== from);
  const at = before > from ? before - 1 : before;
  return [...rest.slice(0, at), lines[from], ...rest.slice(at)];
}

export function wordBounds(units: CreatorUnit[], index: number) {
  let start = index;
  while (start > 0 && units[start].joined) start--;
  let end = index + 1;
  while (end < units.length && units[end].joined) end++;
  return { start, end };
}

const capitalised = (unit?: CreatorUnit) =>
  !!unit && /^\P{L}*\p{Lu}/u.test(unit.text);

function cased(unit: CreatorUnit, upper: boolean): CreatorUnit {
  // "I" and acronyms keep their capitals in the middle of a line.
  if (
    !upper &&
    (/^\P{L}*I(?!\p{L})/u.test(unit.text) ||
      (unit.text.match(/\p{Lu}/gu)?.length ?? 0) > 1)
  )
    return unit;
  const text = unit.text.replace(/\p{L}/u, (letter) =>
    upper ? letter.toUpperCase() : letter.toLowerCase(),
  );
  return text === unit.text ? unit : { ...unit, text };
}

/**
 * Keeps sentence case after `moved` words land at `at` in `units`, a line
 * that was `before`. Lines written in lower case stay that way.
 */
function recase(
  before: CreatorUnit[],
  units: CreatorUnit[],
  at: number,
  moved: { unit: CreatorUnit; first: boolean; capital: boolean }[],
) {
  const lost = moved.some((each) => each.unit === before[0]);
  if (at === 0 && moved.length && !before.length) {
    if (moved[0].capital) units[0] = cased(units[0], true);
  } else if (at === 0 && moved.length) {
    const displaced = units[moved.length];
    if (!lost && capitalised(displaced)) {
      units[0] = cased(units[0], true);
      units[moved.length] = cased(displaced, false);
    }
  } else if (lost && units.length && capitalised(before[0]))
    units[0] = cased(units[0], true);
  if (at >= 0)
    moved.forEach((each, index) => {
      const spot = at + index;
      if (spot > 0 && each.first && units[spot])
        units[spot] = cased(units[spot], false);
    });
}

/** `to.unit` is a word boundary in the target line, counted before the move. */
export function moveWord(
  lines: CreatorLine[],
  from: Cursor,
  to: Cursor,
): CreatorLine[] {
  const source = lines[from.line];
  const target = lines[to.line];
  if (!source?.units[from.unit] || !target) return lines;
  const { start, end } = wordBounds(source.units, from.unit);
  const same = from.line === to.line;
  if (same && to.unit >= start && to.unit <= end) return lines;
  const word = source.units
    .slice(start, end)
    .map((unit, index) => (index ? unit : { ...unit, joined: false }));
  const kept = source.units.filter((_, index) => index < start || index >= end);
  if (kept[0]) kept[0] = { ...kept[0], joined: false };
  const into = same ? kept : target.units;
  const at = same && to.unit > start ? to.unit - word.length : to.unit;
  // Dropped between two syllables, it becomes a syllable of that word.
  if (into[at]?.joined) word[0] = { ...word[0], joined: true };
  const placed = [...into.slice(0, at), ...word, ...into.slice(at)];
  const moved = source.units.slice(start, end).map((unit, index) => ({
    unit,
    first: start === 0 && index === 0,
    capital: capitalised(source.units[0]),
  }));
  if (!same) recase(source.units, kept, -1, moved);
  recase(same ? source.units : target.units, placed, at, moved);
  return lines
    .map((line, index) =>
      index === to.line
        ? {
            ...line,
            units: placed,
            ...(!target.units.length && source.background
              ? { background: true }
              : {}),
          }
        : index === from.line
          ? { ...line, units: kept }
          : line,
    )
    .filter((line) => line.units.length);
}

function gather(lines: CreatorLine[], from: Cursor[]) {
  const taken = new Set<CreatorUnit>();
  const words: CreatorUnit[] = [];
  const moved: { unit: CreatorUnit; first: boolean; capital: boolean }[] = [];
  let previous: Cursor | null = null;
  for (const at of [...from].sort(
    (a, b) => a.line - b.line || a.unit - b.unit,
  )) {
    const unit = lines[at.line]?.units[at.unit];
    if (!unit || taken.has(unit)) continue;
    // Syllables picked side by side stay one word; anything else moves as
    // its own word.
    const follows = previous?.line === at.line && previous.unit === at.unit - 1;
    taken.add(unit);
    words.push(follows ? unit : { ...unit, joined: false });
    moved.push({
      unit,
      first: at.unit === 0,
      capital: capitalised(lines[at.line].units[0]),
    });
    previous = at;
  }
  return { taken, words, moved };
}

/** Moves several words, kept in reading order, to before `to.unit`. */
export function moveWords(
  lines: CreatorLine[],
  from: Cursor[],
  to: Cursor,
): CreatorLine[] {
  if (!lines[to.line]) return lines;
  const spots = [...new Set(from.map((at) => at.unit))].sort((a, b) => a - b);
  if (
    from.every((at) => at.line === to.line) &&
    spots.at(-1)! - spots[0] === spots.length - 1 &&
    to.unit >= spots[0] &&
    to.unit <= spots.at(-1)! + 1
  )
    return lines;
  const { taken, words, moved } = gather(lines, from);
  const anchor = lines[to.line].units[to.unit];
  if (!words.length || (anchor && taken.has(anchor))) return lines;
  const at = lines[to.line].units
    .slice(0, to.unit)
    .filter((unit) => !taken.has(unit)).length;
  // A new, empty line filled only from background lines is one too.
  const background =
    !lines[to.line].units.length &&
    from.every((each) => lines[each.line]?.background);
  return lines
    .map((line, index) => {
      const units = without(line.units, taken);
      if (index === to.line)
        units.splice(
          at,
          0,
          ...(units[at]?.joined
            ? [{ ...words[0], joined: true }, ...words.slice(1)]
            : words),
        );
      if (units[0]?.joined) units[0] = { ...units[0], joined: false };
      if (index === to.line) recase(line.units, units, at, moved);
      else recase(line.units, units, -1, moved);
      if (index === to.line && background)
        return { ...line, units, background: true };
      return units.length === line.units.length &&
        units.every((unit, position) => unit === line.units[position])
        ? line
        : { ...line, units };
    })
    .filter((line) => line.units.length);
}

/** Moves the gap before `from.unit` to before `to.unit`, a syllable joint. */
export function moveSpace(
  lines: CreatorLine[],
  from: Cursor,
  to: Cursor,
): CreatorLine[] {
  const units = lines[from.line]?.units;
  if (
    !units ||
    from.line !== to.line ||
    from.unit === 0 ||
    units[from.unit]?.joined !== false ||
    !units[to.unit]?.joined
  )
    return lines;
  return lines.map((line, index) =>
    index === from.line
      ? {
          ...line,
          units: units.map((unit, position) =>
            position === from.unit
              ? { ...unit, joined: true }
              : position === to.unit
                ? { ...unit, joined: false }
                : unit,
          ),
        }
      : line,
  );
}

const bareReading = (roman?: string) =>
  roman?.replace(/\|/g, "").toLowerCase();

/** Other words with this reading, however it is split. */
export function sameReadings(lines: CreatorLine[], at: Cursor): number {
  const bare = bareReading(lines[at.line]?.units[at.unit]?.roman);
  if (!bare) return 0;
  return lines.reduce(
    (count, line, index) =>
      count +
      line.units.filter(
        (unit, position) =>
          (index !== at.line || position !== at.unit) &&
          bareReading(unit.roman) === bare,
      ).length,
    0,
  );
}

/**
 * Splits every reading the same as `reading` ("i|no|chi") at the same
 * letters, each keeping its own letter case.
 */
export function splitReadings(
  lines: CreatorLine[],
  reading: string,
): CreatorLine[] {
  const bare = bareReading(reading);
  if (!bare) return lines;
  const cuts = new Set<number>();
  let letters = 0;
  for (const char of reading) {
    if (char === "|") cuts.add(letters);
    else letters++;
  }
  return lines.map((line) => {
    if (!line.units.some((unit) => bareReading(unit.roman) === bare))
      return line;
    return {
      ...line,
      units: line.units.map((unit) => {
        if (bareReading(unit.roman) !== bare) return unit;
        const roman = Array.from(unit.roman!.replace(/\|/g, ""))
          .map((char, index) => (cuts.has(index) ? `|${char}` : char))
          .join("");
        if (roman === unit.roman) return unit;
        return {
          ...unit,
          roman,
          romanAuto: undefined,
          romanStarts:
            roman.split("|").length === unit.roman!.split("|").length
              ? unit.romanStarts
              : undefined,
        };
      }),
    };
  });
}

export function setUnitRoman(
  lines: CreatorLine[],
  at: Cursor,
  value: string,
): CreatorLine[] {
  const unit = lines[at.line]?.units[at.unit];
  const roman = value.trim() || undefined;
  if (!unit || unit.roman === roman) return lines;
  return lines.map((line, index) =>
    index === at.line
      ? {
          ...line,
          units: line.units.map((each, position) =>
            position === at.unit
              ? {
                  ...each,
                  roman,
                  romanAuto: undefined,
                  // Taps for pieces that changed no longer fit.
                  romanStarts:
                    roman?.split("|").length === unit.roman?.split("|").length
                      ? each.romanStarts
                      : undefined,
                }
              : each,
          ),
        }
      : line,
  );
}

export const hasWordRoman = (line: CreatorLine) =>
  line.units.some((unit) => unit.roman);

export function setLineText(
  lines: CreatorLine[],
  index: number,
  key: "translation" | "romanization",
  value: string,
): CreatorLine[] {
  return lines.map((line, position) =>
    position === index ? { ...line, [key]: value || undefined } : line,
  );
}

export function cursorAt(lines: CreatorLine[], ms: number): Cursor {
  let line = -1;
  lines.forEach((each, index) => {
    const span = lineSpan(each);
    if (span && span.start <= ms) line = index;
  });
  if (line < 0) return { line: 0, unit: 0 };
  let unit = 0;
  lines[line].units.forEach((each, index) => {
    if (each.start !== undefined && each.start <= ms) unit = index;
  });
  return { line, unit };
}

export function lineSpan(line: CreatorLine, onlyTimed = false) {
  const units = onlyTimed ? line.units.filter(timed) : line.units;
  const starts = units.flatMap((unit) =>
    unit.start === undefined ? [] : [unit.start],
  );
  const ends = units.flatMap((unit) =>
    unit.end === undefined ? [] : [unit.end],
  );
  if (!starts.length) return null;
  return {
    start: Math.min(...starts),
    end: Math.max(...(ends.length ? ends : starts)),
  };
}

/** Lines and words sung at `position`; overlapping lines sing together. */
export function singingAt(lines: CreatorLine[], position: number) {
  const live = new Set<string>();
  const singing = new Set<number>();
  lines.forEach((line, lineIndex) => {
    const span = lineSpan(line);
    if (span && position >= span.start && position < span.end)
      singing.add(lineIndex);
    line.units.forEach((unit, unitIndex) => {
      if (
        unit.start !== undefined &&
        unit.end !== undefined &&
        position >= unit.start &&
        position < unit.end
      )
        live.add(`${lineIndex}:${unitIndex}`);
    });
  });
  return { live, singing };
}

export function problems(lines: CreatorLine[]): string[] {
  const found: string[] = [];
  if (!lines.length) return ["Add some lyrics first."];
  const { done, total } = progress(lines);
  if (done < total)
    found.push(
      `${total - done} of ${total} ${total === 1 ? "word has" : "words have"} no timing yet.`,
    );
  let backwards = 0;
  for (const line of lines)
    for (const unit of line.units)
      if (timed(unit) && unit.end! < unit.start!) backwards++;
  if (backwards)
    found.push(
      `${backwards} ${backwards === 1 ? "word ends" : "words end"} before ${backwards === 1 ? "it starts" : "they start"}.`,
    );
  return found;
}

export function toLyrics(lines: CreatorLine[]): Lyrics {
  const shown: Line[] = [];
  // Background vocals sit with the singer before them, as in the TTML file.
  let leadOpposite = false;
  let voices: string[] = [];
  for (const line of lines) {
    if (line.part) voices = voicesOf(line.singer ?? "");
    const voiceOf = (name?: string): Word["sung_by"] =>
      name ? (["first", "second", "third"] as const)[voices.indexOf(name)] : undefined;
    const voice = voiceOf(line.sungBy);
    if (!line.background && line.units.length) leadOpposite = line.opposite;
    const words: Word[] = [];
    let gap = false;
    for (const unit of line.units) {
      gap ||= !unit.joined;
      if (unit.start === undefined) continue;
      const sung_by = voiceOf(unit.sungBy);
      words.push({
        start_ms: unit.start,
        end_ms: Math.max(unit.start, unit.end ?? unit.start),
        text: gap && words.length ? ` ${unit.text}` : unit.text,
        ...(sung_by && { sung_by }),
      });
      gap = false;
    }
    const span = lineSpan(line);
    if (!span || !words.length) continue;
    shown.push({
      start_ms: span.start,
      end_ms: span.end,
      text: words.map((word) => word.text).join(""),
      translation: line.translation ?? "",
      // One reading per word lets the lyrics page sing them word by word.
      romanization: hasWordRoman(line)
        ? line.units
            .filter((unit) => unit.start !== undefined)
            .map(
              (unit, index) =>
                (readingSpaced(unit, index) ? " " : "") +
                (romanParts(unit).join("") || unit.text),
            )
            .join("")
        : (line.romanization ?? ""),
      ...(hasWordRoman(line) && {
        romanization_words: line.units.filter(timed).flatMap((unit, index) =>
          romanPieces(unit).map((piece, part) => ({
            start_ms: piece.start,
            end_ms: piece.end,
            text:
              part === 0 && readingSpaced(unit, index)
                ? ` ${piece.text}`
                : piece.text,
          })),
        ),
      }),
      words,
      background: line.background,
      opposite: line.background ? leadOpposite : line.opposite,
      ...(voice && voice !== "first" && { sung_by: voice }),
      ...(line.part && { section: line.part, section_singer: line.singer }),
    });
  }
  return {
    lines: shown,
    source: "TTML Creator",
    instrumental: false,
    synced: true,
  };
}

export function formatTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

const filled = (values: string[]) => [
  ...new Set(values.map((value) => value.trim()).filter(Boolean)),
];
const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Whether a word's reading stands apart from the reading before it. */
const readingSpaced = (unit: CreatorUnit, index: number) =>
  index > 0 && (unit.roman ? (unit.romanSpaced ?? !unit.joined) : !unit.joined);

function spans(
  line: CreatorLine,
  roman = false,
  voiceOf: (unit: CreatorUnit) => string | undefined = () => undefined,
): string {
  return line.units
    .filter(timed)
    .map((unit, index) => {
      const voice = voiceOf(unit);
      const pieces = roman
        ? romanPieces(unit)
        : [{ text: unit.text, start: unit.start!, end: unit.end! }];
      // A reading split into syllables stays one span timed like its word,
      // which is how readers match a reading to its word; the split rides
      // along in Lyssna attributes.
      const split =
        pieces.length > 1
          ? ` lyssna:pieces="${escape(pieces.map((piece) => piece.text).join("|"))}" lyssna:starts="${pieces
              .slice(1)
              .map((piece) => formatTime(piece.start))
              .join(" ")}"`
          : "";
      const whole = split
        ? [
            {
              text: pieces.map((piece) => piece.text).join(""),
              start: unit.start!,
              end: unit.end!,
            },
          ]
        : pieces;
      const span = whole
        .map(
          (piece) =>
            `<span begin="${formatTime(piece.start)}" end="${formatTime(Math.max(piece.start, piece.end))}"${voice ? ` lyssna:voice="${escape(voice)}"` : ""}${split}>${escape(piece.text)}</span>`,
        )
        .join("");
      const spaced = roman ? readingSpaced(unit, index) : index > 0 && !unit.joined;
      return spaced ? ` ${span}` : span;
    })
    .join("");
}

function extras(line: CreatorLine): string {
  return [
    line.translation &&
      `<span ttm:role="x-translation">${escape(line.translation)}</span>`,
    line.romanization &&
      !hasWordRoman(line) &&
      `<span ttm:role="x-roman">${escape(line.romanization)}</span>`,
  ]
    .filter(Boolean)
    .join("");
}

/**
 * Word-timed TTML in the Apple Music style AMLL and Spicy Lyrics read.
 * Background lines nest inside the lead line sung before them.
 */
/** Lyssna's own TTML attributes, such as who sings a section. */
export const LYSSNA_NS = "https://lyssna.org/ns/ttml";

export function toTtml(
  lines: CreatorLine[],
  meta: SongMeta,
  entries: MetaEntry[] = defaultMetadata(meta),
): string {
  type Paragraph = {
    lead?: CreatorLine;
    backgrounds: CreatorLine[];
    section?: SongSection;
  };
  const paragraphs: Paragraph[] = [];
  let section: SongSection | undefined;
  for (const line of lines) {
    section = sectionFrom(line) ?? section;
    if (!lineSpan(line, true)) continue;
    const last = paragraphs.at(-1);
    if (line.background && last && !section) last.backgrounds.push(line);
    else if (line.background) paragraphs.push({ backgrounds: [line], section });
    else paragraphs.push({ lead: line, backgrounds: [], section });
    section = undefined;
  }
  // Each artist the sections name gets a voice of their own, in order;
  // voices that are groups ("A & B") share v1000, Apple's group voice.
  const used = new Set<string>(["v1"]);
  let voices: string[] = [];
  const opposite = lines.some((line) => line.opposite);
  let end = 0;
  const readings: string[] = [];
  const sections: {
    section?: SongSection;
    begin: number;
    end: number;
    ps: string[];
  }[] = [];
  paragraphs.forEach((paragraph, index) => {
    const all = [paragraph.lead, ...paragraph.backgrounds].filter(
      (line): line is CreatorLine => !!line,
    );
    const spansOf = all.map((line) => lineSpan(line, true)!);
    const begin = Math.min(...spansOf.map((span) => span.start));
    const finish = Math.max(...spansOf.map((span) => span.end));
    end = Math.max(end, finish);
    if (paragraph.section)
      voices = paragraph.section.singer ? voicesOf(paragraph.section.singer) : [];
    const first = paragraph.lead ?? paragraph.backgrounds[0];
    // Who sings is Lyssna's own detail, so other readers see only the
    // lead and second-singer sides the draft marks.
    const agent = first.opposite ? "v2" : "v1";
    used.add(agent);
    const lineVoice =
      voices.length > 1
        ? first.sungBy && voices.includes(first.sungBy)
          ? first.sungBy
          : voices[0]
        : undefined;
    // A word or backing vocal another voice sings names its own voice.
    const own = (sungBy?: string) =>
      voices.length > 1 &&
      sungBy &&
      voices.includes(sungBy) &&
      sungBy !== lineVoice
        ? sungBy
        : undefined;
    if (paragraph.lead && hasWordRoman(paragraph.lead))
      readings.push(
        `<text for="L${index + 1}">${spans(paragraph.lead, true)}</text>`,
      );
    const lead = paragraph.lead
      ? spans(paragraph.lead, false, (unit) => own(unit.sungBy)) +
        extras(paragraph.lead)
      : "";
    const backgrounds = paragraph.backgrounds
      .map((line) => {
        const span = lineSpan(line, true)!;
        const voice = own(line.sungBy);
        return `<span ttm:role="x-bg" begin="${formatTime(span.start)}" end="${formatTime(span.end)}"${voice ? ` lyssna:voice="${escape(voice)}"` : ""}>${spans(line, false, (unit) => (unit.sungBy && unit.sungBy !== line.sungBy ? own(unit.sungBy) : undefined))}</span>`;
      })
      .join("");
    const p = `<p begin="${formatTime(begin)}" end="${formatTime(finish)}" ttm:agent="${agent}"${lineVoice ? ` lyssna:voice="${escape(lineVoice)}"` : ""} itunes:key="L${index + 1}">${lead}${backgrounds}</p>`;
    const last = sections.at(-1);
    if (!last || paragraph.section)
      sections.push({
        section: paragraph.section,
        begin,
        end: finish,
        ps: [p],
      });
    else {
      last.end = Math.max(last.end, finish);
      last.ps.push(p);
    }
  });
  // Apple's attribute is itunes:songPart. Spicy Lyrics drops every line of
  // a section marked Instrumental, so sung lines never carry that mark.
  const body = sections.length
    ? sections
        .map(
          ({ section, begin, end, ps }) =>
            `<div begin="${formatTime(begin)}" end="${formatTime(end)}"${section && section.part !== "Instrumental" ? ` itunes:songPart="${escape(section.part)}"` : ""}${section?.singer ? ` lyssna:singer="${escape(section.singer)}"` : ""}>${ps.join("")}</div>`,
        )
        .join("")
    : `<div begin="${formatTime(0)}" end="${formatTime(0)}"></div>`;
  const songwriters = filled(
    entries
      .filter((entry) => entry.key.trim() === "songwriters")
      .flatMap((entry) => entry.values),
  );
  const metadata = [
    ...[...used, ...(opposite ? ["v2"] : [])]
      .filter((agent, index, all) => all.indexOf(agent) === index)
      .sort()
      .map(
        (agent) =>
          `<ttm:agent type="${agent === "v1" ? "person" : "other"}" xml:id="${agent}"></ttm:agent>`,
      ),
    ...[
      ...entries.filter((entry) => !SONG_KEYS.includes(entry.key.trim())),
      { key: "album", values: meta.album ? [meta.album] : [] },
      { key: "spotifyId", values: meta.spotifyId ? [meta.spotifyId] : [] },
    ]
      .filter((entry) => entry.key.trim() && entry.key !== "songwriters")
      .flatMap((entry) =>
        filled(entry.values).map(
          (value) =>
            `<amll:meta key="${escape(entry.key.trim())}" value="${escape(value)}"/>`,
        ),
      ),
    songwriters.length || readings.length
      ? `<iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal">${
          songwriters.length
            ? `<songwriters>${songwriters.map((name) => `<songwriter>${escape(name)}</songwriter>`).join("")}</songwriters>`
            : ""
        }${
          readings.length
            ? `<transliterations><transliteration>${readings.join("")}</transliteration></transliterations>`
            : ""
        }</iTunesMetadata>`
      : "",
  ].join("");
  const duration = Math.max(end, meta.durationMs ?? 0);
  return `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:amll="http://www.example.com/ns/amll" xmlns:itunes="http://music.apple.com/lyric-ttml-internal"${lines.some((line) => line.part && line.singer) || readings.some((reading) => reading.includes("lyssna:pieces")) || body.includes("lyssna:voice") ? ` xmlns:lyssna="${LYSSNA_NS}"` : ""} itunes:timing="Word"><head><metadata>${metadata}</metadata></head><body dur="${formatTime(duration)}">${body}</body></tt>`;
}

export function fileName(meta: SongMeta): string {
  const base = [meta.name, meta.artists.join(", ")]
    .filter(Boolean)
    .join(" - ")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .trim()
    .slice(0, 120);
  return `${base || "lyrics"}.ttml`;
}

/** Every word, timed or not, so the romanizer sees the whole song. */
export function romanizeRequest(lines: CreatorLine[]): Lyrics {
  return {
    lines: lines.map((line) => {
      const words = line.units.map((unit, index) => ({
        start_ms: 0,
        end_ms: 0,
        text: index > 0 && !unit.joined ? ` ${unit.text}` : unit.text,
      }));
      return {
        start_ms: 0,
        end_ms: 0,
        text: words.map((word) => word.text).join(""),
        translation: "",
        romanization: "",
        words,
        background: line.background,
        opposite: line.opposite,
      };
    }),
    source: "TTML Creator",
    instrumental: false,
    synced: true,
  };
}

/** The letters of a text, with where each sits in it. */
function lettersOf(text: string) {
  const chars = Array.from(text);
  const letters: string[] = [];
  const at: number[] = [];
  chars.forEach((char, index) => {
    if (/[\p{L}\p{N}]/u.test(char)) {
      letters.push(char.toLowerCase());
      at.push(index);
    }
  });
  return { chars, letters, at };
}

/**
 * Lines `ours` up inside `theirs`, which may run longer at either end.
 * For each position in `ours`, the position in `theirs` it falls at.
 */
function fitLetters(ours: string[], theirs: string[]) {
  const width = theirs.length + 1;
  const cost = new Uint16Array((ours.length + 1) * width);
  for (let i = 1; i <= ours.length; i++) {
    cost[i * width] = i;
    for (let j = 1; j <= theirs.length; j++)
      cost[i * width + j] = Math.min(
        cost[(i - 1) * width + j - 1] + (ours[i - 1] === theirs[j - 1] ? 0 : 1),
        cost[(i - 1) * width + j] + 1,
        cost[i * width + j - 1] + 1,
      );
  }
  const last = ours.length * width;
  let end = 0;
  for (let j = 1; j <= theirs.length; j++)
    if (cost[last + j] < cost[last + end]) end = j;
  const at = new Array<number>(ours.length + 1);
  let i = ours.length;
  let j = end;
  at[i] = j;
  while (i > 0) {
    const here = cost[i * width + j];
    if (
      j > 0 &&
      here ===
        cost[(i - 1) * width + j - 1] + (ours[i - 1] === theirs[j - 1] ? 0 : 1)
    )
      j--;
    else if (here !== cost[(i - 1) * width + j] + 1) {
      j--;
      continue;
    }
    i--;
    at[i] = j;
  }
  return { cost: cost[last + end], at };
}

/**
 * Swaps Lyssna's readings for the ones in a romanized copy of the lyrics
 * (Genius Romanizations), where a line of it matches. Each syllable takes
 * the stretch of that line its own reading lines up with; words that were
 * already in Latin letters stay as they are.
 */
export function readingsFrom(
  request: Lyrics,
  romanized: Lyrics,
  text: string,
): { lyrics: Lyrics; matched: number } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !isSectionLine(line));
  const candidates = [
    ...lines,
    ...lines.slice(1).map((line, index) => `${lines[index]} ${line}`),
  ].map(lettersOf);
  let matched = 0;
  const out = romanized.lines.map((line, lineIndex) => {
    const asked = request.lines[lineIndex]?.words;
    const read = (index: number) =>
      line.words[index].text.trim() !== asked?.[index]?.text.trim();
    if (asked?.length !== line.words.length || !line.words.some((_, index) => read(index)))
      return line;
    const ours: string[] = [];
    const starts = line.words.map((word) => {
      const start = ours.length;
      ours.push(...lettersOf(word.text).letters);
      return start;
    });
    if (ours.length < 2) return line;
    let best: { theirs: ReturnType<typeof lettersOf>; at: number[] } | undefined;
    let bestCost = Math.floor(ours.length * 0.3) + 1;
    for (const theirs of candidates) {
      if (theirs.letters.length < ours.length / 2) continue;
      const fit = fitLetters(ours, theirs.letters);
      if (fit.cost < bestCost) {
        bestCost = fit.cost;
        best = { theirs, at: fit.at };
      }
    }
    if (!best) return line;
    const { theirs, at } = best;
    matched++;
    const words = line.words.map((word, index) => {
      if (!read(index)) return word;
      const from = at[starts[index]];
      const to = index + 1 < starts.length ? at[starts[index + 1]] : at[ours.length];
      if (from >= to) return word;
      // The line's edges take in the whole word they land in: Lyssna
      // reads 零 as "rei" where Genius writes "Zero".
      const edge = (at: number) => at >= 0 && !/[\s()]/.test(theirs.chars[at]);
      let begin = theirs.at[from];
      if (starts[index] === 0) while (edge(begin - 1)) begin--;
      let stop: number;
      if (index + 1 === starts.length || starts[index + 1] === ours.length) {
        stop = theirs.at[to - 1] + 1;
        while (stop < theirs.chars.length && edge(stop)) stop++;
      } else stop = theirs.at[to];
      const reading = theirs.chars
        .slice(begin, stop)
        .join("")
        .replace(/[()]/g, "")
        .trim();
      if (!reading) return word;
      return { ...word, text: /^\s/.test(word.text) ? ` ${reading}` : reading };
    });
    return { ...line, words, text: words.map((word) => word.text).join("") };
  });
  return { lyrics: { ...romanized, lines: out }, matched };
}

/** Fills empty readings and ones it filled before; hand-typed ones survive. */
export function applyRomanized(
  lines: CreatorLine[],
  request: Lyrics,
  romanized: Lyrics,
): CreatorLine[] {
  let changed = false;
  const next = lines.map((line, lineIndex) => {
    const words = romanized.lines[lineIndex]?.words;
    const asked = request.lines[lineIndex]?.words;
    if (
      words?.length !== line.units.length ||
      asked?.length !== line.units.length
    )
      return line;
    const units = line.units.map((unit, index) => {
      const reading = words[index].text.trim();
      const spaced = index > 0 && /^\s/.test(words[index].text);
      // A typed reading stays, but learns where its word starts.
      if (
        unit.roman &&
        !unit.romanAuto &&
        unit.romanSpaced === undefined &&
        asked[index].text.trim() === unit.text
      ) {
        changed = true;
        return { ...unit, romanSpaced: spaced };
      }
      if (
        (unit.roman && !unit.romanAuto) ||
        !reading ||
        reading === unit.text ||
        (reading === unit.roman && unit.romanSpaced === spaced) ||
        asked[index].text.trim() !== unit.text
      )
        return unit;
      changed = true;
      return {
        ...unit,
        roman: reading,
        romanAuto: true,
        romanSpaced: spaced,
        ...(reading !== unit.roman && { romanStarts: undefined }),
      };
    });
    return units.some((unit, index) => unit !== line.units[index])
      ? { ...line, units }
      : line;
  });
  return changed ? next : lines;
}

/** The section a line sits in: the nearest section start at or above it. */
export function sectionStart(lines: CreatorLine[], index: number) {
  for (let at = index; at >= 0; at--) if (lines[at]?.part) return at;
  return -1;
}

/**
 * Names the section starting at a line, or starts one there that keeps the
 * singers of the section it splits off from. No name removes the section,
 * so its lines join the one above.
 */
export function setSection(
  lines: CreatorLine[],
  index: number,
  part?: string,
): CreatorLine[] {
  const line = lines[index];
  if (!line) return lines;
  const name = part?.trim();
  if (!name) {
    if (!line.part) return lines;
    const { part: _part, singer: _singer, ...rest } = line;
    return lines.map((each, at) => (at === index ? rest : each));
  }
  const from = sectionStart(lines, index);
  const singer = line.part ? line.singer : lines[from]?.singer;
  return lines.map((each, at) =>
    at === index
      ? { ...each, part: name, ...(singer ? { singer } : {}) }
      : each,
  );
}

/** Sets who sings the section starting at a line; blank clears it. */
export function setSectionSinger(
  lines: CreatorLine[],
  index: number,
  singer: string,
): CreatorLine[] {
  const line = lines[index];
  if (!line?.part) return lines;
  const name = singer.trim();
  if ((line.singer ?? "") === name) return lines;
  const { singer: _singer, ...rest } = line;
  return lines.map((each, at) =>
    at === index ? (name ? { ...rest, singer: name } : rest) : each,
  );
}

/** The voices the section around a line names; empty when it names fewer than two. */
export function sectionVoices(lines: CreatorLine[], index: number): string[] {
  for (let at = index; at >= 0; at--) {
    const line = lines[at];
    if (line?.part) {
      const voices = line.singer ? voicesOf(line.singer) : [];
      return voices.length > 1 ? voices : [];
    }
  }
  return [];
}

/** Which voice sings a line, by its place in the section's list (0 is the first). */
export function lineVoice(lines: CreatorLine[], index: number) {
  const voices = sectionVoices(lines, index);
  const at = voices.indexOf(lines[index]?.sungBy ?? "");
  return voices.length ? Math.max(0, at) : -1;
}

/** Which voice sings a word, or -1 when it follows its line. */
export function unitVoice(lines: CreatorLine[], at: Cursor) {
  const voices = sectionVoices(lines, at.line);
  const sungBy = lines[at.line]?.units[at.unit]?.sungBy;
  return sungBy ? voices.indexOf(sungBy) : -1;
}

/** Sets who sings each of these lines; the first voice clears it. */
export function setLineVoice(
  lines: CreatorLine[],
  indexes: Iterable<number>,
  voice: string,
): CreatorLine[] {
  const chosen = new Set(indexes);
  return lines.map((line, index) => {
    if (!chosen.has(index)) return line;
    const voices = sectionVoices(lines, index);
    const { sungBy: _, ...rest } = line;
    return voice === voices[0] ? rest : { ...rest, sungBy: voice };
  });
}

/** Sets who sings these words; their line's own voice clears it. */
export function setUnitVoice(
  lines: CreatorLine[],
  cursors: Cursor[],
  voice: string,
): CreatorLine[] {
  return lines.map((line, index) => {
    const here = cursors.filter((at) => at.line === index);
    if (!here.length) return line;
    const lineVoice = line.sungBy ?? sectionVoices(lines, index)[0];
    return {
      ...line,
      units: line.units.map((unit, at) => {
        if (!here.some((cursor) => cursor.unit === at)) return unit;
        const { sungBy: _, ...rest } = unit;
        return voice === lineVoice ? rest : { ...rest, sungBy: voice };
      }),
    };
  });
}
