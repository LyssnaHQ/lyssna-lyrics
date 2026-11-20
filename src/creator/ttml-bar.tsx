import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Gauge, Pause, Play } from "lucide-react";
import { useCreatorEnvironment } from "./environment";
import { formatTime } from "./ttml-creator-model";

export function CreatorSpeed({ speed, min, max, disabled, onChange }: {
  speed: number; min: number; max: number; disabled: boolean; onChange(value: number): void;
}) {
  return <label className="lyssna-editor-speed" title={disabled ? "Share Spotify audio or open a local file to change speed" : "Playback speed"}>
    <Gauge size={15} aria-hidden="true" />
    <input type="range" aria-label="Playback speed" min={min} max={max} step={0.05}
      value={speed} disabled={disabled} onChange={(event) => onChange(event.currentTarget.valueAsNumber)} />
    <output>{speed.toFixed(2)}×</output>
  </label>;
}

export function CreatorPlay({ playing, onToggle }: { playing: boolean; onToggle(): void }) {
  return <button type="button" className="ttml-bar-play" onClick={onToggle} aria-label={playing ? "Pause" : "Play"}>
    {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
  </button>;
}

export function CreatorSpectrogramToggle({ open, id, onToggle }: { open: boolean; id: string; onToggle(): void }) {
  return <button type="button" className="lyssna-playbar-view-button" aria-label="Spectrogram" aria-expanded={open}
    aria-controls={open ? id : undefined} title={open ? "Hide the spectrogram" : "Show the spectrogram"} onClick={onToggle}>
    {open ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
  </button>;
}

export interface BarSpan {
  start: number;
  end: number;
  current: boolean;
}

export function TtmlBar({ position, duration, peaks, spans, onSeek }: {
  position: number; duration: number; peaks: Uint8Array | null; spans: BarSpan[]; onSeek(ms: number): void;
}) {
  const { view: window } = useCreatorEnvironment();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const shown = dragging ?? position;
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context || !width) return;
    const scale = window.devicePixelRatio;
    const height = element.clientHeight;
    // Resizing the backing store every frame is costly; only on change.
    if (element.width !== Math.round(width * scale))
      element.width = Math.round(width * scale);
    if (element.height !== Math.round(height * scale))
      element.height = Math.round(height * scale);
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, width, height);
    const span = Math.max(1, duration);
    const x = (ms: number) => (Math.min(span, Math.max(0, ms)) / span) * width;
    // A filled envelope with the played part tinted and the current line
    // shaded, after the AMLL TTML Tool's timeline.
    const played = x(shown);
    const middle = height / 2;
    const reach = middle - 4;
    const columns = Math.ceil(width);
    const level = new Float32Array(columns + 1);
    for (let left = 0; left <= columns; left++) {
      let loud = 0;
      if (peaks?.length) {
        const from = Math.floor((left / width) * peaks.length);
        const to = Math.max(
          from + 1,
          Math.floor(((left + 1) / width) * peaks.length),
        );
        for (let index = from; index < to && index < peaks.length; index++)
          loud = Math.max(loud, peaks[index] / 255);
      }
      level[left] = loud;
    }
    context.beginPath();
    context.moveTo(0, middle);
    for (let left = 0; left <= columns; left++) {
      const near =
        (level[Math.max(0, left - 1)] +
          level[left] * 2 +
          level[Math.min(columns, left + 1)]) /
        4;
      context.lineTo(left, middle - Math.max(0.5, near * reach));
    }
    for (let left = columns; left >= 0; left--) {
      const near =
        (level[Math.max(0, left - 1)] +
          level[left] * 2 +
          level[Math.min(columns, left + 1)]) /
        4;
      context.lineTo(left, middle + Math.max(0.5, near * reach));
    }
    context.closePath();
    context.fillStyle = "#1ed76066";
    context.fill();
    context.fillStyle = "#1ed7601f";
    context.fillRect(0, 0, played, height);
    for (const line of spans) {
      if (!line.current) continue;
      const left = x(line.start);
      const right = Math.max(left + 1, x(line.end));
      context.fillStyle = "#1ed76033";
      context.fillRect(left, 0, right - left, height);
      context.fillStyle = "#1ed76099";
      context.fillRect(left, 0, 1, height);
      context.fillRect(right - 1, 0, 1, height);
    }
    if (hover !== null && dragging === null) {
      context.fillStyle = "#1ed760a6";
      context.fillRect(Math.round(hover), 0, 1, height);
      const label = formatTime((hover / width) * span);
      context.font = '11px "Cascadia Mono", Consolas, monospace';
      const box = context.measureText(label).width + 10;
      const at = hover + box + 4 > width ? hover - box - 4 : hover + 4;
      context.fillStyle = "#000000b3";
      context.beginPath();
      context.roundRect(at, 4, box, 16, 4);
      context.fill();
      context.fillStyle = "#fff";
      context.textBaseline = "middle";
      context.fillText(label, at + 5, 12.5);
    }
    context.fillStyle = "#1ed760";
    context.fillRect(Math.round(played) - 1, 0, 2, height);
  }, [width, peaks, spans, shown, duration, hover, dragging]);

  const timeAt = (clientX: number) => {
    const box = canvas.current!.getBoundingClientRect();
    return (
      (Math.min(box.width, Math.max(0, clientX - box.left)) / box.width) *
      duration
    );
  };
  return (
    <div className="ttml-bar">
      <span className="ttml-bar-time">{formatTime(shown)}</span>
      <canvas
        ref={canvas}
        className={`ttml-bar-wave${peaks ? "" : " loading"}`}
        role="slider"
        aria-label="Song position"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={Math.round(shown)}
        tabIndex={0}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(timeAt(event.clientX));
        }}
        onPointerMove={(event) => {
          setHover(
            event.clientX - event.currentTarget.getBoundingClientRect().left,
          );
          if (dragging !== null) setDragging(timeAt(event.clientX));
        }}
        onPointerLeave={() => setHover(null)}
        onPointerUp={(event) => {
          if (dragging === null) return;
          onSeek(timeAt(event.clientX));
          setDragging(null);
        }}
        onPointerCancel={() => setDragging(null)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          event.stopPropagation();
          onSeek(position + (event.key === "ArrowLeft" ? -3000 : 3000));
        }}
      />
      <span className="ttml-bar-time">{formatTime(duration)}</span>
    </div>
  );
}
