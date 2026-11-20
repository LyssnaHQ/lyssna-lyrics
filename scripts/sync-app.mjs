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
  .replace("export interface Word {", "export interface Word {\n  romanization?: string;")
  .replace("export interface Lyrics {", "export interface Lyrics {\n  lyssna?: { songId: string; contributors: { user_id?: string; username?: string }[] };");
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
  slice(styles, "/* Lyrics loading skeleton:", "/* Lyrics popout window")
    .replace(/\n\.lyrics-skeleton p \{[\s\S]*?(?=\n\.reduce-motion \.lyrics-skeleton-lines)/, "")
    .replace(/\n\.reduce-motion \.lyrics-skeleton-dots i \{[^}]*\}/, "")
    .replace(/\n@keyframes lyrics-skeleton-dot \{[\s\S]*?\n\}/, ""),
  slice(styles, "/* Lyrics popout window", "\n.album-grid.all {"),
  slice(styles, "/* Liquid Glass seek bar:", "\n.lyrics-fullscreen-times {"),
  slice(styles, "\n.lyrics-display.simple-lyrics .lyric-line {", "\n.ttml-draft-banner {"),
].map((css) => css
  .replaceAll(':root:not([data-animator="Legacy"])', ':is(.lyrics-display, .gravity-lyrics):not([data-animator="Legacy"])')
  .replaceAll("min(var(--lyric-size, 58px), 4.6cqw)", "var(--lyric-size, 58px)")
  .replace("clamp(23px, 3.6cqw, var(--lyric-size))", "var(--lyric-size)")
  .replace(/\/\* Stacked \(narrow\) layouts give lyrics[^\n]*\n\.lyrics-page\.narrow \.lyric-line,\n\.lyrics-page\.narrow \.lyric-wait \{[^}]*\}\n/, "")
  .replace("  font-size: clamp(22px, 4.2cqw, var(--lyric-size));",
    "  --lead-lyric-size: calc(var(--lyric-size) * 0.625);\n  font-size: var(--lead-lyric-size);")
  .replace("calc(clamp(22px, 4.2cqw, var(--lyric-size)) * 0.58)", "calc(var(--lead-lyric-size) * 0.58)")
  .replace(/(\.gravity-word \.lyric-paint \{\n)  --glyph-bleed: 0em;\n  --sweep-edge: [^\n]+\n  padding: 0;\n  margin: 0;/, `$1  /* The mask needs room for italic overhang without widening the word. */
  --glyph-bleed: 0.45em;
  --sweep-width: calc(100% - 2 * var(--glyph-bleed));
  --sweep-edge: calc(var(--glyph-bleed) + var(--sweep-width) * var(--sweep) + var(--sweep-overrun));
  --sweep-soft-edge: calc(var(--sweep-edge) + var(--sweep-width) * var(--sweep-soft, 0.2));`)
  .replaceAll("calc(var(--sweep-edge) + 20%)", "var(--sweep-soft-edge)"));
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
  slice(components, "function WriterCredits(", "/** The badge's E").replace("function WriterCredits(", "export function WriterCredits("),
  slice(components, "function creditsInView(", "/** Up next pops in"),
  slice(components, "/** Seek Fade-in Compensation", "const LyricCredits =")
    .replace('compact ? "off" : (settings.lyrics_pinned_footer ?? "off")', 'settings.lyrics_pinned_footer ?? "off"')
    .replace("      data-following={following}", "      data-following={following}\n      data-animator={presetOf(settings.lyrics_animator)}")
    .replace("      !!settings.lyrics_simple,\n", "      !!settings.lyrics_simple,\n      scroll.current?.ownerDocument.defaultView ?? window,\n")
    .replace("}, [positionMs, lyrics, settings.reduce_motion]);", "}, [positionMs, lyrics, settings.reduce_motion, settings.lyrics_simple, tuning]);")
    .replace("    let frame = 0,\n      last = performance.now();", "    const view = container.ownerDocument.defaultView ?? window;\n    let frame = 0,\n      last = performance.now();")
    .replace("    const tick = (time: number) => {", "    const tick = () => {\n      const time = performance.now();")
    .replaceAll("requestAnimationFrame(tick)", "view.requestAnimationFrame(tick)")
    .replaceAll("cancelAnimationFrame(frame)", "view.cancelAnimationFrame(frame)")
    .replace(/      container\.style\.setProperty\(\n        "--lead-top",\n        (\`[^\n]+\`),\n      \);/, `      const leadTop = $1;
      if (container.style.getPropertyValue("--lead-top") !== leadTop)
        container.style.setProperty("--lead-top", leadTop);`),
  slice(components, "/** Static lyric markup.", "function TimedLyricsPreview("),
  slice(components, "const SKELETON_WIDTHS =", "/** Volume beside or below")
    .replace("function LyricsSkeleton()", "export function LyricsSkeleton()")
    .replace('className="lyrics-skeleton" role="status"', 'className="lyrics-skeleton" role="status" aria-label="Loading lyrics"')
    .replace(/\n      <p>\n        Loading lyrics[\s\S]*?\n      <\/p>/, ""),
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
  `        flag("animated_covers", "Animated covers", "Play Apple Music motion covers when available. Lyssna looks them up by album barcode.",
          "motion artwork animated album cover video apple music"),`,
  slice(rows, '        flag(\n          "npv_ambience"', '      ],\n    ],\n    [\n      "Layout"'),
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
    .replace("    private simple = false,\n", "    private simple = false,\n    private view: Window = window,\n    private motionStrength = 1,\n")
    .replace("const motion = target.springs.step(goal, seconds);\n    const calm = target.calm;", "const motion = target.springs.step(goal, seconds * this.motionStrength);\n    const calm = target.calm * this.motionStrength;")
    .replaceAll("cancelAnimationFrame(this.frame)", "this.view.cancelAnimationFrame(this.frame)")
    .replaceAll("requestAnimationFrame(this.run)", "this.view.requestAnimationFrame(this.run)");
  if (file === "space-gravity-lyrics.tsx") source = source
    .replace('import { LyricAnimator } from "./lyric-animator";', 'import { LyricAnimator } from "./lyric-animator";\nimport { presetOf } from "./animator-tuning";')
    .replace('import { frameDue } from "./frame-cap";', 'import { frameDue } from "./frame-cap";\nimport { trackGravityStage } from "../gravity-frame";')
    .replace(slice(source, "  // Words that just left stay a moment to fade out.", "  const elements = useRef"), `  // Each departing batch keeps its own fade, even when more words leave.
  const [leaving, setLeaving] = useState(() => new Map<Entity, number>());
  const fadeTimers = useRef(new Set<number>());
  const previous = useRef<{ prepared: typeof prepared; visible: Entity[] }>(undefined);
  useEffect(() => {
    const timers = fadeTimers.current;
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      timers.clear();
    };
  }, [prepared]);
  useEffect(() => {
    const before = previous.current;
    previous.current = { prepared, visible };
    if (before?.prepared !== prepared) {
      setLeaving((current) => current.size ? new Map() : current);
      return;
    }
    const now = new Set(visible);
    const gone = before.visible.filter((entity) => !now.has(entity));
    if (!gone.length) return;
    const timer = window.setTimeout(() => {
      fadeTimers.current.delete(timer);
      setLeaving((current) => {
        // A word that leaves again after a seek belongs to its newer batch.
        const expired = gone.filter((entity) => current.get(entity) === timer);
        if (!expired.length) return current;
        const remaining = new Map(current);
        for (const entity of expired) remaining.delete(entity);
        return remaining;
      });
    }, GRAVITY.presenceFadeMs + 40);
    fadeTimers.current.add(timer);
    setLeaving((current) => {
      const fading = new Map(current);
      for (const entity of gone) fading.set(entity, timer);
      return fading;
    });
    // visibleKeys captures every change to the visible set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared, visibleKeys]);
  const anchorLine = gravityAnchor(prepared, time).line;
  const shown = previous.current?.prepared === prepared
    ? [...visible, ...Array.from(leaving.keys()).filter((entity) => !visible.includes(entity))]
    : visible;`)
    .replace("  const elements = useRef(new Map<string, HTMLElement>());", `  const elements = useRef(new Map<string, HTMLElement>());
  const stageView = useRef<ReturnType<typeof trackGravityStage>>(undefined);`)
    .replace(/        if \(element\) elements\.current\.set\(key, element\);\n        else elements\.current\.delete\(key\);/, `        const previous = elements.current.get(key);
        if (previous === element) return;
        if (previous) stageView.current?.remove(previous);
        if (element) {
          elements.current.set(key, element);
          stageView.current?.add(element);
        } else elements.current.delete(key);`)
    .replace("    if (!element) return;\n    let frame = 0,", `    if (!element) return;
    const frameWindow = element.ownerDocument.defaultView ?? window;
    const view = stageView.current = trackGravityStage(element);
    for (const node of elements.current.values()) view.add(node);
    let frame = 0,`)
    .replace('      staticKey = "";', `      staticKey = "",
      indexed: typeof prepared | undefined,
      byKey = new Map<string, Entity>();`)
    .replace("      if (element.clientWidth < 1 || element.clientHeight < 1) return;\n", "")
    .replace("      if (!field || now - fieldAt > 250)", "      if (view.takeStageResize() || !field || now - fieldAt > 250)")
    .replace("      const { visible, prepared, reduceMotion, waitKey } = live.current;", `      if (field.bounds.width < 1 || field.bounds.height < 1) return;
      const { visible, prepared, reduceMotion, waitKey } = live.current;`)
    .replace("      const byKey = new Map(prepared.entities.map((item) => [item.key, item]));", `      if (indexed !== prepared) {
        indexed = prepared;
        byKey = new Map(prepared.entities.map((item) => [item.key, item]));
      }`)
    .replace("      if (waitKey) shownKeys.add(waitKey);\n      for (const [key, node] of elements.current) {", `      if (waitKey) shownKeys.add(waitKey);
      let wordResized = false;
      for (const [key, node] of elements.current) {
        const size = view.size(node);
        if (!size?.width || !size.height) continue;`)
    .replace("        if (node.offsetWidth)\n          measure(body, node.offsetWidth, node.offsetHeight);", `        if (body.width !== size.width || body.height !== size.height) {
          measure(body, size.width, size.height);
          wordResized = true;
        }`)
    .replace("        if (!elements.current.has(key)) continue;", `        const node = elements.current.get(key);
        if (!node || !view.size(node)?.width || !bodies.current.has(key)) continue;`)
    .replace("if (key !== staticKey || measured)", "if (key !== staticKey || measured || wordResized)")
    .replace(/node\.style\.transform = ([^\n]+);/, "view.move(node, $1);")
    .replace("    return () => cancelAnimationFrame(frame);", `    return () => {
      cancelAnimationFrame(frame);
      view.dispose();
      stageView.current = undefined;
    };`)
    .replaceAll("document.createElementNS(SVG,", "sheet.ownerDocument.createElementNS(SVG,")
    .replace("last = performance.now(),", "last = frameWindow.performance.now(),")
    .replaceAll("requestAnimationFrame(tick)", "frameWindow.requestAnimationFrame(tick)")
    .replace("cancelAnimationFrame(frame)", "frameWindow.cancelAnimationFrame(frame)")
    .replace("windowPosition() ?? { x: window.screenX, y: window.screenY }",
      "(frameWindow === window ? windowPosition() : undefined) ?? { x: frameWindow.screenX, y: frameWindow.screenY }")
    .replace("}, [time, lyrics]);", "}, [time, lyrics, reduceMotion, tuningKey]);")
    .replace("  // The normal lyrics animator drives the syllables, exactly as in the\n  // regular lyrics view.", "  // Let the sung syllables stand out against the words' floating motion.")
    .replace("      reduceMotion,\n    );\n    animator.current = instance;", "      reduceMotion,\n      false,\n      stage.current?.ownerDocument.defaultView ?? window,\n      1.45,\n    );\n    animator.current = instance;")
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
  .replace('the window shows, the lyrics page\'s first. */\n  followCanvas?: boolean | "window";', `the window shows, the lyrics page's first. A function selects a native
   * Canvas outside this ambience layer. */
  followCanvas?: boolean | "window" | (() => HTMLVideoElement | undefined);`)
  .replace("  windowActivity,", "  windowActivity as openerActivity,")
  .replace("    let engine: Kawarp;", `    const page = canvas.ownerDocument;
    const view = page.defaultView ?? window;
    const windowActivity = view === window ? openerActivity : () => ({ minimized: page.hidden, focused: page.hasFocus() });
    let engine: Kawarp;`)
  .replace("const reduced = matchMedia(", "const reduced = view.matchMedia(")
  .replaceAll("!document.hidden", "!page.hidden")
  .replace("    const panel = surface.current?.parentElement?.parentElement;", `    const panel = surface.current?.parentElement?.parentElement;
    const root = panel?.getRootNode() as Document | ShadowRoot | undefined;`)
  .replace("? (document.querySelector<HTMLVideoElement>(", "? (root?.querySelector<HTMLVideoElement>(")
  .replace("            document.querySelector<HTMLVideoElement>(", "            panel?.ownerDocument.querySelector<HTMLVideoElement>(")
  .replace('      const video =\n        followCanvas === "window"', '      const video = typeof followCanvas === "function"\n        ? followCanvas()\n        : followCanvas === "window"')
  .replace("      if (video === following.current) return;\n      try {", "      if (video === following.current) return;\n      following.current = video;\n      try {")
  .replace("        failed = video;\n        return;\n      }\n      following.current = video;", "        failed = video;\n        stopFollowing();\n        return;\n      }\n      if (following.current !== video) return;")
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
