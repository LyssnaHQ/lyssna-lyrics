import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const app = resolve(process.argv[2] ?? "../lyssna-app");
const git = (...args) => execFileSync("git", ["-C", app, ...args], {
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024,
});
const commit = git("rev-parse", `${process.argv[3] ?? "HEAD"}^{commit}`).trim();
const read = (file) => git("show", `${commit}:${file}`);
const write = (file, content) => writeFileSync(`src/lyssna/${file}`, content);

function slice(source, first, after) {
  const start = source.indexOf(first);
  const end = source.indexOf(after, start + first.length);
  if (start < 0 || end < 0) throw new Error(`Could not find upstream section ${first}`);
  return source.slice(start, end).trimEnd();
}

const files = [
  "animator-tuning.ts", "frame-cap.ts", "lyric-animator.ts", "lyric-motion.ts", "lyric-word.tsx",
  "lyric-countdown.tsx", "space-gravity.ts", "space-gravity-lyrics.tsx", "highlighter.tsx",
  "window-activity.ts", "word-sync.ts", "word-filter.ts", "gibberish.ts", "gibberish-dictionary.ts",
  "setting-row.tsx", "animator-settings.tsx", "toolbar-icons.tsx", "fullscreen-icons.tsx", "artwork-color.ts",
];
const styles = read("frontend/styles.css");
const components = read("frontend/components.tsx");
const state = read("frontend/state.ts");
const types = slice(read("frontend/types.ts"), "export interface Word {", "export interface PlayingDetails {")
  .replace("export interface Word {", "export interface Word {\n  romanization?: string;");
const lyrics = [
  slice(styles, "\n.ambience {", "\n.lyrics-page {"),
  slice(styles, "\n.lyrics-page {", "/* Followed artists"),
  slice(styles, "\n.lyric-credits-row {", "/* Only carries the song menu"),
  slice(styles, "\n.lyrics-details {", "\n.compact .lyric-end-credits p {"),
  slice(styles, "\n.static-lyrics .lyric-line {", "\n.player-bar {"),
  slice(styles, "/* Space Gravity: words float", "/* Dims the app while a creator"),
  slice(styles, "\n.lyrics-page.no-artwork:not(.narrow) {", "/* Community lyrics credit"),
  slice(styles, "/* Lyrics loading skeleton:", "/* Lyrics popout window"),
  slice(styles, "\n.lyrics-display.simple-lyrics .lyric-line {", "\n.ttml-draft-banner {"),
];
const snapshot = files.map((file) => [file, read(`frontend/${file}`)]);
const settingsCss = read("frontend/settings.css");
const fullscreenCss = read("frontend/fullscreen-lyrics.css");
const renderer = [
  `import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Music2 } from "lucide-react";
import { LyricAnimator } from "./lyric-animator";
import { frameDue } from "./frame-cap";
import { HighlighterWords, markerColour } from "./highlighter";
import { LyricCountdown } from "./lyric-countdown";
import { LyricWord } from "./lyric-word";
import { glideScroll, GLIDE_MS, lineBlur, stepScroll, tuneMotion, vocalEnd, vocalGap, vocalGaps, wordGroups, type ScrollSpring, type VocalGap } from "./lyric-motion";
import type { Line, Lyrics, Word } from "./types";
import type { Settings } from "../settings";
import { LyricCredits } from "../credits";`,
  slice(state, "export function activeLines(", "export function progress("),
  slice(components, "function WriterCredits(", "/** The badge's E"),
  slice(components, "function creditsInView(", "/** Up next pops in"),
  slice(components, "/** Seek Fade-in Compensation", "const LyricCredits ="),
  slice(components, "/** Static lyric markup.", "function TimedLyricsPreview("),
  slice(components, "const SKELETON_WIDTHS =", "/** Volume beside or below").replace("function LyricsSkeleton()", "export function LyricsSkeleton()"),
];
const rows = read("frontend/settings-window.tsx");
const settingsRows = [
  `import type { CSSProperties } from "react";
import { AnimatorPresetRow } from "./animator-settings";
import { DEFAULT_MARKER, MARKER_COLOURS } from "./highlighter";
import { SettingRow, Toggle } from "./setting-row";
import type { Settings } from "../settings";
type KeysOf<T> = { [K in keyof Settings]: Settings[K] extends T ? K : never }[keyof Settings];
type Flag = KeysOf<boolean>;
type Amount = KeysOf<number>;
export function visualRows(settings: Settings, onSettings: (patch: Partial<Settings>) => void, onManageAnimator: () => void) {`,
  slice(rows, "  const flag = (", "  const order ="),
  "return { Look: [",
  slice(rows, '        <SettingRow\n          key="size"', "        <FontSettings"),
  slice(rows, '        <SettingRow\n          key="background"', '        <SettingRow\n          key="year"').replace('<option value="artist">Artist header</option>', '<option value="artist" disabled>Artist header</option>'),
  "], Display: [",
  slice(rows, '        flag(\n          "lyrics_seek_compensation"', '        flag(\n          "romaji_as_written"'),
  slice(rows, '        flag(\n          "lyrics_translations"', '        flag(\n          "lyrics_visualiser"'),
  slice(rows, '        flag(\n          "lyrics_visualiser"', '        flag(\n          "lyrics_keep_overlaps"')
    .replace(" && !soloistPlays", "").replace("          soloistPlays,\n", ""),
  slice(rows, '        flag(\n          "lyrics_keep_overlaps"', '        flag(\n          "canvas_lyrics"')
    .replace('      ],\n    ],\n    [\n      "Effects",\n      "Lyric effects",\n      [', '], Effects: ['),
  "], Layout: [",
  slice(rows, '        flag(\n          "lyrics_compact"', '        flag(\n          "fullscreen_animate_close"'),
  slice(rows, '        flag(\n          "lyrics_hide_npv"', '      ],\n    ],\n    [\n      "Sources"'),
  "  ] };\n}",
  slice(rows, "function MarkerColourRow(", "function QualitySelect("),
];
mkdirSync("src/lyssna", { recursive: true });
for (const [file, content] of snapshot) {
  let source = content;
  if (file === "animator-settings.tsx") source = source
    .replace('import { rpc } from "./bridge";\n', "")
    .replace('rpc<string>("read_clipboard").catch(() => navigator.clipboard.readText())', "navigator.clipboard.readText()");
  if (file === "lyric-countdown.tsx") source = source
    .replace("import { memo,", "import { forwardRef, memo,")
    .replace(", type Ref", "")
    .replace("memo(function LyricCountdown({", "memo(forwardRef(function LyricCountdown({")
    .replace("  ref,\n", "")
    .replace("  ref?: Ref<HTMLDivElement>;\n}) {", "}, ref: React.ForwardedRef<HTMLDivElement>) {")
    .replace(/\}\);\s*$/, "}));\n");
  if (file === "setting-row.tsx") source = source.replace("inert={!!unavailable}", "ref={(element) => { if (element) element.inert = !!unavailable; }}");
  write(file, source);
}
write("types.ts", `${types}\n`);
write("renderer.tsx", `${renderer.join("\n\n")}\n`);
write("visual-settings.tsx", `${settingsRows.join("\n")}\n`);
write("lyrics-visualiser.tsx", read("frontend/lyrics-visualiser.tsx")
  .replace('import { rpc } from "./bridge";\n', "")
  .replace("  opacity,", "  opacity,\n  spectrum,")
  .replace("  opacity: number;", "  opacity: number;\n  spectrum: () => number[];")
  .replace('await rpc<number[]>("audio_spectrum")', "spectrum()")
  .replace("  }, []);", "  }, [spectrum]);"));
write("ambience.tsx", read("frontend/ambience.tsx")
  .replace('import type { Track } from "./types";\n', "")
  .replace("  track,\n", "")
  .replace("  track?: Track;\n", "")
  .replace('image ?? track?.album.images?.[0]?.url ?? ""', 'image ?? ""'));
write("lyrics.css", `@scope (.lyssna-lyrics-view) {${lyrics.join("\n")}\n${fullscreenCss}\n}\n`);
write("settings.css", `@scope (.lyssna-lyrics-view) {\n${settingsCss}\n}\n`);
write("UPSTREAM", `${commit}\n`);
console.log(`Synced Lyssna lyrics from ${commit}`);
