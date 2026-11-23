import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import {
  lineBlur,
  tuneMotion,
  vocalGap,
  wordGroups,
  type AnimatedWord,
} from "./lyric-motion";
import type { AnimatorSettings } from "./animator-tuning";
import { LyricAnimator } from "./lyric-animator";
import { presetOf } from "./animator-tuning";
import { LyricWord } from "./lyric-word";
import { LyricCountdown } from "./lyric-countdown";
import {
  createBody,
  GRAVITY,
  gravityPieces,
  hash,
  lineLayout,
  random,
  measure,
  spawn,
  speedMultiplier,
  staticLayout,
  step,
  trackWindow,
  visibleWordCount,
  wordWindow,
  type Body,
  type Field,
  type Rect,
  type WindowMotion,
} from "./space-gravity";
import { windowPosition } from "./window-activity";
import type { Line, Lyrics } from "./types";
import { HighlighterWords, highlighterAnchors, nextMarkerStarts, type InkAnchor } from "./highlighter";
import { frameDue } from "./frame-cap";
import { trackGravityStage } from "../gravity-frame";
import { collideWithVisualiser, type VisualiserFrame } from "./visualiser-frame";
import { cubicCommand, GravityLinkTrail, interpolatePoint } from "./gravity-link-trail";

const LINK_LEAD_MS = 28;
const MAX_LINK_TRAVEL_MS = 680;

interface Entity {
  key: string;
  text: string;
  /** Source line index, and the syllables to animate like normal lyrics. */
  line: number;
  words: AnimatedWord[];
  /** The word as a line of its own, for the Highlighter's pen. */
  ink: Line;
  followingStart?: number;
  previous?: Entity;
  phraseStart: number;
  phraseEnd: number;
  start: number;
  end: number;
  /** Lead line ordinal this word belongs to (backing vocals use their parent). */
  lead: number;
  /** Position within its line, for the spawn layout. */
  slot: number;
  slots: number;
  /** Index across all lead words, or -1 for backing vocals. */
  index: number;
  background: boolean;
  opposite: boolean;
  seed: number;
  speed: number;
}
interface LeadLine {
  start: number;
  end: number;
  first: number;
  count: number;
}

/** Groups shown words by their source line, keeping first-seen order. */
function groupByLine(entities: Entity[]) {
  const groups = new Map<number, Entity[]>();
  for (const entity of entities) {
    const group = groups.get(entity.line) ?? [];
    group.push(entity);
    groups.set(entity.line, group);
  }
  return [...groups.entries()];
}

/** Splits lyrics into floating word entities grouped by lead line. */
export function prepareGravity(lyrics: Lyrics) {
  const entities: Entity[] = [];
  const following = nextMarkerStarts(lyrics.lines);
  const leads: LeadLine[] = [];
  let previousLead: Entity | undefined;
  let total = 0;
  for (const [lineIndex, line] of lyrics.lines.entries()) {
    if (!line.words.length) continue;
    if (!line.background || !leads.length)
      leads.push({
        start: line.start_ms,
        end: line.end_ms,
        first: total,
        count: 0,
      });
    const lead = leads.length - 1;
    const pieces = wordGroups(line.words).flatMap(gravityPieces).filter((piece) => piece.text);
    const speed = speedMultiplier(line.words.map((word) => word.start_ms));
    let previousInPhrase: Entity | undefined;
    for (const [slot, piece] of pieces.entries()) {
      const { text } = piece;
      const background = line.background;
      // A trailing space inside a rotated word's paint box draws a dotted
      // hairline past its last letter; floating words need no spacing.
      const words = piece.words.map((word, index, all) =>
        index === all.length - 1
          ? { ...word, text: word.text.trimEnd() }
          : word,
      );
      const entity: Entity = {
        key: `${lineIndex}:${slot}`,
        text,
        line: lineIndex,
        words,
        ink: {
          ...line,
          start_ms: piece.start,
          end_ms: piece.end,
          text: words.map((word) => word.text).join(""),
          words,
        },
        followingStart: pieces[slot + 1]?.start ?? (background ? undefined : following[lineIndex]),
        previous: background ? previousInPhrase : previousLead,
        phraseStart: line.start_ms,
        phraseEnd: line.end_ms,
        start: piece.start,
        end: piece.end,
        lead,
        slot,
        slots: pieces.length,
        index: background ? -1 : total,
        background,
        opposite: line.opposite,
        seed: hash(`${line.start_ms}:${line.end_ms}:${text}:${slot}`),
        speed,
      };
      entities.push(entity);
      previousInPhrase = entity;
      if (!background) {
        previousLead = entity;
        total += 1;
        leads[lead].count += 1;
      }
    }
  }
  const finalEnd = entities
    .filter((entity) => !entity.background)
    .reduce((end, entity) => Math.max(end, entity.end), -Infinity);
  return { entities, leads, total, finalEnd };
}

type Role = "current" | "next" | "previous";
export function gravityRole(
  entity: Entity,
  lead: LeadLine,
  time: number,
  finalEnd: number,
): Role {
  if (entity.background)
    return time < entity.start
      ? "next"
      : time < entity.end
        ? "current"
        : "previous";
  if (time >= finalEnd) return "previous";
  if (time >= lead.start && time < lead.end) return "current";
  return time < lead.start ? "next" : "previous";
}

/** Lead line and word the window centres on: the one sung or coming next. */
export function gravityAnchor(
  prepared: ReturnType<typeof prepareGravity>,
  time: number,
) {
  const { leads, entities } = prepared;
  if (!leads.length) return { line: -1, word: Number.NaN };
  let line = leads.findIndex((lead) => time < lead.end);
  if (line < 0) line = leads.length - 1;
  const words = entities.filter(
    (entity) => entity.lead === line && !entity.background,
  );
  const word =
    words.find((entity) => time >= entity.start && time < entity.end) ??
    words.find((entity) => time < entity.start) ??
    words.at(-1);
  return { line, word: word?.index ?? Number.NaN };
}

/** Words to show: a window around the sung word plus its line and backing. */
export function visibleGravity(
  prepared: ReturnType<typeof prepareGravity>,
  time: number,
  count: number,
) {
  const anchor = gravityAnchor(prepared, time);
  const range = wordWindow(anchor.word, prepared.total, count);
  const lines = new Set<number>();
  if (anchor.line >= 0) lines.add(anchor.line);
  for (const entity of prepared.entities)
    if (
      range &&
      !entity.background &&
      entity.index >= range.first &&
      entity.index <= range.last
    )
      lines.add(entity.lead);
  return prepared.entities.filter(
    (entity) =>
      (entity.background &&
        (lines.has(entity.lead) ||
          (entity.phraseStart <= time + MAX_LINK_TRAVEL_MS + LINK_LEAD_MS && time < entity.phraseEnd))) ||
      entity.lead === anchor.line ||
      (!!range && entity.index >= range.first && entity.index <= range.last),
  );
}

function relative(element: Element | null | undefined, stage: DOMRect) {
  const rect = element?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return undefined;
  return {
    left: rect.left - stage.left,
    top: rect.top - stage.top,
    right: rect.right - stage.left,
    bottom: rect.bottom - stage.top,
  };
}
const union = (rects: (Rect | undefined)[]) =>
  rects.reduce<Rect | undefined>(
    (all, rect) =>
      !rect
        ? all
        : !all
          ? rect
          : {
              left: Math.min(all.left, rect.left),
              top: Math.min(all.top, rect.top),
              right: Math.max(all.right, rect.right),
              bottom: Math.max(all.bottom, rect.bottom),
            },
    undefined,
  );
const contains = (outer: Rect | undefined, inner: Rect | undefined) =>
  !!outer &&
  !!inner &&
  outer.left <= inner.left &&
  outer.top <= inner.top &&
  outer.right >= inner.right &&
  outer.bottom >= inner.bottom;

/** Where words may float on this page, as the fork measures it: the whole
 * page above the credits. Over Canvas only the song details and controls
 * block words; otherwise words also drift around the artwork, above it and
 * below the title. Lines start laid out in the lyrics column. */
type GravityField = Field & { bars?: Rect };

function measureField(stage: HTMLElement, visualiser?: HTMLCanvasElement): GravityField {
  const box = stage.getBoundingClientRect();
  const page = stage.closest(".lyrics-page");
  const bounds = { width: stage.clientWidth, height: stage.clientHeight };
  const bars = relative(visualiser, box);
  const canvas =
    !!page?.matches(".canvas-lyrics:not(.narrow)") &&
    !page.matches(".no-artwork");
  const footer = relative(page?.querySelector(".gravity-credits"), box);
  const column = relative(page?.querySelector(".lyrics-body"), box);
  const area = { left: 0, top: 0, right: bounds.width, bottom: bounds.height };
  area.bottom = Math.min(area.bottom, footer?.top ?? area.bottom);
  const toolbar = relative(page?.querySelector(".lyrics-toolbar"), box);
  // Title and artists sit together; the full screen controls can be far
  // from them (over a canvas, title bottom left and controls top left), so
  // they block on their own rather than as one box across the page.
  const dock = union(
    [".lyrics-title", ".lyrics-artists"].map((selector) =>
      relative(page?.querySelector(selector), box),
    ),
  );
  const controls = relative(
    page?.querySelector(".lyrics-fullscreen-controls"),
    box,
  );
  const cover = canvas
    ? undefined
    : relative(
        page?.querySelector(".lyrics-media .cover") ??
          page?.querySelector(".lyrics-media"),
        box,
      );
  return {
    bounds,
    bars: bars && box.width && box.height ? {
      left: bars.left * bounds.width / box.width, right: bars.right * bounds.width / box.width,
      top: bars.top * bounds.height / box.height, bottom: bars.bottom * bounds.height / box.height,
    } : undefined,
    area,
    layout: column && {
      ...column,
      bottom: Math.min(column.bottom, area.bottom),
    },
    footer,
    cover,
    blockers: [
      dock,
      controls,
      contains(dock, toolbar) ||
      contains(controls, toolbar) ||
      contains(cover, toolbar)
        ? undefined
        : toolbar,
    ].filter((rect): rect is Rect => !!rect),
  };
}

type GravityBody = Body & { spawned: boolean; entryFrame?: number };

let kept: { signature: string; bodies: Map<string, GravityBody> } | undefined;

const SVG = "http://www.w3.org/2000/svg";
interface TrailPose {
  entry: { x: number; y: number };
  exit: { x: number; y: number };
  angle: number;
  band: number;
}

interface TrailLink {
  from: Entity;
  to: Entity;
  begin: number;
  finish: number;
  wordAt: number;
  trail?: GravityLinkTrail;
  path?: SVGPathElement;
  geometry?: string;
  dash?: string;
  offset?: string;
}

const sheets = new WeakMap<SVGSVGElement, {
  links: Map<string, TrailLink>;
  connected: Set<string>;
}>();

function wordPose(body: GravityBody, word: HTMLElement): TrailPose {
  const angle = body.angle * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const ink = highlighterAnchors.get(word);
  const reach = body.width / 2 - Math.min(body.width / 4, body.height * 0.2);
  const project = (anchor: InkAnchor | undefined, side: -1 | 1) => {
    const x = (anchor ? anchor.x - body.width / 2 : side * reach) * body.scale;
    const y = anchor ? (anchor.y - body.height / 2) * body.scale : 0;
    return { x: body.x + cos * x - sin * y, y: body.y + sin * x + cos * y };
  };
  return {
    entry: project(ink?.entry, -1),
    exit: project(ink?.exit, 1),
    angle,
    band: body.height * body.scale * 0.84,
  };
}

function timeLink(from: Entity, to: Entity, a: TrailPose, b: TrailPose): TrailLink {
  const distance = Math.hypot(b.entry.x - a.exit.x, b.entry.y - a.exit.y);
  const travel = Math.min(MAX_LINK_TRAVEL_MS, Math.max(135, 90 + distance * 1.1));
  const finish = Math.max(from.start + 16, to.start - LINK_LEAD_MS);
  const depart = Math.min(from.start + Math.min(90, (from.end - from.start) * 0.28),
    Math.max(from.start, finish - 70));
  const wordLength = Math.hypot(b.exit.x - b.entry.x, b.exit.y - b.entry.y);
  const curveLength = Math.max(1, distance * 1.2);
  return {
    from, to, finish,
    begin: Math.max(depart, finish - travel),
    wordAt: Math.min(0.9, Math.max(0.45, curveLength / (curveLength + wordLength))),
  };
}

const coordinates = (point: { x: number; y: number }) =>
  `${point.x.toFixed(1)} ${point.y.toFixed(1)}`;

function trailCurve(link: TrailLink, a: TrailPose, b: TrailPose, fraction: number, dt?: number) {
  const start = a.exit, end = b.entry;
  const reach = Math.min(160, Math.hypot(end.x - start.x, end.y - start.y) * 0.45);
  const swing = ((link.from.seed % 200) / 100 - 1) * Math.PI / 12;
  const out = a.angle, into = b.angle;
  const first = { x: start.x + Math.cos(out + swing) * reach, y: start.y + Math.sin(out + swing) * reach };
  const second = { x: end.x - Math.cos(into - swing) * reach, y: end.y - Math.sin(into - swing) * reach };
  if (dt === undefined) {
    link.trail = undefined;
    return cubicCommand(start, first, second, end, fraction);
  }
  const trail = link.trail ??= new GravityLinkTrail();
  return trail.draw(start, first, second, end, out, into, dt, fraction);
}

const TRAIL_DELAY_MS = 2280;
const MAX_TRAIL_WORDS = 10;

function linkReveal(link: TrailLink, time: number) {
  const progress = Math.min(1, Math.max(0, (time - link.begin) / (link.finish - link.begin)));
  return progress * progress * (3 - 2 * progress);
}

function tailTrim(link: TrailLink, time: number) {
  const begin = Math.max(link.finish, link.from.start + TRAIL_DELAY_MS);
  const end = Math.max(link.finish, link.to.start) + TRAIL_DELAY_MS;
  const progress = Math.max(0, Math.min(1, (time - begin) / Math.max(1, end - begin)));
  return progress * progress * (3 - 2 * progress);
}

/** Split adjacent passes at the same point and tangent under the word.
 *  Separate passes can multiply at crossings without doubling at the joins. */
function paintPass(sheet: SVGSVGElement, link: TrailLink, geometry: string, width: number, trim: number) {
  let path = link.path;
  if (!path) {
    path = sheet.ownerDocument.createElementNS(SVG, "path");
    path.setAttribute("pathLength", "1");
    sheet.append(path);
    link.path = path;
  }
  if (link.geometry !== geometry) {
    link.geometry = geometry;
    path.setAttribute("d", geometry);
  }
  const size = `${width.toFixed(1)}px`;
  const dash = trim > 0 ? `${(1 - trim).toFixed(4)} 2` : "none";
  const offset = trim > 0 ? (-trim).toFixed(4) : "0";
  if (path.style.strokeWidth !== size) path.style.strokeWidth = size;
  if (link.dash !== dash || link.offset !== offset) {
    path.style.strokeDasharray = link.dash = dash;
    path.style.strokeDashoffset = link.offset = offset;
  }
}

function drawLinks(
  sheet: SVGSVGElement,
  entities: ReadonlyMap<string, Entity>,
  bodies: Map<string, GravityBody>,
  elements: Map<string, HTMLElement>,
  time: number,
  width: number,
  dt?: number,
) {
  let state = sheets.get(sheet);
  if (!state) sheets.set(sheet, state = { links: new Map(), connected: new Set() });
  const poses = new Map<string, TrailPose>();
  const pose = (key: string) => {
    const cached = poses.get(key);
    if (cached) return cached;
    const body = bodies.get(key), word = elements.get(key);
    if (!body?.spawned || !word) return;
    const next = wordPose(body, word);
    poses.set(key, next);
    return next;
  };

  const next = new Map<string, TrailLink>();
  const incoming = new Set<string>();
  if (width > 0) {
    for (const word of elements.keys()) {
      const to = entities.get(word), from = to?.previous;
      if (!to || !from || to.start - time > MAX_LINK_TRAVEL_MS + LINK_LEAD_MS) continue;
      if (time >= Math.max(to.start, from.start + 16) + TRAIL_DELAY_MS) continue;
      const a = pose(from.key), b = pose(to.key);
      if (!a || !b) continue;
      const link = state.links.get(from.key) ?? timeLink(from, to, a, b);
      if (time < link.begin || tailTrim(link, time) >= 1) continue;
      next.set(from.key, link);
      incoming.add(to.key);
    }
  }

  const drawn = new Map<string, TrailLink>();
  const connected = new Set<string>();
  for (const [head, first] of next) {
    if (incoming.has(head)) continue;
    const run: { link: TrailLink; reveal: number }[] = [];
    for (let link: TrailLink | undefined = first; link; link = next.get(link.to.key)) {
      const reveal = linkReveal(link, time);
      run.push({ link, reveal });
      if (reveal < 1) break;
    }
    for (const [index, { link, reveal }] of run.entries()) {
      // Retract the oldest link as the tip approaches the eleventh word.
      const replacement = run[index + MAX_TRAIL_WORDS - 1];
      const countTrim = replacement ? Math.min(1, replacement.reveal / replacement.link.wordAt) : 0;
      const trim = Math.max(tailTrim(link, time), countTrim);
      if (trim >= 1) continue;
      const a = pose(link.from.key)!;
      const b = pose(link.to.key)!;
      const midpoint = interpolatePoint(a.entry, a.exit, 0.5);
      let geometry = `M${coordinates(midpoint)}L${coordinates(a.exit)}`;
      geometry += trailCurve(link, a, b, Math.min(1, reveal / link.wordAt), dt);
      if (reveal >= link.wordAt) {
        const throughWord = (reveal - link.wordAt) / (1 - link.wordAt);
        const joinsNext = index + 1 < run.length;
        const tip = interpolatePoint(b.entry, b.exit, joinsNext ? 0.5 : throughWord);
        geometry += `L${coordinates(tip)}`;
        connected.add(link.to.key);
      }
      paintPass(sheet, link, geometry, Math.min(a.band, b.band) * width, trim);
      drawn.set(link.from.key, link);
    }
  }

  for (const [key, link] of state.links) {
    if (!drawn.has(key)) link.path?.remove();
  }
  state.links = drawn;
  for (const key of state.connected) {
    if (!connected.has(key)) elements.get(key)?.removeAttribute("data-marker-connected");
  }
  for (const key of connected) {
    const word = elements.get(key);
    if (word && !word.hasAttribute("data-marker-connected")) word.setAttribute("data-marker-connected", "");
  }
  state.connected = connected;
}

/** One floating word. Memoised: while a song plays only the words whose
 *  role or ink changes re-render, not every word on every frame. */
const GravityWord = memo(function GravityWord({
  entity,
  role,
  exiting,
  highlighter,
  inkTime,
  wordRef,
  onSeek,
}: {
  entity: Entity;
  role: Role;
  exiting: boolean;
  highlighter: boolean;
  /** Song time for the Highlighter's pen: -Infinity before the word,
   *  Infinity after it, so only the sung word changes per frame. */
  inkTime: number;
  wordRef: (element: HTMLElement | null) => void;
  onSeek: (position: number) => void;
}) {
  return (
    <button
      ref={wordRef}
      className={`gravity-word ${role} ${entity.opposite ? "opposite" : ""} ${entity.background ? "background" : ""} ${exiting ? "exiting" : ""}`}
      onClick={() => onSeek(entity.start)}
      tabIndex={exiting ? -1 : 0}
    >
      {highlighter ? (
        <HighlighterWords line={entity.ink} time={inkTime} followingStart={entity.followingStart} />
      ) : (
        <LyricWord words={entity.words} />
      )}
    </button>
  );
});

/** Space Gravity: sung words float in zero gravity around the artwork. */
export function SpaceGravityLyrics({
  lyrics,
  time,
  reduceMotion,
  tuning,
  onSeek,
  credits,
  highlighter,
  wordDensity,
  linkWidth = 1,
  visualiser,
}: {
  lyrics: Lyrics;
  time: number;
  reduceMotion: boolean;
  wordDensity: number;
  /** The Highlighter's ink colour: each word gets its pen instead of the
   *  usual sweep. */
  highlighter?: string;
  /** Connecting lines' width as a share of the Highlighter's band; 0
   *  turns them off. */
  linkWidth?: number;
  visualiser?: RefObject<VisualiserFrame | null>;
  tuning?: AnimatorSettings;
  onSeek: (position: number) => void;
  credits: ReactNode;
}) {
  // The same lyrics can arrive again (cached, then fetched) when a song
  // comes back; only new words start the field over.
  const signature = useMemo(() => JSON.stringify(lyrics.lines), [lyrics]);
  const prepared = useMemo(
    () => prepareGravity(lyrics),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature],
  );
  const gap = vocalGap(lyrics.lines, time);
  const waitKey = gap ? `wait:${gap.start}:${gap.end}` : "";
  const stage = useRef<HTMLDivElement>(null);
  // Lead words that fit the free play area; measured by the frame loop.
  const [baselineCount, setBaselineCount] = useState<number>(GRAVITY.minVisibleWords);
  const count = Math.round(baselineCount * wordDensity / 100);
  const visible = visibleGravity(prepared, time, count);
  const visibleKeys = visible.map((entity) => entity.key).join("|");
  // Each departing batch keeps its own fade, even when more words leave.
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
    : visible;

  const elements = useRef(new Map<string, HTMLElement>());
  const stageView = useRef<ReturnType<typeof trackGravityStage>>(undefined);
  // Words keep their places when the view remounts for the same lyrics,
  // as when a song briefly loses and regains its lyrics.
  const [restored] = useState(() => {
    if (kept?.signature !== signature) return new Map<string, GravityBody>();
    for (const body of kept.bodies.values()) body.entryFrame = 0;
    return kept.bodies;
  });
  const bodies = useRef(restored);
  const fieldOf = useRef(signature);
  const live = useRef({
    visible,
    prepared,
    reduceMotion,
    waitKey,
    time,
    linkWidth,
    visualiser,
  });
  live.current = {
    visible,
    prepared,
    reduceMotion,
    waitKey,
    time,
    linkWidth,
    visualiser,
  };
  const links = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    for (const word of elements.current.values()) word.removeAttribute("data-marker-connected");
  }, [highlighter, signature]);
  // A stable seek handler, so floating words skip re-rendering.
  const seekTo = useRef(onSeek);
  seekTo.current = onSeek;
  const [seek] = useState(() => (position: number) => seekTo.current(position));
  useEffect(() => {
    // A new song starts every word fresh.
    if (fieldOf.current === signature) return;
    fieldOf.current = signature;
    bodies.current.clear();
    refs.current.clear();
  }, [signature]);
  useEffect(
    () => () => {
      kept = { signature: fieldOf.current, bodies: bodies.current };
    },
    [],
  );
  // One stable ref callback per word. An inline callback would be detached
  // and reattached on every render (every frame while playing), and its
  // cleanup would respawn the word each time.
  const refs = useRef(new Map<string, (element: HTMLElement | null) => void>());
  const refFor = (key: string) => {
    let callback = refs.current.get(key);
    if (!callback) {
      callback = (element) => {
        const previous = elements.current.get(key);
        if (previous === element) return;
        if (previous) stageView.current?.remove(previous);
        if (element) {
          elements.current.set(key, element);
          stageView.current?.add(element);
        } else elements.current.delete(key);
      };
      refs.current.set(key, callback);
    }
    return callback;
  };

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const frameWindow = element.ownerDocument.defaultView ?? window;
    const view = stageView.current = trackGravityStage(element);
    for (const node of elements.current.values()) view.add(node);
    let frame = 0,
      renderFrame = 0,
      last = frameWindow.performance.now(),
      fieldAt = 0,
      field: GravityField | undefined,
      lastCanvas: HTMLCanvasElement | undefined,
      staticKey = "",
      indexed: typeof prepared | undefined,
      byKey = new Map<string, Entity>();
    const motion: WindowMotion = { vx: 0, vy: 0 };
    const tick = (now: number) => {
      frame = frameWindow.requestAnimationFrame(tick);
      if (!frameDue(last, now)) return;
      renderFrame += 1;
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      let measured = false;
      const visualiser = live.current.visualiser?.current;
      const canvas = visualiser?.canvas;
      if (view.takeStageResize() || !field || canvas !== lastCanvas || now - fieldAt > 250) {
        fieldAt = now;
        measured = true;
        lastCanvas = canvas;
        field = measureField(element, canvas);
        const next = visibleWordCount(field);
        setBaselineCount(next);
      }
      if (field.bounds.width < 1 || field.bounds.height < 1) return;
      const { visible, prepared, reduceMotion, waitKey } = live.current;
      if (indexed !== prepared) {
        indexed = prepared;
        byKey = new Map(prepared.entities.map((item) => [item.key, item]));
      }
      const shownKeys = new Set(visible.map((entity) => entity.key));
      if (waitKey) shownKeys.add(waitKey);
      let wordResized = false;
      for (const [key, node] of elements.current) {
        const size = view.size(node);
        if (!size?.width || !size.height) continue;
        const entity = byKey.get(key);
        let body = bodies.current.get(key);
        if (!body) {
          body = {
            ...createBody(
              entity?.seed ?? hash(key),
              entity?.speed ?? 1,
              entity ? prepared.leads[entity.lead].start : 0,
              entity ? prepared.entities.indexOf(entity) : -1,
            ),
            spawned: false,
          };
          bodies.current.set(key, body);
        }
        if (body.width !== size.width || body.height !== size.height) {
          measure(body, size.width, size.height);
          wordResized = true;
        }
      }
      // Each new word starts near its place in its line, laid out across
      // the play area and centred in it, then drifts from there.
      // Beside artwork, words start in the lyrics column. Over a canvas
      // nothing needs dodging, so they start spread across the stage.
      const spread = !field.cover && !!element.closest(".canvas-lyrics");
      const area = spread ? field.area! : (field.layout ?? field.area!);
      const lines = new Map<string, string[]>();
      for (const key of shownKeys) {
        const node = elements.current.get(key);
        if (!node || !view.size(node)?.width || !bodies.current.has(key)) continue;
        const line = key === waitKey ? key : String(byKey.get(key)?.line);
        lines.set(line, [...(lines.get(line) ?? []), key]);
      }
      const occupied: GravityBody[] = [];
      for (const [key, body] of bodies.current)
        if (body.spawned && elements.current.has(key)) occupied.push(body);
      for (const keys of lines.values()) {
        const members = keys.map((key) => bodies.current.get(key)!);
        if (members.every((body) => body.spawned)) continue;
        const width = area.right - area.left - GRAVITY.edgePadding * 2;
        const layout = lineLayout(
          members,
          width,
          !!byKey.get(keys[0])?.opposite,
          spread ? Math.max(...members.map((body) => body.height)) * 1.1 : 0,
        );
        // Spread lines each start at their own seeded spot across the
        // stage, so lines don't all pile up from the middle and get pushed
        // to one side.
        const placeX = spread ? random(hash(`${keys[0]}:x`)) * 2 - 1 : 0,
          placeY = spread ? random(hash(`${keys[0]}:y`)) * 2 - 1 : 0;
        const edges = layout.places.map((place, index) => [
          place.x - members[index].width / 2,
          place.x + members[index].width / 2,
        ]);
        const rowWidth =
          Math.max(...edges.map(([, right]) => right)) -
          Math.min(...edges.map(([left]) => left));
        const slackX = Math.max(0, width - rowWidth) / 2,
          slackY = Math.max(0, area.bottom - area.top - layout.height) / 2;
        const top =
          area.top +
          (area.bottom - area.top - layout.height) / 2 +
          placeY * slackY * 0.8;
        members.forEach((body, index) => {
          body.naturalX =
            area.left +
            GRAVITY.edgePadding +
            layout.places[index].x +
            placeX * slackX * 0.8;
          body.naturalY = top + layout.places[index].y;
        });
        for (const body of members) {
          if (body.spawned) continue;
          spawn(body, occupied, field, reduceMotion);
          body.spawned = true;
          body.entryFrame = renderFrame;
          occupied.push(body);
        }
      }
      const active: GravityBody[] = [],
        exiting: GravityBody[] = [];
      for (const [key, body] of bodies.current) {
        if (!body.spawned || !elements.current.has(key)) continue;
        (shownKeys.has(key) ? active : exiting).push(body);
      }
      if (reduceMotion) {
        const key = [...lines.values()].flat().join("|");
        if (key !== staticKey || measured || wordResized) {
          staticKey = key;
          staticLayout(
            [...lines.values()].map((keys) =>
              keys.map((key) => bodies.current.get(key)!),
            ),
            field,
          );
        }
      } else {
        trackWindow(
          motion,
          (frameWindow === window ? windowPosition() : undefined) ?? { x: frameWindow.screenX, y: frameWindow.screenY },
          dt,
        );
        step(active, dt, field, motion, exiting);
        if (visualiser && field.bars) {
          for (const body of active) {
            if (body.entryFrame !== renderFrame) collideWithVisualiser(body, visualiser, field.bars);
          }
        }
      }
      // Words that left the screen start fresh when they return.
      for (const key of bodies.current.keys())
        if (!elements.current.has(key)) bodies.current.delete(key);
      for (const [key, node] of elements.current) {
        const body = bodies.current.get(key);
        if (!body?.spawned) continue;
        view.move(node, `translate3d(${body.x - body.width / 2}px, ${body.y - body.height / 2}px, 0) rotate(${body.angle}deg) scale(${body.scale})`);
      }
      if (links.current)
        drawLinks(
          links.current,
          byKey,
          bodies.current,
          elements.current,
          live.current.time,
          live.current.linkWidth,
          reduceMotion ? undefined : dt,
        );
      for (const [key, node] of elements.current) {
        const body = bodies.current.get(key);
        if (!body?.spawned) continue;
        // Shown a frame after placing, so it fades in where it spawned.
        if (
          !node.hasAttribute("data-spawned") &&
          (reduceMotion || (body.entryFrame ?? 0) < renderFrame)
        )
          node.setAttribute("data-spawned", "");
      }
    };
    frame = frameWindow.requestAnimationFrame(tick);
    return () => {
      frameWindow.cancelAnimationFrame(frame);
      view.dispose();
      stageView.current = undefined;
    };
  }, []);

  // Let the sung syllables stand out against the words' floating motion.
  const animator = useRef<LyricAnimator>(undefined);
  const tuningKey = JSON.stringify(tuning ?? {});
  useLayoutEffect(() => {
    tuneMotion(JSON.parse(tuningKey));
    const instance = new LyricAnimator(
      lyrics,
      (index) =>
        stage.current?.querySelector<HTMLElement>(
          `.gravity-line[data-line="${index}"]`,
        ) ?? null,
      reduceMotion,
      false,
      stage.current?.ownerDocument.defaultView ?? window,
      1.45,
    );
    animator.current = instance;
    return () => instance.dispose();
  }, [lyrics, reduceMotion, highlighter, tuningKey]);
  // The credits line up with the lyrics column, where the normal view's
  // end credits sit, so they stay put when Space Gravity turns on or off.
  const credited = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const footer = credited.current;
    const column = footer
      ?.closest(".lyrics-page")
      ?.querySelector(".lyrics-body");
    if (!footer || !column) return;
    const place = () => {
      const parent = footer.offsetParent?.getBoundingClientRect();
      if (!parent) return;
      const box = column.getBoundingClientRect();
      footer.style.left = `${box.left - parent.left}px`;
      footer.style.right = "auto";
      footer.style.width = `${box.width}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(column);
    if (footer.offsetParent) observer.observe(footer.offsetParent);
    return () => observer.disconnect();
  }, []);
  const lastTime = useRef(time);
  useLayoutEffect(() => {
    // A seek jumps song time; snap instead of springing through it.
    if (Math.abs(time - lastTime.current) > 1500) animator.current?.reset();
    lastTime.current = time;
    animator.current?.update(time);
  }, [time, lyrics, reduceMotion, tuningKey]);

  return (
    <div
      data-animator={presetOf(tuning)}
      className={`gravity-lyrics space-gravity ${highlighter ? "highlighter" : ""} ${highlighter && linkWidth > 0 ? "linked" : ""}`}
      style={
        highlighter
          ? ({ "--highlighter-ink": highlighter } as CSSProperties)
          : undefined
      }
    >
      <div
        className="gravity-stage"
        ref={stage}
        aria-label="Space Gravity lyrics"
      >
        {highlighter && (
          <svg key={signature} className="gravity-links" ref={links} aria-hidden="true" />
        )}
        {groupByLine(shown).map(([index, entities]) => {
          const line = lyrics.lines[index];
          // Like the normal view, lines blur by their distance from the line
          // being sung.
          const distance = Math.abs(entities[0].lead - anchorLine);
          const state =
            time >= line.end_ms
              ? "past"
              : time >= line.start_ms
                ? "active"
                : "";
          return (
            // A box-less wrapper so the lyric animator finds this line's
            // syllables, and the normal lyric styles apply to them.
            <div
              key={index}
              className={`gravity-line lyric-line ${state} ${line.background ? "background-vocal" : ""}`}
              data-line={index}
              style={
                {
                  "--blur": `${reduceMotion ? 0 : lineBlur(distance)}px`,
                } as CSSProperties
              }
            >
              {entities.map((entity) => {
                const lead = prepared.leads[entity.lead];
                const role = gravityRole(entity, lead, time, prepared.finalEnd);
                const exiting = !visible.includes(entity);
                return (
                  <GravityWord
                    key={entity.key}
                    entity={entity}
                    role={role}
                    exiting={exiting}
                    highlighter={!!highlighter}
                    inkTime={
                      time < entity.start
                        ? -Infinity
                        : time < entity.end
                          ? time
                          : Infinity
                    }
                    wordRef={refFor(entity.key)}
                    onSeek={seek}
                  />
                );
              })}
            </div>
          );
        })}
        {gap && (
          <LyricCountdown
            key={waitKey}
            ref={refFor(waitKey)}
            className="gravity-wait"
            gap={gap}
            time={time}
            reduceMotion={reduceMotion}
          />
        )}
      </div>
      <div className="gravity-credits" ref={credited}>
        {credits}
      </div>
    </div>
  );
}
