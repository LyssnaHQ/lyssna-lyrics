import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowRightToLine, AudioLines, Eye, EyeOff, Plus, Settings2, Square, Trash2 } from "lucide-react";
import { useCreatorEnvironment, useCreatorTick } from "./environment";
import { useEnhancedPerformance } from "../enhancements/config";
import { pitchBands, spectrumFrequency, spectrumFrequencyPosition } from "./audio";
import { useLiveSpectrum } from "./live-spectrum";
import { useAnchoredPopover } from "../anchored-popover";
import { LIVE_TILE_MS } from "./spectrum-storage";
import { COLOR_STOPS_KEY, colourIndex, DEFAULT_STOPS, MAX_STOPS, PALETTES, PALETTE_KEY,
  paletteGradient, paletteStops, paletteTable, validColorStops, validPalette, type ColorStop, type Palette } from "./spectrum-palette";
import {
  type CreatorLine,
  type Cursor,
  formatTime,
  lineSpan,
  moveEdge,
  panUnit,
} from "./ttml-creator-model";

const TILE_MS = 5000;
const FOLLOW_AFTER_MS = 5000;
const DETAIL = [512, 1024, 2048];
const ROWS = 384;
const SPOTIFY_DETAIL = 512;
const FREQUENCY_LABELS = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 20000];
const RULER = 30;
const SNAP_PX = 7;
const MIN_ZOOM = 50;
const MAX_ZOOM = 10000;
const TILE_CACHE_BYTES = 32 * 1024 * 1024;
const NOTES = "C C# D D# E F F# G G# A A# B".split(" ");

export function noteName(hz: number) {
  if (hz < 8) return "";
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return `${NOTES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export type VocalKind = "main" | "overlap" | "background";

/**
 * Header rows for each line's words: lead vocals share the top row, a lead
 * line whose words are sung over another's drops to the next free row, and
 * background vocals sit in rows under the lead lines they overlap. Overlap
 * counts timed words only; a line's span can reach past its last word.
 */
export function vocalLanes(
  lines: CreatorLine[],
): { lane: number; kind: VocalKind }[] {
  const words = lines.map((line) => {
    const timed = line.units.flatMap((unit) =>
      unit.start !== undefined &&
      unit.end !== undefined &&
      unit.end > unit.start
        ? [{ start: unit.start, end: unit.end }]
        : [],
    );
    const span = timed.length ? null : lineSpan(line);
    return span && span.end > span.start ? [span] : timed;
  });
  const clash = (a: number, b: number) =>
    words[a].some((one) =>
      words[b].some((two) => one.start < two.end && two.start < one.end),
    );
  const lanes = lines.map(() => ({ lane: 0, kind: "main" as VocalKind }));
  const order = (background: boolean) =>
    lines
      .map((line, index) => index)
      .filter(
        (index) =>
          lines[index].background === background && words[index].length,
      )
      .sort((a, b) => words[a][0].start - words[b][0].start);
  const place = (rows: number[][], index: number, from: number) => {
    let lane = from;
    while (rows[lane]?.some((other) => clash(index, other))) lane++;
    (rows[lane] ??= []).push(index);
    return lane;
  };
  const leads = order(false);
  const leadRows: number[][] = [];
  for (const index of leads) {
    const lane = place(leadRows, index, 0);
    lanes[index] = { lane, kind: lane ? "overlap" : "main" };
  }
  const backingRows: number[][] = [];
  for (const index of order(true)) {
    const under = leads
      .filter((other) => clash(index, other))
      .reduce((deepest, other) => Math.max(deepest, lanes[other].lane), 0);
    lanes[index] = {
      lane: place(backingRows, index, under + 1),
      kind: "background",
    };
  }
  return lanes;
}

export function rulerStep(zoom: number) {
  return (
    [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 15000, 30000].find(
      (ms) => (ms / 1000) * zoom >= 90,
    ) ?? 60000
  );
}

const tiles = new Map<string, Uint16Array>();
let tileBytes = 0;
function keep(key: string, data: Uint16Array) {
  tileBytes -= tiles.get(key)?.byteLength ?? 0;
  tiles.delete(key);
  tiles.set(key, data);
  tileBytes += data.byteLength;
  while (tileBytes > TILE_CACHE_BYTES) {
    const oldest = tiles.keys().next().value!;
    tileBytes -= tiles.get(oldest)!.byteLength;
    tiles.delete(oldest);
  }
}

function stored<T>(
  key: string,
  fallback: T,
  valid: (value: unknown) => boolean,
) {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    return valid(value) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Settings still apply for this session.
  }
}
function useStored<T>(
  key: string,
  fallback: T,
  valid: (value: unknown) => boolean,
) {
  const [value, setValue] = useState<T>(() => stored(key, fallback, valid));
  const set = (next: T) => {
    setValue(next);
    store(key, next);
  };
  return [value, set] as const;
}
const isNumber = (value: unknown) => typeof value === "number";
const isBoolean = (value: unknown) => typeof value === "boolean";

const Tile = memo(function Tile({
  data,
  columns,
  rows,
  left,
  width,
  table,
  gain,
  revision,
}: {
  data: Uint16Array;
  columns: number;
  rows: number;
  left: number;
  width: number;
  table: Uint8ClampedArray;
  gain: number;
  revision?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    const image = context.createImageData(columns, rows);
    const pixels = new Uint32Array(image.data.buffer);
    const palette = new Uint32Array(table.buffer);
    for (let index = 0; index < pixels.length; index++) pixels[index] = palette[colourIndex(data[index], gain)];
    context.putImageData(image, 0, 0);
  }, [data, columns, rows, table, gain, revision]);
  return (
    <canvas
      ref={canvas}
      className="ttml-spectrum-tile"
      width={columns}
      height={rows}
      style={{ left, width }}
    />
  );
});

interface Drag {
  at: Cursor;
  edge: "start" | "end" | "word";
  from: number;
  x: number;
}

export function TtmlSpectrogram({
  id,
  uri,
  duration,
  offset,
  playing,
  lines,
  cursor,
  picked,
  onSeek,
  onLines,
  onCursor,
  onPlayUnit,
  canCapture,
}: {
  id: string;
  uri: string;
  duration: number;
  offset: number;
  playing: boolean;
  lines: CreatorLine[];
  cursor: Cursor;
  picked: ReadonlySet<number>;
  onSeek: (ms: number) => void;
  onLines: (lines: CreatorLine[]) => void;
  onCursor: (at: Cursor) => void;
  onPlayUnit: (at: Cursor) => void;
  canCapture: boolean;
}) {
  const { view: window, read, spectrogram, spectrumKey: audioKey, spectrumAudioUri } = useCreatorEnvironment();
  const enhancePerformance = useEnhancedPerformance();
  const localAudio = spectrumAudioUri === uri;
  const canShare = canCapture && !localAudio && duration > 0;
  const liveSpectrum = useLiveSpectrum(uri, canShare);
  const [introSeen, setIntroSeen] = useStored("lyssna.ttml-recording-intro", false, isBoolean);
  const showIntro = canShare && !introSeen && liveSpectrum.status === "idle";
  const shareButton = useRef<HTMLButtonElement>(null);
  const intro = useRef<HTMLDivElement>(null);
  const introId = useId();
  useAnchoredPopover(window, showIntro, shareButton, intro);
  useEffect(() => {
    if (!showIntro) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIntroSeen(true);
      if (intro.current?.contains(event.composedPath()[0] as Node)) shareButton.current?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", dismiss, true);
    return () => window.removeEventListener("keydown", dismiss, true);
  }, [showIntro, window]);
  const liveCapture = !localAudio && (liveSpectrum.hasSaved || liveSpectrum.status === "live");
  const pitch = !localAudio && !liveCapture;
  const spectrumKey = liveCapture ? "live" : pitch ? "spotify-pitch" : audioKey;
  const rows = pitch ? pitchBands : ROWS;
  const asked = useRef(new Map<string, AbortController>());
  useEffect(() => {
    const requests = asked.current;
    return () => { for (const request of requests.values()) request.abort(); requests.clear(); };
  }, [uri, spectrumKey]);
  const [height, setHeight] = useStored(
    "lyssna.ttml-spectrum-height",
    240,
    isNumber,
  );
  const [audioGain, setAudioGain] = useStored("lyssna.ttml-spectrum-gain", 3, isNumber);
  const [pitchGain, setPitchGain] = useStored("lyssna.ttml-pitch-gain", 1, isNumber);
  const gain = pitch ? pitchGain : audioGain;
  const setGain = pitch ? setPitchGain : setAudioGain;
  const [palette, setPalette] = useStored<Palette>(PALETTE_KEY, "icy", validPalette);
  const [customStops, setCustomStops] = useStored(COLOR_STOPS_KEY, DEFAULT_STOPS, validColorStops);
  const [follow, setFollow] = useStored(
    "lyssna.ttml-spectrum-follow",
    true,
    isBoolean,
  );
  const [everyLine, setEveryLine] = useStored(
    "lyssna.ttml-spectrum-every-line",
    true,
    isBoolean,
  );
  const [zoom, setZoom] = useState(() =>
    stored("lyssna.ttml-spectrum-zoom", 200, isNumber),
  );
  const [scroll, setScroll] = useState(0);
  const [{ width, height: plotAreaHeight }, setPlotSize] = useState({ width: 0, height: 0 });
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [settings, setSettings] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const colorsPanel = useRef<HTMLDivElement>(null);
  const colorsId = useId();
  useAnchoredPopover(window, settings, settingsButton, colorsPanel);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState<CreatorLine[] | null>(null);
  const [, setLoaded] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const spectrum = useRef<HTMLElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLCanvasElement>(null);
  const rulerBacking = useRef<OffscreenCanvas>(undefined);
  const playhead = useRef<HTMLDivElement>(null);
  const target = useRef({ zoom, scroll });
  const live = useRef({ zoom, scroll, width, duration });
  live.current = { zoom, scroll, width, duration };
  const frame = useRef<number | null>(null);

  const span = (atZoom: number) => (live.current.duration / 1000) * atZoom;
  const clampScroll = (value: number, atZoom: number) =>
    Math.max(0, Math.min(value, span(atZoom) - live.current.width));
  const glide = () => {
    if (frame.current !== null) return;
    const step = () => {
      const { zoom: nowZoom, scroll: nowScroll } = live.current;
      const goal = target.current;
      const nextZoom = nowZoom + (goal.zoom - nowZoom) * 0.35;
      const nextScroll = nowScroll + (goal.scroll - nowScroll) * 0.35;
      const done =
        Math.abs(nextZoom - goal.zoom) < 1 &&
        Math.abs(nextScroll - goal.scroll) < 1;
      setZoom(done ? goal.zoom : nextZoom);
      setScroll(done ? goal.scroll : nextScroll);
      live.current = {
        ...live.current,
        zoom: done ? goal.zoom : nextZoom,
        scroll: done ? goal.scroll : nextScroll,
      };
      if (done) {
        frame.current = null;
        store("lyssna.ttml-spectrum-zoom", goal.zoom);
      } else frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  };
  const jump = (value: number) => {
    target.current = {
      ...target.current,
      scroll: clampScroll(value, target.current.zoom),
    };
    glide();
  };
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  useEffect(() => {
    const element = area.current;
    const panel = spectrum.current;
    if (!element || !panel) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setPlotSize({ width, height });
    });
    observer.observe(element);
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.composedPath().includes(element)) return;
      event.preventDefault();
      browsed.current = performance.now();
      const goal = target.current;
      if (event.ctrlKey) {
        // Spotify also handles Ctrl+Wheel on window and ignores defaultPrevented.
        event.stopPropagation();
        if (!event.deltaY) return;
        const box = element.getBoundingClientRect();
        const x = Math.max(0, Math.min(box.width, event.clientX - box.left));
        const at = (goal.scroll + x) / goal.zoom;
        const zoomTo = Math.min(
          MAX_ZOOM,
          Math.max(MIN_ZOOM, goal.zoom * (event.deltaY < 0 ? 1.15 : 0.85)),
        );
        target.current = {
          zoom: zoomTo,
          scroll: clampScroll(at * zoomTo - x, zoomTo),
        };
      } else {
        target.current = {
          ...goal,
          scroll: clampScroll(
            goal.scroll + event.deltaY + event.deltaX,
            goal.zoom,
          ),
        };
      }
      glide();
    };
    panel.addEventListener("wheel", wheel, { capture: true, passive: false });
    return () => {
      observer.disconnect();
      panel.removeEventListener("wheel", wheel, true);
    };
  }, []);

  const placed = useRef(false);
  useEffect(() => {
    target.current = { zoom: target.current.zoom, scroll: 0 };
    setScroll(0);
    placed.current = false;
  }, [uri]);

  const last = useRef(read() + offset);
  // Scrolling away while the song plays holds the view for a while before
  // following the playhead again.
  const browsed = useRef(-Infinity);
  useCreatorTick(playing, true, raw => {
    const shown = raw + offset;
    if (playhead.current) playhead.current.style.transform = `translate3d(${shown / 1000 * zoom}px, 0, 0)`;
    const value = String(Math.round(shown));
    if (ruler.current?.getAttribute("aria-valuenow") !== value) ruler.current?.setAttribute("aria-valuenow", value);
    const jumped = Math.abs(shown - last.current) > 1000;
    last.current = shown;
    if (!width || drag) return;
    const x = (shown / 1000) * target.current.zoom;
    const view = target.current.scroll;
    const outside = x < view || x > view + width - 24;
    const resting = performance.now() - browsed.current >= FOLLOW_AFTER_MS;
    // Reopening the creator while paused starts the view at the playhead.
    const opening = !placed.current;
    placed.current = true;
    if (outside && ((follow && playing && resting) || jumped || opening))
      jump(x - width * 0.1);
  });

  const tileMs = liveCapture ? LIVE_TILE_MS : TILE_MS;
  const tilePx = (tileMs / 1000) * zoom;
  const detail = pitch ? SPOTIFY_DETAIL : DETAIL.find((columns) => columns >= tilePx) ?? DETAIL.at(-1)!;
  const failureKey = `${spectrumKey}|${uri}`;
  const tileCount = Math.ceil(duration / tileMs);
  const firstTile = Math.max(0, Math.floor(scroll / tilePx) - 1);
  const lastTile = Math.min(
    tileCount - 1,
    Math.ceil((scroll + width) / tilePx) + 1,
  );
  const visible: { index: number; data: Uint16Array; columns: number; rows: number; revision?: number }[] = [];
  for (let index = firstTile; width && index <= lastTile; index++) {
    if (liveCapture) {
      const captured = liveSpectrum.tiles.get(index);
      if (captured) {
        const { levels, filled } = captured.tile;
        visible.push({ index, data: levels, columns: filled.length, rows: levels.length / filled.length, revision: captured.revision });
      }
      continue;
    }
    const key = `${spectrumKey}|${uri}|${index}|${detail}`;
    let data = tiles.get(key);
    let columns = detail;
    if (!data)
      for (const other of DETAIL) {
        const fallback = tiles.get(`${spectrumKey}|${uri}|${index}|${other}`);
        if (fallback) {
          data = fallback;
          columns = other;
          break;
        }
      }
    if (data) visible.push({ index, data, columns, rows });
  }
  const loadLiveTiles = liveSpectrum.load;
  useEffect(() => {
    if (liveCapture && width) return loadLiveTiles(firstTile, lastTile);
  }, [liveCapture, loadLiveTiles, firstTile, lastTile, width]);
  useEffect(() => {
    if (liveCapture || !width || failed === failureKey) return;
    const needed = new Map<string, number>();
    for (let index = firstTile; index <= lastTile; index++) needed.set(`${failureKey}|${index}|${detail}`, index);
    for (const [key, request] of asked.current) {
      if (needed.has(key)) continue;
      request.abort();
      asked.current.delete(key);
    }
    for (const [key, index] of needed) {
      if (tiles.has(key) || asked.current.has(key)) continue;
      const request = new AbortController();
      asked.current.set(key, request);
      spectrogram(uri, index * TILE_MS, (index + 1) * TILE_MS, detail, rows, request.signal)
        .then((data) => {
          if (!request.signal.aborted && data.length === detail * rows) {
            keep(key, data);
            setLoaded((count) => count + 1);
          }
        })
        .catch(() => { if (!request.signal.aborted) setFailed(failureKey); })
        .finally(() => { if (asked.current.get(key) === request) asked.current.delete(key); });
    }
  }, [uri, firstTile, lastTile, detail, rows, width, failed, failureKey, spectrogram, liveCapture]);

  const table = useMemo(() => paletteTable(palette, customStops), [palette, customStops]);
  const paletteRamp = useMemo(() => paletteGradient(paletteStops(palette, customStops)), [palette, customStops]);

  function updateColorStop(index: number, patch: Partial<ColorStop>) {
    setCustomStops(customStops.map((stop, at) => at === index ? { ...stop, ...patch } : stop));
  }

  function addColorStop() {
    if (customStops.length >= MAX_STOPS) return;
    const sorted = customStops.toSorted((left, right) => left.position - right.position);
    const positions = [0, ...sorted.map(stop => stop.position), 1];
    let position = 0.5;
    let gap = 0;
    for (let index = 1; index < positions.length; index++) {
      const span = positions[index] - positions[index - 1];
      if (span <= gap) continue;
      gap = span;
      position = (positions[index] + positions[index - 1]) / 2;
    }
    const at = Math.round(position * 255) * 4;
    const color = "#" + Array.from(table.subarray(at, at + 3), byte => byte.toString(16).padStart(2, "0")).join("");
    setCustomStops([...customStops, { position: Math.round(position * 1000) / 1000, color }]);
  }

  useLayoutEffect(() => {
    const element = ruler.current;
    const output = element?.getContext("2d");
    if (!element || !output || !width) return;
    const scale = window.devicePixelRatio;
    const deviceWidth = Math.round(width * scale);
    const deviceHeight = Math.round(RULER * scale);
    if (element.width !== deviceWidth) element.width = deviceWidth;
    if (element.height !== deviceHeight) element.height = deviceHeight;
    // Offscreen text avoids synchronously resolving the editor's document
    // styles every time the visible time range moves.
    const backing = enhancePerformance && typeof window.OffscreenCanvas === "function"
      ? rulerBacking.current ??= new window.OffscreenCanvas(deviceWidth, deviceHeight)
      : undefined;
    if (backing) {
      if (backing.width !== deviceWidth) backing.width = deviceWidth;
      if (backing.height !== deviceHeight) backing.height = deviceHeight;
    }
    const context = backing?.getContext("2d") ?? output;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, width, RULER);
    const step = rulerStep(zoom);
    const minor = step / 5;
    const from = Math.floor(((scroll / zoom) * 1000) / minor) * minor;
    const to = ((scroll + width) / zoom) * 1000;
    context.font = "10px system-ui, sans-serif";
    context.textBaseline = "top";
    for (let ms = from; ms <= Math.min(to, duration); ms += minor) {
      const x = Math.round((ms / 1000) * zoom - scroll) + 0.5;
      const major = Math.abs(ms / step - Math.round(ms / step)) < 1e-6;
      context.fillStyle = major ? "#ffffff8c" : "#ffffff40";
      context.fillRect(x, major ? RULER - 12 : RULER - 5, 1, major ? 12 : 5);
      if (major) {
        context.fillStyle = "#ffffffb3";
        context.fillText(formatTime(Math.round(ms)), x + 3, 8);
      }
    }
    if (backing && context !== output) {
      output.clearRect(0, 0, deviceWidth, deviceHeight);
      output.drawImage(backing, 0, 0);
    }
  }, [zoom, scroll, width, duration, window, enhancePerformance]);

  useLayoutEffect(() => {
    if (playhead.current) playhead.current.style.transform = `translate3d(${(read() + offset) / 1000 * zoom}px, 0, 0)`;
  }, [zoom, offset, read]);

  const timeAt = (clientX: number) => {
    const box = area.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(box.width, clientX - box.left));
    return Math.max(0, Math.min(duration, ((scroll + x) / zoom) * 1000));
  };
  const scrub = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const up = (done: PointerEvent) => {
      window.removeEventListener("pointerup", up);
      onSeek(timeAt(done.clientX));
    };
    window.addEventListener("pointerup", up);
  };

  const grab = (event: React.PointerEvent, at: Cursor, edge: Drag["edge"]) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const from =
      lines[at.line]?.units[at.unit]?.[edge === "end" ? "end" : "start"];
    if (from === undefined) return;
    setDrag({ at, edge, from, x: event.clientX });
  };
  // Playback moves the playhead every frame; reading it through refs keeps
  // the drag listeners, and the edit in progress, alive while it plays.
  const dragging = useRef({ lines, zoom, read, offset, onLines });
  dragging.current = { lines, zoom, read, offset, onLines };
  useEffect(() => {
    if (!drag) return;
    let latest: CreatorLine[] | null = null;
    let moved = false;
    const move = (event: PointerEvent) => {
      const { lines, zoom, read, offset } = dragging.current;
      const position = read() + offset;
      const shift = event.clientX - drag.x;
      if (!moved && Math.abs(shift) < 3) return;
      moved = true;
      let time = drag.from + (shift / zoom) * 1000;
      if (
        !event.shiftKey &&
        Math.abs(((time - position) / 1000) * zoom) < SNAP_PX
      )
        time = position;
      // Alt drags the word or edge free of the syllable touching it.
      latest =
        drag.edge === "word"
          ? panUnit(lines, drag.at, time, event.altKey)
          : moveEdge(lines, drag.at, drag.edge, time, event.altKey);
      setPreview(latest);
    };
    const up = () => {
      const { lines, onLines } = dragging.current;
      if (latest && latest !== lines) onLines(latest);
      setDrag(null);
      setPreview(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag]);

  const shownLines = preview ?? lines;
  const ms = (time: number) => (time / 1000) * zoom;
  const fromMs = (scroll / zoom) * 1000;
  const toMs = ((scroll + width) / zoom) * 1000;
  const lanes = useMemo(() => vocalLanes(shownLines), [shownLines]);
  const bands = shownLines.flatMap((line, lineIndex) => {
    const chosen = lineIndex === cursor.line || picked.has(lineIndex);
    const span = everyLine || chosen ? lineSpan(line) : null;
    return span && span.end >= fromMs && span.start <= toMs
      ? [{ key: lineIndex, ...span, chosen, background: line.background }]
      : [];
  });
  const segments = shownLines.flatMap((line, lineIndex) => {
    const chosen = lineIndex === cursor.line || picked.has(lineIndex);
    if (!everyLine && !chosen) return [];
    const timed = line.units.some(
      (unit) => unit.start !== undefined && unit.end !== undefined,
    );
    const span = timed ? null : lineSpan(line);
    // Line-synced lyrics only time the line, so it shows as one block.
    if (span)
      return span.end > span.start && span.end >= fromMs && span.start <= toMs
        ? [
            {
              key: `${lineIndex}:line`,
              ...lanes[lineIndex],
              at: { line: lineIndex, unit: 0 },
              text: line.units
                .map((unit, index) =>
                  index && !unit.joined ? ` ${unit.text}` : unit.text,
                )
                .join(""),
              start: span.start,
              end: span.end,
              roman: line.romanization,
              chosen,
              current: false,
              whole: true,
            },
          ]
        : [];
    return line.units.flatMap((unit, unitIndex) =>
      unit.start === undefined ||
      unit.end === undefined ||
      unit.end < fromMs ||
      unit.start > toMs
        ? []
        : [
            {
              key: `${lineIndex}:${unitIndex}`,
              ...lanes[lineIndex],
              at: { line: lineIndex, unit: unitIndex },
              text: unit.text,
              start: unit.start,
              end: unit.end,
              roman: unit.roman,
              chosen,
              current: lineIndex === cursor.line && unitIndex === cursor.unit,
              whole: false,
            },
          ],
    );
  });

  const resize = (event: React.PointerEvent) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = spectrum.current?.offsetHeight ?? height;
    let next = startHeight;
    const move = (moved: PointerEvent) => {
      next = Math.round(
        Math.max(120, Math.min(560, startHeight + startY - moved.clientY)),
      );
      setHeight(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      setHeight(next);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  const hoverMs = hover ? ((scroll + hover.x) / zoom) * 1000 : 0;
  const plotHeight = Math.max(1, plotAreaHeight - RULER);
  const hoverBand = hover && hover.y > RULER ? Math.max(0, Math.min(1, 1 - (hover.y - RULER) / plotHeight)) : null;
  const hoverHz = !pitch && hoverBand !== null ? spectrumFrequency(hoverBand) : null;
  const hoverNote = pitch && hoverBand !== null ? NOTES[Math.min(pitchBands - 1, Math.floor(hoverBand * pitchBands))] : null;
  const gainFill = ((gain - 0.5) / 7.5) * 100;

  return (
    <section
      id={id}
      ref={spectrum}
      className={`ttml-spectrum${pitch ? " spotify-pitch" : ""}`}
      aria-label={liveCapture ? "Captured Spotify spectrogram" : pitch ? "Spotify pitch analysis" : "Spectrogram"}
      style={{ height }}
    >
      <div
        className="ttml-spectrum-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the spectrogram"
        onPointerDown={resize}
      />
      <div className="ttml-spectrum-side">
        <div className="ttml-spectrum-scale" style={{ top: RULER }}>
          {pitch ? NOTES.map((note, index) => (
            <span key={note} style={{ bottom: `${(index + 0.5) / pitchBands * 100}%` }}>{note}</span>
          )) : FREQUENCY_LABELS.map((hz) => (
            <span key={hz} style={{ bottom: `${spectrumFrequencyPosition(hz) * 100}%` }}>{hz < 1000 ? hz : `${hz / 1000}k`}</span>
          ))}
        </div>
        <label className="ttml-spectrum-gain" title={`Gain ${gain}×`}>
          <input
            type="range"
            aria-label="Spectrogram gain"
            min={0.5}
            max={8}
            step={0.5}
            value={gain}
            style={{ ["--fill" as string]: `${gainFill}%` }}
            onChange={(event) => setGain(Number(event.target.value))}
          />
          <output>{gain}×</output>
        </label>
      </div>
      <div
        ref={area}
        className="ttml-spectrum-main"
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          setHover({ x: event.clientX - box.left, y: event.clientY - box.top });
        }}
        onPointerLeave={() => setHover(null)}
        onContextMenu={(event) => event.preventDefault()}
      >
        <canvas
          ref={ruler}
          className="ttml-spectrum-ruler"
          role="slider"
          aria-label="Spectrogram position"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={Math.round(read() + offset)}
          onPointerDown={scrub}
        />
        <div className="ttml-spectrum-plot" onPointerDown={scrub}>
          <div
            className="ttml-spectrum-content"
            style={{
              width: Math.ceil(span(zoom)),
              transform: `translate3d(${-scroll}px, 0, 0)`,
            }}
          >
            {visible.map((tile) => (
              <Tile
                key={`${spectrumKey}:${tile.index}`}
                data={tile.data}
                columns={tile.columns}
                rows={tile.rows}
                left={tile.index * tilePx}
                width={tilePx}
                table={table}
                gain={gain}
                revision={tile.revision}
              />
            ))}
            {bands.map((band) => (
              <div
                key={band.key}
                className={`ttml-spectrum-line${band.chosen ? " chosen" : ""}${band.background ? " background" : ""}`}
                style={{
                  left: ms(band.start),
                  width: Math.max(1, ms(band.end) - ms(band.start)),
                }}
              />
            ))}
            {segments.map((segment) => (
              <div
                key={segment.key}
                className={`ttml-spectrum-word ${segment.kind}${segment.whole ? " whole" : ""}${segment.chosen ? " chosen" : ""}${segment.current ? " current" : ""}`}
                style={
                  {
                    left: ms(segment.start),
                    width: Math.max(1, ms(segment.end) - ms(segment.start)),
                    "--lane": segment.lane,
                  } as React.CSSProperties
                }
                title={`${segment.text} ${formatTime(segment.start)} – ${formatTime(segment.end)}`}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onCursor(segment.at);
                  if (!segment.whole) grab(event, segment.at, "word");
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onPlayUnit(segment.at);
                }}
              >
                <div className="ttml-spectrum-head">
                  {segment.roman && <small>{segment.roman}</small>}
                  <span>{segment.text}</span>
                </div>
                {!segment.whole && (
                  <>
                    <i
                      className="ttml-spectrum-edge start"
                      aria-label={`Move the start of ${segment.text}`}
                      onPointerDown={(event) =>
                        grab(event, segment.at, "start")
                      }
                    />
                    <i
                      className="ttml-spectrum-edge end"
                      aria-label={`Move the end of ${segment.text}`}
                      onPointerDown={(event) => grab(event, segment.at, "end")}
                    />
                  </>
                )}
              </div>
            ))}
            <div
              ref={playhead}
              className="ttml-spectrum-playhead"
            />
            {hover && !drag && (
              <div
                className="ttml-spectrum-hover"
                style={{ left: scroll + hover.x }}
              />
            )}
          </div>
          {!visible.length && (
            <p className="ttml-spectrum-empty">
              {liveCapture ? liveSpectrum.status === "live" ? "Play Spotify to fill this part of the spectrogram." : "No saved audio analysis in this part of the song."
                : failed === failureKey
                ? pitch ? "Spotify pitch analysis is unavailable for this track. Open a local audio file for the spectrogram." : "Couldn’t draw the spectrogram."
                : pitch ? "Loading Spotify pitch analysis…" : "Drawing the spectrogram…"}
            </p>
          )}
        </div>
        {(liveSpectrum.message || liveSpectrum.status !== "idle") && (
          <div className="ttml-spectrum-capture-status" role="status">
            {liveSpectrum.message || (liveSpectrum.status === "selecting" ? "Select this Spotify tab and share its audio." : "Sharing Spotify audio")}
          </div>
        )}
        {hover && !drag && (
          <div className="ttml-spectrum-tip" style={{ left: hover.x }}>
            {formatTime(Math.round(hoverMs))}
            {hoverHz !== null &&
              ` (${(hoverHz / 1000).toFixed(2)} kHz / ${noteName(hoverHz)})`}
            {hoverNote && ` (${hoverNote})`}
          </div>
        )}
      </div>
      <div className="ttml-spectrum-tools">
        {canShare && <button className={`ttml-spectrum-tool${liveSpectrum.status === "live" ? " on" : ""}${showIntro ? " guide-target" : ""}`}
          ref={shareButton} type="button" disabled={liveSpectrum.status === "selecting"}
          aria-label={liveSpectrum.status === "live" ? "Stop sharing Spotify audio" : "Share Spotify audio"}
          aria-describedby={showIntro ? introId : undefined}
          title={liveSpectrum.status === "live" ? "Stop sharing Spotify audio" : "Share Spotify audio and save a recording on this device"}
          onClick={() => {
            if (showIntro) setIntroSeen(true);
            if (liveSpectrum.status === "live") liveSpectrum.stop();
            else void liveSpectrum.start();
          }}>
          {liveSpectrum.status === "live" ? <Square size={13} /> : <AudioLines size={15} />}
        </button>}
        {showIntro && <div id={introId} className="ttml-spectrum-intro" ref={intro} popover="manual" aria-label="Live spectrogram guide">
          <strong>Live spectrogram</strong>
          <p>Click <b>Share Spotify audio</b>. {liveSpectrum.sharePrompt}</p>
          <p>Play the sections you want to capture. Click the same button to stop. The spectrogram stays in this Spotify client.</p>
          <p>To record the whole song, share before playing it from the start. Recorded audio stays on this device for slow replay.</p>
          <button type="button" onClick={() => {
            setIntroSeen(true);
            shareButton.current?.focus({ preventScroll: true });
          }}>Got it</button>
        </div>}
        <button
          className={`ttml-spectrum-tool${everyLine ? " on" : ""}`}
          aria-pressed={everyLine}
          aria-label="Show every line"
          title={everyLine ? "Showing every line" : "Showing the chosen lines"}
          onClick={() => setEveryLine(!everyLine)}
        >
          {everyLine ? <Eye size={15} /> : <EyeOff size={15} />}
        </button>
        <button
          className={`ttml-spectrum-tool${follow ? " on" : ""}`}
          aria-pressed={follow}
          aria-label="Follow playback"
          title="Keep the playhead in view while playing"
          onClick={() => setFollow(!follow)}
        >
          <ArrowRightToLine size={15} />
        </button>
        <div className="ttml-spectrum-settings">
          <button
            ref={settingsButton}
            type="button"
            className={`ttml-spectrum-tool${settings ? " on" : ""}`}
            aria-expanded={settings}
            aria-controls={settings ? colorsId : undefined}
            aria-label="Spectrogram colors"
            title="Spectrogram colors"
            onClick={() => setSettings(!settings)}
          >
            <Settings2 size={15} />
          </button>
          {settings && (
            <div
              id={colorsId}
              ref={colorsPanel}
              className="ttml-spectrum-menu"
              role="dialog"
              aria-label="Spectrogram colors"
              popover="auto"
              onToggle={(event) => {
                if (event.newState === "closed") setSettings(false);
              }}
            >
              <label className="ttml-palette-picker">
                <strong>Color palette</strong>
                <select value={palette} onChange={(event) => setPalette(event.currentTarget.value as Palette)}>
                  {PALETTES.map(each => <option key={each.id} value={each.id}>{each.name}</option>)}
                </select>
              </label>
              <div className="ttml-palette-gradient" style={{ background: paletteRamp }} aria-hidden="true" />
              {palette === "custom" ? <>
                <p>Position 0.0 is quietest and 1.0 is loudest.</p>
                <div className="ttml-palette-stops">
                  {customStops.map((stop, index) => <div key={index} className="ttml-palette-stop">
                    <input type="color" aria-label={`Color stop ${index + 1}`} value={stop.color}
                      onChange={(event) => updateColorStop(index, { color: event.currentTarget.value })} />
                    <input type="range" min="0" max="1" step="0.005" aria-label={`Position of color stop ${index + 1}`}
                      value={stop.position} onChange={(event) => updateColorStop(index, { position: event.currentTarget.valueAsNumber })} />
                    <input key={stop.position} type="number" min="0" max="1" step="0.001"
                      aria-label={`Exact position of color stop ${index + 1}`} defaultValue={stop.position}
                      onBlur={(event) => {
                        const value = event.currentTarget.valueAsNumber;
                        const position = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : stop.position;
                        event.currentTarget.value = String(position);
                        updateColorStop(index, { position });
                      }}
                      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
                    <button className="ttml-remove-color-stop" type="button" disabled={customStops.length <= 2}
                      aria-label={`Remove color stop ${index + 1}`}
                      onClick={() => setCustomStops(customStops.filter((_, at) => at !== index))}>
                      <Trash2 size={14} /> Remove
                    </button>
                  </div>)}
                </div>
                <div className="ttml-palette-actions">
                  <button type="button" disabled={customStops.length >= MAX_STOPS} onClick={addColorStop}><Plus size={15} /> Add color stop</button>
                  <button type="button" onClick={() => setCustomStops(DEFAULT_STOPS)}>Reset</button>
                </div>
              </> : <button type="button" onClick={() => {
                setCustomStops(paletteStops(palette, customStops));
                setPalette("custom");
              }}>Customize this palette</button>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
