import {
  Fragment,
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from "react";
import type { Line } from "./types";

/* Highlighter: a lyrics player where a marker pen highlights each line as
 * it is sung, after a screen recording of a highlighter-style lyrics
 * view. Each row gets one band of ink behind the text, a slanted rounded
 * stroke, with a brighter rounded pen tip at its end. Like a felt tip, the
 * band drifts a little across the row, its edges waver and carry a darker
 * line, the ink has a fine grain, and it starts a touch heavier. The live
 * end of the stroke follows the word's spring. Ink darkens where the pen lingers: a slow
 * word deepens while it is drawn, and where the singing pauses mid-line
 * the resting tip soaks in a darker mark. The pen glides after the song instead of snapping, and
 * sung lines keep their ink. Timed syllables set the pace; a line without
 * them is shared out over its words by letter count. */

/** Marker colours to pick from. The ink is laid see-through over the
 *  background, so these are bright; on dark backgrounds they read as a
 *  deeper shade, like the olive of yellow ink on black. */
export const MARKER_COLOURS = [
  ["#d4b80f", "Yellow"],
  ["#e07a1f", "Orange"],
  ["#e0479a", "Pink"],
  ["#a066e8", "Purple"],
  ["#3f8ee8", "Blue"],
  ["#3fbf5f", "Green"],
] as const;
export const DEFAULT_MARKER: string = MARKER_COLOURS[0][0];

/** The CSS colour for a saved marker choice. */
export const markerColour = (choice: string = DEFAULT_MARKER) =>
  choice === "cover"
    ? `var(--lyrics-cover-color, ${DEFAULT_MARKER})`
    : /^#[0-9a-f]{6}$/i.test(choice)
      ? choice
      : DEFAULT_MARKER;

export interface Piece {
  text: string;
  start_ms: number;
  end_ms: number;
}

function finishBeforeNext(piece: Piece, next?: number) {
  if (next === undefined || next <= piece.start_ms || piece.end_ms - next > 85 || next - piece.end_ms > 45) return piece;
  const end = Math.min(piece.end_ms, next);
  return { ...piece, end_ms: end - Math.min(42, (end - piece.start_ms) * 0.2) };
}

export function nextMarkerStarts(lines: readonly Line[]) {
  let lead: number | undefined;
  let backing: number | undefined;
  return [...lines].reverse().map((line) => {
    const start = line.words[0]?.start_ms ?? line.start_ms;
    const next = line.background ? backing : lead;
    if (line.background) backing = start;
    else lead = start;
    return next;
  }).reverse();
}

/** The stretches of a line the marker covers one after another. */
export function highlighterPieces(line: Line, followingStart?: number): Piece[] {
  if (line.words.length) {
    // Store spaces after words so they mark where a word group can wrap.
    const pieces = line.words.map(({ text, start_ms, end_ms }) => ({
      text,
      start_ms,
      end_ms,
    }));
    pieces.forEach((piece, index) => {
      const space = piece.text.match(/^\s+/)?.[0];
      if (!space) return;
      if (index) pieces[index - 1].text += space;
      piece.text = piece.text.slice(space.length);
    });
    return pieces.map((piece, index) => finishBeforeNext(piece, pieces[index + 1]?.start_ms ?? followingStart));
  }
  const words = line.text.match(/\S+\s*/g) ?? [];
  const weights = words.map(
    (word) => word.replace(/[^\p{L}\p{N}]/gu, "").length || 1,
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const span = Math.max(0, line.end_ms - line.start_ms);
  let at = line.start_ms;
  return words.map((text, index) => {
    const start_ms = at;
    at += (span * weights[index]) / total;
    return finishBeforeNext({ text, start_ms, end_ms: at }, index < words.length - 1 ? at : followingStart);
  });
}

/** How much of a piece the marker covers at `time`, 0 to 1. */
export function inkAt(piece: Piece, time: number) {
  if (time <= piece.start_ms) return 0;
  if (time >= piece.end_ms) return 1;
  return (time - piece.start_ms) / Math.max(1, piece.end_ms - piece.start_ms);
}

/** Ink strength (its opacity) for a stretch drawn `widthEm` wide in
 *  `durationMs`: a slow pen leaves more ink, a quick one less. */
export function inkAlpha(widthEm: number, durationMs: number) {
  const speed = widthEm / Math.max(0.05, durationMs / 1000);
  return Math.min(0.8, Math.max(0.66, 0.8 - 0.016 * speed));
}

/** How much darker the ink turns over a stretch drawn `widthEm` wide in
 *  `durationMs`, 0 to 0.42: a pen that lingers soaks in and deepens the
 *  colour, a quick one leaves it light. */
export function inkDepth(widthEm: number, durationMs: number) {
  const speed = widthEm / Math.max(0.05, durationMs / 1000);
  return Math.min(0.42, Math.max(0, 0.42 - 0.05 * speed));
}

/** How strong a mark the pen leaves resting between two stretches when the
 *  singing pauses, 0 to 1: it grows the longer the pen rests. */
export function restMark(before: Piece, after: Piece, time: number) {
  const rest = Math.min(time, after.start_ms) - before.end_ms;
  return after.start_ms - before.end_ms < 150 || rest <= 0
    ? 0
    : Math.min(1, rest / 700);
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** One piece's place, in the line's own pixels, and its ink strength. */
interface Stretch extends Box {
  index: number;
  alpha: number;
  width: number;
}

/** A row's stroke: where it sits and where along the pen's path (all rows
 *  end to end) it begins. */
interface Lane extends Box {
  start: number;
  stretches: Stretch[];
}

interface Layout {
  lanes: Lane[];
  length: number;
  em: number;
  spans: HTMLElement[];
}

/** Measures the rows and pieces. Strokes are revealed over this fixed
 *  layout, so ink already laid never moves or stretches. */
function measure(root: HTMLElement, pieces: Piece[]): Layout {
  const spans = [...root.querySelectorAll<HTMLElement>(".highlighter-piece")];
  const em = parseFloat(getComputedStyle(root).fontSize) || 16;
  const stretches: Stretch[] = spans.map((span, index) => {
    const left = span.offsetLeft, right = left + span.offsetWidth;
    return {
      index,
      left,
      right,
      top: span.offsetTop,
      bottom: span.offsetTop + span.offsetHeight,
      alpha: inkAlpha(
        (right - left) / em,
        pieces[index].end_ms - pieces[index].start_ms,
      ),
      width: (right - left) / em,
    };
  });
  const lanes: Lane[] = [];
  for (const stretch of stretches) {
    if (stretch.right - stretch.left < 0.5) continue;
    const lane = lanes.find(
      (lane) =>
        Math.abs(lane.top - stretch.top) < (stretch.bottom - stretch.top) / 2,
    );
    if (lane) {
      lane.left = Math.min(lane.left, stretch.left);
      lane.right = Math.max(lane.right, stretch.right);
      lane.bottom = Math.max(lane.bottom, stretch.bottom);
      lane.stretches.push(stretch);
    } else lanes.push({ ...stretch, start: 0, stretches: [stretch] });
  }
  lanes.sort((a, b) => a.top - b.top);
  let length = 0;
  for (const lane of lanes) {
    lane.start = length;
    length += lane.right - lane.left;
  }
  return { lanes, length, em, spans };
}

/** How far along the pen's path the tip is at `time`. */
function pathAt(layout: Layout, pieces: Piece[], time: number) {
  if (time === -Infinity) return 0;
  let reached = 0;
  for (const lane of layout.lanes) {
    let previous: Stretch | undefined;
    for (const piece of lane.stretches) {
      const timing = pieces[piece.index];
      const start = lane.start + piece.left - lane.left;
      if (time < timing.start_ms) {
        if (!previous || start <= reached) return reached;
        const gap = start - reached;
        const depart = Math.max(pieces[previous.index].end_ms, timing.start_ms - Math.min(110, 20 + gap * 2));
        const progress = Math.max(0, (time - depart) / Math.max(1, timing.start_ms - depart));
        return reached + gap * progress * progress * (3 - 2 * progress);
      }
      if (time < timing.end_ms) {
        return start + (piece.right - piece.left) * inkAt(timing, time);
      }
      reached = lane.start + piece.right - lane.left;
      previous = piece;
    }
  }
  return layout.length;
}

/** The ink along one row, as a mask in that row's own pixels: each
 *  stretch's strength by its pen speed, stronger where the pen rested. */
function laneMask(
  lane: Lane,
  offset: number,
  pieces: Piece[],
  em: number,
  time: number,
) {
  const stops: [number, number][] = [];
  for (const stretch of lane.stretches) {
    stops.push([(stretch.left + stretch.right) / 2 - offset, stretch.alpha]);
    const next = pieces[stretch.index + 1];
    const rest = next ? restMark(pieces[stretch.index], next, time) : 0;
    if (rest) {
      const at = stretch.right - offset,
        peak = Math.min(0.92, stretch.alpha + 0.2 * rest);
      stops.push(
        [at - 0.3 * em, stretch.alpha],
        [at - 0.1 * em, peak],
        [at + 0.05 * em, peak],
      );
    }
  }
  // A little extra ink where the pen first touches down.
  const first = lane.stretches[0];
  if (first)
    stops.push([
      first.left - offset + 0.06 * em,
      Math.min(0.92, first.alpha + 0.08),
    ]);
  stops.sort((a, b) => a[0] - b[0]);
  if (stops.length === 1) stops.push([stops[0][0] + 1, stops[0][1]]);
  return `linear-gradient(90deg, ${stops
    .map(([x, alpha]) => `rgb(0 0 0 / ${alpha.toFixed(3)}) ${x.toFixed(1)}px`)
    .join(", ")})`;
}

/** How dark the ink has turned along one row, as a shading gradient in
 *  the row's own pixels. Slow stretches turn darker than quick ones, ink
 *  soaks in darker the longer it has been down, so a held word darkens as
 *  it is drawn, and a rest between words soaks in darker still. */
function laneShade(
  lane: Lane,
  offset: number,
  pieces: Piece[],
  em: number,
  time: number,
) {
  const stops: [number, number][] = [];
  for (const stretch of lane.stretches) {
    const piece = pieces[stretch.index];
    if (time <= piece.start_ms) continue;
    // Ink soaks in over the time since the pen reached the stretch.
    const soaked = 1 - Math.exp(-(time - piece.start_ms) / 700);
    const depth =
      inkDepth(stretch.width, piece.end_ms - piece.start_ms) * soaked;
    stops.push([(stretch.left + stretch.right) / 2 - offset, depth]);
    const next = pieces[stretch.index + 1];
    const rest = next ? restMark(piece, next, time) : 0;
    if (rest) {
      const at = stretch.right - offset;
      stops.push(
        [at - 0.3 * em, depth],
        [at - 0.08 * em, Math.min(0.55, depth + 0.25 * rest)],
        [at + 0.04 * em, Math.min(0.55, depth + 0.25 * rest)],
      );
    }
  }
  if (!stops.length) return "none";
  stops.sort((a, b) => a[0] - b[0]);
  if (stops.length === 1) stops.push([stops[0][0] + 1, stops[0][1]]);
  return `linear-gradient(90deg, ${stops
    .map(([x, depth]) => `rgb(0 0 0 / ${depth.toFixed(3)}) ${x.toFixed(1)}px`)
    .join(", ")})`;
}

/** The felt tip's edges never run quite straight: a gently wavering band
 *  shape, tiled along the row at a fixed size so it never stretches. */
const WAVER = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'><path d='M0 2C14 1 32 3 50 1.5S86 1 100 2L100 98C86 99 66 97 50 98.5S14 99 0 98Z'/></svg>",
)}")`;

/** Small steady variations per row, so strokes look drawn by hand. */
function wobble(seed: number) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value) - 0.5;
}

type InkPoint = { x: number; y: number };
export const highlighterTails = new WeakMap<HTMLElement, { start: InkPoint; end: InkPoint }>();

function stretchMotion(layout: Layout, stretch: Stretch) {
  const { style } = layout.spans[stretch.index];
  const scale = Number(style.scale) || 1;
  const lift = (parseFloat(style.translate.split(" ").at(-1) ?? "") || 0) * layout.em;
  if (Math.abs(lift) <= 0.2 && Math.abs(scale - 1) <= 0.004) return;
  const pivotX = (stretch.left + stretch.right) / 2;
  const pivotY = stretch.top * 0.25 + stretch.bottom * 0.75;
  return { scale, x: pivotX * (1 - scale), y: lift + pivotY * (1 - scale) };
}

function strokeFollow(motion: ReturnType<typeof stretchMotion>) {
  return motion ? `matrix(${motion.scale}, 0, 0, ${motion.scale}, ${motion.x}, ${motion.y}) ` : "";
}

function tailOffset(layout: Layout, stretch: Stretch, atEnd: boolean): InkPoint {
  const motion = stretchMotion(layout, stretch);
  if (!motion) return { x: 0, y: 0 };
  return {
    x: (atEnd ? stretch.right : stretch.left) * (motion.scale - 1) + motion.x,
    y: (stretch.top + stretch.bottom) / 2 * (motion.scale - 1) + motion.y,
  };
}

/** Shows the ink revealed up to `path` along the pen's path. Each row has
 *  a continuous band that splits where sung pieces move, so the opening
 *  mark and the whole painted tail stay under their words. */
function paint(
  ink: HTMLElement,
  layout: Layout,
  pieces: Piece[],
  path: number,
  time: number,
  seed: number,
  floating: HTMLElement | null,
) {
  const { em } = layout;
  const lead = 0.16 * em,
    tail = 0.1 * em,
    nib = 0.42 * em;
  const shown = layout.lanes.filter((lane) => path > lane.start + 0.5);
  if (floating && layout.lanes.length) {
    highlighterTails.set(floating, {
      start: tailOffset(layout, layout.lanes[0].stretches[0], false),
      end: tailOffset(layout, layout.lanes.at(-1)!.stretches.at(-1)!, true),
    });
  }
  while (ink.children.length > shown.length) ink.lastChild!.remove();
  shown.forEach((lane, index) => {
    const row =
      (ink.children[index] as HTMLElement | undefined) ??
      ink.appendChild(document.createElement("span"));
    const tip =
      (row.firstElementChild as HTMLElement | null) ??
      row.appendChild(document.createElement("span"));
    tip.className = "highlighter-tip";
    const width = lane.right - lane.left,
      height = lane.bottom - lane.top;
    const reveal = Math.max(0, Math.min(width, path - lane.start));
    const left = lane.left - lead,
      full = width + lead + tail,
      top = lane.top + height * 0.09,
      tall = height * 0.84;
    // The ink's edge sits exactly on the letter being sung. Its margins
    // grow in over the first and last half em, so a row starts from
    // nothing and ends without a hop.
    const ramp = 0.5 * em;
    const opening = lead * Math.min(1, reveal / ramp),
      closing = tail * Math.max(0, Math.min(1, (reveal - width + ramp) / ramp));
    const end = lead + reveal + closing;
    // A hand drifts a little across a row.
    const tilt = wobble(seed + index) * 0.6,
      drift = Math.tan((tilt * Math.PI) / 180);
    const stroke = `translate(${left}px, ${top}px) rotate(${tilt.toFixed(2)}deg) skewX(-8deg)`;
    const shade = laneShade(lane, left, pieces, em, time);
    const mask = `${laneMask(lane, left, pieces, em, time)}, ${WAVER}`;
    const size = `100% 100%, ${(2.8 * em).toFixed(1)}px 100%`;
    const place = `0 0, ${((wobble(seed - index) + 0.5) * 2.8 * em).toFixed(1)}px 0`;
    const start = lead - opening;
    let output = 1;
    function fill(from: number, to: number, transform: string) {
      if (to <= from) return;
      const part = (row.children[output++] as HTMLElement | undefined) ?? row.appendChild(document.createElement("span"));
      part.className = "highlighter-stroke";
      part.style.transform = transform;
      part.style.width = `${full}px`;
      part.style.height = `${tall}px`;
      const radius = `${(0.14 * em).toFixed(1)}px`;
      const leftRadius = from === start ? radius : "0";
      const rightRadius = to === end ? radius : "0";
      part.style.clipPath = `inset(0 ${Math.max(0, full - to).toFixed(1)}px 0 ${from.toFixed(1)}px round ${leftRadius} ${rightRadius} ${rightRadius} ${leftRadius})`;
      part.style.setProperty("--shade", shade);
      part.style.maskImage = part.style.webkitMaskImage = mask;
      part.style.maskSize = part.style.webkitMaskSize = size;
      part.style.maskPosition = part.style.webkitMaskPosition = place;
    }
    let painted = start;
    let follow = "";
    for (const [slot, stretch] of lane.stretches.entries()) {
      if (stretch.left >= lane.left + reveal) break;
      const previous = lane.stretches[slot - 1], next = lane.stretches[slot + 1];
      const from = previous ? (previous.right + stretch.left) / 2 - left : start;
      const to = next ? Math.min(end, (stretch.right + next.left) / 2 - left) : end;
      const transform = strokeFollow(stretchMotion(layout, stretch));
      if (to === end) follow = transform;
      if (!transform) continue;
      fill(painted, from, stroke);
      fill(from, to, transform + stroke);
      painted = to;
    }
    fill(painted, end, stroke);
    while (row.children.length > output) row.lastChild!.remove();
    // The tip rides just past the ink's edge, so a finished word ends with
    // the tip after its last letter rather than on it.
    const nibWidth = nib;
    const along = end - 0.12 * em;
    tip.style.transform = `${follow}translate(${left + along}px, ${top + along * drift}px) rotate(${tilt.toFixed(2)}deg) skewX(-8deg)`;
    tip.style.width = `${nibWidth}px`;
    tip.style.height = `${tall}px`;
    tip.style.setProperty(
      "--tip-opacity",
      `${Math.min(1, (opening + reveal) / nibWidth)}`,
    );
    // Only the row being drawn keeps its tip; a finished row's fades out
    // as the pen moves on, rather than vanishing.
    tip.classList.toggle("lifted", index !== shown.length - 1);
  });
}

/** Read every line before drawing any ink, including animation and resize
 *  frames. Interleaving those reads and writes forces a layout per line
 *  when the Highlighter is enabled midway through a song. */
const queued = new Map<object, () => () => void>();
let flushing = 0;
function batched(key: object, read: () => () => void) {
  queued.set(key, read);
  flushing ||= requestAnimationFrame(() => {
    flushing = 0;
    const jobs = [...queued.values()];
    queued.clear();
    jobs.map((read) => read()).forEach((write) => write());
  });
}

function cancelBatched(key: object) {
  queued.delete(key);
  if (!queued.size) {
    cancelAnimationFrame(flushing);
    flushing = 0;
  }
}

/** One line's words with the marker drawn up to `time`. Lines that are not
 *  being sung pass `-Infinity` (not yet sung) or `Infinity` (sung), so
 *  they skip redrawing each frame. */
export const HighlighterWords = memo(function HighlighterWords({
  line,
  time,
  followingStart,
}: {
  line: Line;
  time: number;
  followingStart?: number;
}) {
  const pieces = useMemo(() => highlighterPieces(line, followingStart), [line, followingStart]);
  // Syllables of one word stay together, so rows break only between
  // words.
  const words = useMemo(() => {
    const groups: number[][] = [[]];
    pieces.forEach((piece, index) => {
      groups.at(-1)!.push(index);
      if (/\s$/.test(piece.text)) groups.push([]);
    });
    return groups.filter((group) => group.length);
  }, [pieces]);
  const root = useRef<HTMLSpanElement>(null),
    ink = useRef<HTMLSpanElement>(null),
    layout = useRef<Layout>(undefined),
    // The pen glides after the song's position instead of snapping to it.
    pen = useRef({ path: 0, at: 0, drawn: false }),
    redraw = useRef<() => void>(() => {}),
    latest = useRef(time);
  latest.current = time;
  const seed = line.start_ms % 997;
  useLayoutEffect(() => {
    const element = root.current,
      sheet = ink.current;
    if (!element || !sheet) return;
    const floating = element.closest<HTMLElement>(".gravity-word");
    const state = pen.current;
    const read = () => {
      const now = performance.now();
      const resized = !layout.current;
      const current = (layout.current ??= measure(element, pieces));
      const target = pathAt(current, pieces, latest.current);
      const elapsed = state.at ? Math.min(100, now - state.at) : 1000 / 60;
      state.at = now;
      // A small easing window bridges consecutive words without delaying
      // held words. Seeking or replacing a layout still lands immediately.
      const finishing = latest.current === Infinity;
      const jump = target - state.path;
      state.path =
        !state.drawn || resized || jump < -1 || jump > current.em * 9
          ? target
          : state.path +
            jump * (1 - Math.exp(-elapsed / (finishing ? 32 : 18)));
      state.drawn = true;
      const moving = Math.abs(target - state.path) > 0.3;
      if (!moving) {
        state.path = target;
        state.at = 0;
      }
      return () => {
        paint(sheet, current, pieces, state.path, latest.current, seed, floating);
        if (moving) step();
      };
    };
    const step = () => batched(element, read);
    redraw.current = step;
    // Lines not yet sung have no ink and need no measuring.
    if (time === -Infinity) {
      if (floating) highlighterTails.delete(floating);
      sheet.replaceChildren();
      state.path = 0;
      state.at = 0;
      state.drawn = false;
    } else {
      // The animator writes transforms before this batch paints.
      step();
    }
    const settling = time === Infinity ? new MutationObserver(step) : undefined;
    if (settling) {
      for (const piece of element.querySelectorAll(".highlighter-piece")) {
        settling.observe(piece, { attributes: true, attributeFilter: ["style"] });
      }
    }
    return () => {
      settling?.disconnect();
      cancelBatched(element);
    };
  }, [pieces, time, seed]);
  // Rows move when the window or text size changes.
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const floating = element.closest<HTMLElement>(".gravity-word");
    const observer = new ResizeObserver(() => {
      layout.current = undefined;
      if (latest.current !== -Infinity) redraw.current();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (floating) highlighterTails.delete(floating);
      cancelBatched(element);
      layout.current = undefined;
    };
  }, [pieces, seed]);
  return (
    <span className="highlighter-words" ref={root}>
      <span className="highlighter-ink" aria-hidden="true" ref={ink} />
      {words.map((word) => {
        const last = word.at(-1)!;
        const trailing = /\s$/u.test(pieces[last].text);
        return (
          <Fragment key={word[0]}>
            <span className="highlighter-word">
              {word.map((index) => (
                <span
                  key={index}
                  className="highlighter-piece lyric-syllable"
                  data-start={pieces[index].start_ms}
                  data-end={pieces[index].end_ms}
                  style={{ "--ink": inkAt(pieces[index], time) } as CSSProperties}
                >
                  {index === last ? pieces[index].text.trimEnd() : pieces[index].text}
                </span>
              ))}
            </span>
            {trailing ? " " : null}
          </Fragment>
        );
      })}
    </span>
  );
});
