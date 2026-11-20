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
  "window-activity.ts", "word-filter.ts", "gibberish.ts", "gibberish-dictionary.ts",
  "setting-row.tsx", "animator-settings.tsx", "toolbar-icons.tsx", "fullscreen-icons.tsx", "player-icons.tsx", "artwork-color.ts", "transfer-format.ts",
];
const styles = read("frontend/styles.css");
const components = read("frontend/components.tsx");
const state = read("frontend/state.ts");
const types = slice(read("frontend/types.ts"), "export interface Word {", "export interface PlayingDetails {")
  .replace("export interface Word {", "export interface Word {\n  romanization?: string;");
const lyrics = [
  slice(styles, "\n.lyric-end-credits {", "\n.credit-avatar {"),
  slice(styles, "\n.ambience {", "\n.lyrics-page {"),
  slice(styles, "\n.lyrics-page {", "/* Followed artists"),
  slice(styles, "\n.lyric-credits-row {", "/* Only carries the song menu"),
  slice(styles, "\n.lyrics-details {", "\n.compact .lyric-end-credits p {"),
  slice(styles, "\n.static-lyrics .lyric-line {", "\n.player-bar {"),
  slice(styles, "\n.lyrics-toolbar {", "/* Layout changes morph between positions"),
  slice(styles, "/* Space Gravity: words float", "/* Dims the app while a creator"),
  slice(styles, "\n.lyrics-page.no-artwork:not(.narrow) {", "/* Community lyrics credit"),
  slice(styles, "/* Lyrics loading skeleton:", "/* Lyrics popout window"),
  slice(styles, "/* Lyrics popout window", "\n.album-grid.all {"),
  slice(styles, "\n.lyrics-display.simple-lyrics .lyric-line {", "\n.ttml-draft-banner {"),
].map((css) => css.replaceAll(':root:not([data-animator="Legacy"])', ':is(.lyrics-display, .gravity-lyrics):not([data-animator="Legacy"])'));
const snapshot = files.map((file) => [file, read(`frontend/${file}`)]);
const settingsCss = read("frontend/settings.css")
  .replaceAll(".application:not(.liquid-glass) .lyrics-settings", ".lyrics-settings-backdrop:not(.liquid-glass) .lyrics-settings")
  + "\n" + slice(read("frontend/pages.css"), "/* Lyrics settings → Sources", "/* Help → About Lyssna");
const fullscreenCss = read("frontend/fullscreen-lyrics.css");
const renderer = [
  `import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Music2 } from "lucide-react";
import { LyricAnimator } from "./lyric-animator";
import { presetOf } from "./animator-tuning";
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
  slice(components, "/** Seek Fade-in Compensation", "const LyricCredits =")
    .replace("      data-following={following}", "      data-following={following}\n      data-animator={presetOf(settings.lyrics_animator)}")
    .replace("      !!settings.lyrics_simple,\n", "      !!settings.lyrics_simple,\n      scroll.current?.ownerDocument.defaultView ?? window,\n")
    .replace("    let frame = 0,\n      last = performance.now();", "    const view = container.ownerDocument.defaultView ?? window;\n    let frame = 0,\n      last = performance.now();")
    .replace("    const tick = (time: number) => {", "    const tick = () => {\n      const time = performance.now();")
    .replaceAll("requestAnimationFrame(tick)", "view.requestAnimationFrame(tick)")
    .replaceAll("cancelAnimationFrame(frame)", "view.cancelAnimationFrame(frame)")
    .replace(/      container\.style\.setProperty\(\n        "--lead-top",\n        (\`[^\n]+\`),\n      \);/, `      const leadTop = $1;
      if (container.style.getPropertyValue("--lead-top") !== leadTop)
        container.style.setProperty("--lead-top", leadTop);`),
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
  "return { flag, range, Look: [",
  slice(rows, '        <SettingRow\n          key="size"', "        <FontSettings"),
  slice(rows, '        <SettingRow\n          key="background"', '      ],\n    ],\n    [\n      "Lyrics",\n      "Display"'),
  "], Display: [",
  slice(rows, '        flag(\n          "lyrics_seek_compensation"', '        flag(\n          "romaji_as_written"'),
  slice(rows, '        flag(\n          "lyrics_translations"', '        flag(\n          "lyrics_visualiser"'),
  slice(rows, '        flag(\n          "lyrics_visualiser"', '        flag(\n          "lyrics_keep_overlaps"')
    .replace(" && !soloistPlays", "").replace("          soloistPlays,\n", ""),
  slice(rows, '        flag(\n          "lyrics_keep_overlaps"', '        flag(\n          "canvas_lyrics"')
    .replace('      ],\n    ],\n    [\n      "Effects",\n      "Lyric effects",\n      [', '], Effects: ['),
  slice(rows, '        flag(\n          "canvas_lyrics"', '        flag(\n          "animated_covers"')
    .replace("Play the track's Canvas video behind the lyrics page.", "Play the track's Canvas when Spotify makes it available."),
  `<SettingRow key="animated-covers" label="Animated covers"
          help="Play Apple Music's animated album covers where an album has one."
          keywords="motion artwork animated album cover video apple music"
          unavailable="Apple Music artwork lookup needs a server-side integration.">
          <Toggle label="Animated covers" checked={false} onChange={() => {}} />
        </SettingRow>,`,
  slice(rows, '        flag(\n          "npv_ambience"', '      ],\n    ],\n    [\n      "Layout"')
    .replace("Draw the moving artwork, or the Canvas, behind the Now playing panel.", "Draw the moving artwork behind the Now playing lyrics card."),
  "], Layout: [",
  slice(rows, '        flag(\n          "lyrics_compact"', '      ],\n    ],\n    [\n      "Sources"'),
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
  if (file === "lyric-animator.ts") source = source
    .replace("    private simple = false,\n", "    private simple = false,\n    private view: Window = window,\n")
    .replaceAll("cancelAnimationFrame(this.frame)", "this.view.cancelAnimationFrame(this.frame)")
    .replaceAll("requestAnimationFrame(this.run)", "this.view.requestAnimationFrame(this.run)");
  if (file === "space-gravity-lyrics.tsx") source = source
    .replace('import { LyricAnimator } from "./lyric-animator";', 'import { LyricAnimator } from "./lyric-animator";\nimport { presetOf } from "./animator-tuning";')
    .replace('      className={`gravity-lyrics ', '      data-animator={presetOf(tuning)}\n      className={`gravity-lyrics space-gravity ');
  if (file === "setting-row.tsx") source = source.replace("inert={!!unavailable}", "ref={(element) => { if (element) element.inert = !!unavailable; }}");
  write(file, source);
}
write("types.ts", `${types}\n`);
write("renderer.tsx", `${renderer.join("\n\n")}\n`);
write("visual-settings.tsx", `${settingsRows.join("\n")}\n`);
write("custom-fonts.tsx", read("frontend/custom-fonts.tsx")
  .replace('from "./types"', 'from "../settings"')
  .replace(/\/\*\* Fonts imported before[\s\S]*?(?=\/\*\* Custom font families)/, "")
  .replace('"lyssna-fonts"', '"lyssna-lyrics-fonts"')
  .replace(/    request\.onsuccess = \(\) => \{[\s\S]*?    \};/, "    request.onsuccess = () => resolve(request.result);")
  .replace(/\/\*\* Copies fonts from[\s\S]*?(?=async function storedFonts)/, "")
  .replace("const loaded = new Map<string, Promise<void>>();\nasync function registerFont(font: StoredFont) {",
    "const documents = new WeakMap<Document, Map<string, Promise<void>>>();\nasync function registerFont(font: StoredFont, page = document) {\n  const loaded = documents.get(page) ?? new Map<string, Promise<void>>();\n  documents.set(page, loaded);")
  .replace("document.fonts.add(face)", "page.fonts.add(face)")
  .replace("loadSelectedFonts(families: (string | undefined)[])", "loadSelectedFonts(families: (string | undefined)[], page = document)")
  .replace(".map(registerFont)", ".map((font) => registerFont(font, page))")
  .replace("fontFamily(family?: string)", "fontFamily(family?: string, fallback = true)")
  .replace('\", "Segoe UI", sans-serif`;', '\"${fallback ? \', "Segoe UI", sans-serif\' : ""}`;')
  .replace('"Inter Variable"', '"Lyssna Inter"')
  .replace('  settings: Pick<Settings, "ui_font" | "lyric_font">,', '  settings: Pick<Settings, "ui_font" | "lyric_font">,\n  page = document,')
  .replace("loadSelectedFonts([settings.ui_font, settings.lyric_font])", "loadSelectedFonts([settings.ui_font, settings.lyric_font], page)")
  .replace("}, [settings.ui_font, settings.lyric_font]);", "}, [settings.ui_font, settings.lyric_font, page]);")
  .replace("Used across menus, lists and the player.", "Used across Lyssna’s settings and song details."));
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
  .replace('image ?? track?.album.images?.[0]?.url ?? ""', 'image ?? ""')
  .replace("  windowActivity,", "  windowActivity as openerActivity,")
  .replace("    let engine: Kawarp;", `    const page = canvas.ownerDocument;
    const view = page.defaultView ?? window;
    const windowActivity = view === window ? openerActivity : () => ({ minimized: page.hidden, focused: page.hasFocus() });
    let engine: Kawarp;`)
  .replace("const reduced = matchMedia(", "const reduced = view.matchMedia(")
  .replaceAll("!document.hidden", "!page.hidden")
  .replace("frameRate: Math.max(1, ambienceFps(windowActivity()))", "frameRate: Math.max(1, ambienceFps(openerActivity()))")
  .replaceAll("frame = requestAnimationFrame(tick)", "frame = view.requestAnimationFrame(tick)")
  .replaceAll("cancelAnimationFrame(frame)", "view.cancelAnimationFrame(frame)")
  .replaceAll('document.addEventListener("visibilitychange", restart)', 'page.addEventListener("visibilitychange", restart)')
  .replaceAll('document.removeEventListener("visibilitychange", restart)', 'page.removeEventListener("visibilitychange", restart)')
  .replace("    const stopActivity = onWindowActivity(resize);", `    const stopActivity = view === window ? onWindowActivity(resize) : undefined;
    if (view !== window) {
      view.addEventListener("focus", resize);
      view.addEventListener("blur", resize);
    }`)
  .replace("      stopActivity();", `      stopActivity?.();
      view.removeEventListener("focus", resize);
      view.removeEventListener("blur", resize);`));
write("lyrics.css", `@scope (.lyssna-lyrics-view) {${lyrics.join("\n")}\n${fullscreenCss}\n}\n`);
write("settings.css", `@scope (.lyssna-lyrics-view) {\n${settingsCss}\n}\n`);
write("UPSTREAM", `${commit}\n`);
console.log(`Synced Lyssna lyrics from ${commit}`);
