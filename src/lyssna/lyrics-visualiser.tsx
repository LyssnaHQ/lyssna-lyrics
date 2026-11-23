import { useEffect, useRef, type RefObject } from "react";
import { VISUALISER_BARS, VISUALISER_BAR_FILL, type VisualiserFrame } from "./visualiser-frame";

/** Frequency bars behind the lyrics, following what this computer plays and
 * tinted by the cover colour. Spectrum data is only computed while this
 * polls. */
export function LyricsVisualiser({
  playing,
  opacity,
  spectrum,
  motion,
}: {
  playing: boolean;
  opacity: number;
  spectrum: () => Uint8Array | undefined;
  motion: RefObject<VisualiserFrame | null>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef(playing);
  live.current = playing;
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    const view = element?.ownerDocument.defaultView;
    if (!view || !element || !context) return;
    const targets = new Float32Array(VISUALISER_BARS);
    const shown = new Float32Array(VISUALISER_BARS);
    const peaks = new Float32Array(VISUALISER_BARS).fill(0.6);
    const surface = { canvas: element, heights: new Float32Array(VISUALISER_BARS), rise: new Float32Array(VISUALISER_BARS) };
    motion.current = surface;
    let sampled = -Infinity;
    function poll() {
      const sample = live.current ? spectrum() : undefined;
      for (let index = 0; index < targets.length; index++) {
        const level = (sample?.[index] ?? 0) / 255;
        peaks[index] = Math.max(level, peaks[index] * 0.997, 0.6);
        targets[index] = Math.min(1, Math.max(0, (level / peaks[index] - 0.25) / 0.75));
      }
    }
    let colour = "";
    let checked = 0;
    let lit = false;
    let drawnAt = 0;
    let cssWidth = 0;
    let cssHeight = 0;
    // Reading clientWidth during animation forces pending lyric styles to flush.
    const observer = new ResizeObserver(([entry]) => {
      cssWidth = entry.contentRect.width;
      cssHeight = entry.contentRect.height;
    });
    observer.observe(element);
    let frame = view.requestAnimationFrame(function draw(time) {
      frame = view.requestAnimationFrame(draw);
      if (time - sampled >= 32) { sampled = time; poll(); }
      if (!lit && !targets.some((target) => target > 0)) return;
      const ratio = Math.min(2, view.devicePixelRatio || 1);
      const width = Math.round(cssWidth * ratio);
      const height = Math.round(cssHeight * ratio);
      if (!width || !height) return;
      const resized = element.width !== width || element.height !== height;
      if (resized) {
        element.width = width;
        element.height = height;
      }
      if (!colour || time - checked > 500) {
        colour = view.getComputedStyle(element).color;
        checked = time;
      }
      context.clearRect(0, 0, width, height);
      context.fillStyle = colour;
      const slot = width / shown.length;
      const bar = Math.max(1, slot * VISUALISER_BAR_FILL);
      const seconds = drawnAt && !resized ? Math.max(0.004, (time - drawnAt) / 1000) : 0;
      drawnAt = time;
      context.beginPath();
      lit = false;
      shown.forEach((value, index) => {
        const gap = targets[index] - value;
        shown[index] = value + gap * (gap > 0 ? 0.5 : 0.12);
        const tall = Math.round(shown[index] * height);
        const fraction = tall / height;
        surface.rise[index] = seconds ? (fraction - surface.heights[index]) / seconds : 0;
        surface.heights[index] = fraction;
        lit ||= tall > 0;
        if (tall < 1) return;
        const wide = Math.round(bar);
        const round = Math.min(wide * 0.3, 4 * ratio, tall / 2);
        context.roundRect(
          Math.round(index * slot + (slot - bar) / 2),
          height - tall,
          wide,
          tall,
          [round, round, 0, 0],
        );
      });
      context.fill();
    });
    return () => {
      observer.disconnect();
      view.cancelAnimationFrame(frame);
      if (motion.current === surface) motion.current = null;
      context.clearRect(0, 0, element.width, element.height);
    };
  }, [spectrum, motion]);
  return (
    <canvas
      ref={canvas}
      className="lyrics-visualiser"
      aria-hidden="true"
      style={{ opacity: opacity / 100 }}
    />
  );
}
