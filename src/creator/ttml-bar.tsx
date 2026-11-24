import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Gauge, Headphones, Pause, Play } from "lucide-react";
import { useCreatorClock, useCreatorEnvironment, type RecordingStatus } from "./environment";
import { RecordingDetails } from "./recording-meter";
import { formatTime } from "./ttml-creator-model";
import type { Track } from "./types";

export function CreatorSpeed({ speed, min, max, disabled, onChange, openAudio, showAudioPicker = true }: {
  speed: number; min: number; max: number; disabled: boolean; onChange(value: number): void; openAudio?: () => void;
  showAudioPicker?: boolean;
}) {
  return <div className="lyssna-editor-audio-controls">
    <label className="lyssna-editor-speed" title={disabled ? "Share Spotify audio or open a local file to change speed" : "Playback speed"}>
      <Gauge size={15} aria-hidden="true" />
      <input type="range" aria-label="Playback speed" min={min} max={max} step={0.05}
        value={speed} disabled={disabled}
        style={{ ["--range" as string]: `${((speed - min) / (max - min)) * 100}%` }}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
        onDoubleClick={() => onChange(1)}
        onPointerUp={(event) => event.currentTarget.blur()} />
      <output>{speed.toFixed(2)}×</output>
    </label>
    {showAudioPicker && <button type="button" className="lyssna-playbar-view-button" aria-label="Open local audio"
      title="Open local audio for speed and spectrogram" disabled={!openAudio} onClick={openAudio}>
      <Headphones size={17} />
    </button>}
  </div>;
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

export function TtmlBar({ playing, offset, duration, peaks, spans, onSeek, recording, track }: {
  playing: boolean; offset: number; duration: number; peaks: Uint8Array | null; spans: BarSpan[]; onSeek(ms: number): void;
  recording?: RecordingStatus;
  track: Track;
}) {
  const { view: window, manageStoredData } = useCreatorEnvironment();
  const position = useCreatorClock(playing, offset);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [{ width, height }, setSize] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const shown = dragging ?? position;
  // Keep the waveform geometry independent of playhead and hover updates.
  const envelope = useMemo(() => {
    if (!width || !height) return;
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
    const path = new Path2D();
    path.moveTo(0, middle);
    for (let left = 0; left <= columns; left++) {
      const near =
        (level[Math.max(0, left - 1)] +
          level[left] * 2 +
          level[Math.min(columns, left + 1)]) /
        4;
      path.lineTo(left, middle - Math.max(0.5, near * reach));
    }
    for (let left = columns; left >= 0; left--) {
      const near =
        (level[Math.max(0, left - 1)] +
          level[left] * 2 +
          level[Math.min(columns, left + 1)]) /
        4;
      path.lineTo(left, middle + Math.max(0.5, near * reach));
    }
    path.closePath();
    return path;
  }, [width, height, peaks]);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context || !envelope) return;
    const scale = window.devicePixelRatio;
    if (element.width !== Math.round(width * scale))
      element.width = Math.round(width * scale);
    if (element.height !== Math.round(height * scale))
      element.height = Math.round(height * scale);
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, width, height);
    const span = Math.max(1, duration);
    const x = (ms: number) => (Math.min(span, Math.max(0, ms)) / span) * width;
    const played = x(shown);
    context.fillStyle = "#1ed76066";
    context.fill(envelope);
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
  }, [width, height, envelope, spans, shown, duration, hover, dragging, window]);

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
      {recording && <RecordingDetails view={window} track={{ uri: track.uri, name: track.name,
        artists: track.artists.map(({ name }) => name).join(", "), cover: track.album.images.find(({ url }) => url)?.url }}
        manageStoredData={manageStoredData} {...recording} />}
    </div>
  );
}
