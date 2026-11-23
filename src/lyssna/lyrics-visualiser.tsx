import { useEffect, useRef, type RefObject } from "react";
import { VISUALISER_BARS, type VisualiserFrame } from "./visualiser-frame";

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
  spectrum: () => { bars: Uint8Array; beat: number } | undefined;
  motion: RefObject<VisualiserFrame>;
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
    let envelope = 0;
    let lastImpact = -Infinity;
    let sampled = -Infinity;
    function poll(now: number) {
      const sample = live.current ? spectrum() : undefined;
      let energy = 0;
      for (let index = 0; index < targets.length; index++) {
        const level = (sample?.bars[index] ?? 0) / 255;
        peaks[index] = Math.max(level, peaks[index] * 0.997, 0.6);
        targets[index] = Math.min(1, Math.max(0, (level / peaks[index] - 0.25) / 0.75));
        if (index < 12) energy += targets[index] / 12;
      }
      const rise = energy - envelope;
      envelope += rise * (rise > 0 ? 0.4 : 0.15);
      const impact = Math.max(rise * 2.4, (sample?.beat ?? 0) * energy * 1.4);
      if (impact > 0.2 && now - lastImpact > 155) {
        motion.current.impact = Math.min(1, impact);
        motion.current.pulse++;
        lastImpact = now;
      }
    }
    let colour = "";
    let checked = 0;
    let lit = false;
    let frame = view.requestAnimationFrame(function draw(time) {
      frame = view.requestAnimationFrame(draw);
      if (time - sampled >= 32) { sampled = time; poll(time); }
      if (!lit && !targets.some((target) => target > 0)) return;
      const ratio = Math.min(2, view.devicePixelRatio || 1);
      const width = Math.round(element.clientWidth * ratio);
      const height = Math.round(element.clientHeight * ratio);
      if (element.width !== width || element.height !== height) {
        element.width = width;
        element.height = height;
      }
      if (!width || !height) return;
      if (!colour || time - checked > 500) {
        colour = view.getComputedStyle(element).color;
        checked = time;
      }
      context.clearRect(0, 0, width, height);
      context.fillStyle = colour;
      const slot = width / shown.length;
      const bar = Math.max(1, slot * 0.62);
      context.beginPath();
      lit = false;
      shown.forEach((value, index) => {
        const gap = targets[index] - value;
        shown[index] = value + gap * (gap > 0 ? 0.5 : 0.12);
        const tall = Math.round(shown[index] * height);
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
      view.cancelAnimationFrame(frame);
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
