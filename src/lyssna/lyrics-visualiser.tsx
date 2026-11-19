import { useEffect, useRef } from "react";

/** Frequency bars behind the lyrics, following what this computer plays and
 * tinted by the cover colour. Spectrum data is only computed while this
 * polls. */
export function LyricsVisualiser({
  playing,
  opacity,
  spectrum,
}: {
  playing: boolean;
  opacity: number;
  spectrum: () => number[];
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef(playing);
  live.current = playing;
  useEffect(() => {
    let targets: number[] = [];
    let shown: number[] = [];
    let peaks: number[] = [];
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const bytes = spectrum();
        if (Array.isArray(bytes)) {
          if (peaks.length !== bytes.length) {
            peaks = bytes.map(() => 0.6);
            shown = bytes.map(() => 0);
          }
          targets = bytes.map((byte, index) => {
            const level = live.current ? byte / 255 : 0;
            // Scaled to each bar's recent peak, as the level bars are, so
            // loud, compressed songs still show their beats.
            peaks[index] = Math.max(level, peaks[index] * 0.997, 0.6);
            return Math.min(
              1,
              Math.max(0, (level / peaks[index] - 0.25) / 0.75),
            );
          });
        }
      } catch {
        // Not running natively; the bars settle.
        targets = targets.map(() => 0);
      }
      if (!stopped) timer = setTimeout(poll, 33);
    };
    void poll();
    let colour = "";
    let checked = 0;
    let frame = requestAnimationFrame(function draw(time) {
      const element = canvas.current;
      if (element) {
        const ratio = window.devicePixelRatio || 1;
        const width = Math.round(element.clientWidth * ratio);
        const height = Math.round(element.clientHeight * ratio);
        if (element.width !== width || element.height !== height) {
          element.width = width;
          element.height = height;
        }
        // The cover colour changes with the song, not every frame.
        if (!colour || time - checked > 500) {
          colour = getComputedStyle(element).color;
          checked = time;
        }
        const context = element.getContext("2d");
        if (context && shown.length) {
          context.clearRect(0, 0, width, height);
          context.fillStyle = colour;
          const slot = width / shown.length;
          const bar = Math.max(1, slot * 0.62);
          shown.forEach((value, index) => {
            const gap = (targets[index] ?? 0) - value;
            shown[index] = value + gap * (gap > 0 ? 0.5 : 0.12);
            const tall = Math.round(shown[index] * height);
            if (tall < 1) return;
            const wide = Math.round(bar);
            const round = Math.min(wide * 0.3, 4 * ratio, tall / 2);
            context.beginPath();
            context.roundRect(
              Math.round(index * slot + (slot - bar) / 2),
              height - tall,
              wide,
              tall,
              [round, round, 0, 0],
            );
            context.fill();
          });
        }
      }
      frame = requestAnimationFrame(draw);
    });
    return () => {
      stopped = true;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [spectrum]);
  return (
    <canvas
      ref={canvas}
      className="lyrics-visualiser"
      aria-hidden="true"
      style={{ opacity: opacity / 100 }}
    />
  );
}
