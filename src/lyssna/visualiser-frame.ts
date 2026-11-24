import type { Body, Rect } from "./space-gravity";

export const VISUALISER_BARS = 48;
export const VISUALISER_BAR_FILL = 0.62;

export function spectrumBars(bars: Uint8Array, levels: Uint16Array, columns: number, column: number) {
  const rows = levels.length / columns;
  for (let bar = 0; bar < bars.length; bar++) {
    const first = rows - Math.floor((bar + 1) * rows / bars.length);
    const last = rows - Math.floor(bar * rows / bars.length);
    let peak = 0;
    for (let row = first; row < last; row++) peak = Math.max(peak, levels[row * columns + column]);
    bars[bar] = Math.min(255, Math.round(peak * 255 / 5400));
  }
  return bars;
}

export type VisualiserFrame = {
  canvas: HTMLCanvasElement;
  heights: Float32Array;
  rise: Float32Array;
};

/** Collide the word's rotated box with the painted part of each nearby bar. */
export function collideWithVisualiser(body: Body, frame: VisualiserFrame, area: Rect) {
  const width = area.right - area.left;
  const height = area.bottom - area.top;
  if (width <= 0 || height <= 0 || frame.canvas.width <= 0) return;
  const angle = body.angle * Math.PI / 180;
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  const halfWidth = body.width * body.scale / 2, halfHeight = body.height * body.scale / 2;
  const extentY = Math.abs(sine) * halfWidth + Math.abs(cosine) * halfHeight;
  const bottom = body.y + extentY;
  if (bottom <= area.top || body.y - extentY >= area.bottom) return;

  const extentX = Math.abs(cosine) * halfWidth + Math.abs(sine) * halfHeight;
  const slot = width / frame.heights.length;
  const first = Math.max(0, Math.floor((body.x - extentX - area.left) / slot));
  const last = Math.min(frame.heights.length - 1, Math.floor((body.x + extentX - area.left) / slot));
  const canvasSlot = frame.canvas.width / frame.heights.length;
  const canvasBar = Math.max(1, canvasSlot * VISUALISER_BAR_FILL);
  const pixelScale = width / frame.canvas.width;
  if (first > last) return;
  const corners = [
    [-halfWidth, -halfHeight], [halfWidth, -halfHeight],
    [halfWidth, halfHeight], [-halfWidth, halfHeight],
  ].map(([x, y]) => ({ x: body.x + x * cosine - y * sine, y: body.y + x * sine + y * cosine }));

  let overlap = 0;
  let contactX = 0;
  let contacts = 0;
  let contactSpeed = 0;
  for (let index = first; index <= last; index++) {
    if (frame.heights[index] <= 0) continue;
    const top = area.bottom - frame.heights[index] * height;
    if (top >= bottom) continue;
    const left = area.left + Math.round(index * canvasSlot + (canvasSlot - canvasBar) / 2) * pixelScale;
    const right = left + Math.round(canvasBar) * pixelScale;
    let foot = -Infinity;
    let footX = Math.max(left, Math.min(right, body.x));
    for (let corner = 0; corner < corners.length; corner++) {
      const a = corners[corner], b = corners[(corner + 1) % corners.length];
      if (a.x >= left && a.x <= right && a.y > foot) {
        foot = a.y;
        if (sine !== 0) footX = a.x;
      }
      for (const edge of [left, right]) {
        if (edge <= Math.min(a.x, b.x) || edge >= Math.max(a.x, b.x)) continue;
        const y = a.y + (b.y - a.y) * (edge - a.x) / (b.x - a.x);
        if (y > foot) {
          foot = y;
          if (sine !== 0) footX = edge;
        }
      }
    }
    const penetration = foot - top;
    if (penetration <= 0) continue;
    if (penetration > overlap + 0.5 || contacts === 0) {
      overlap = penetration;
      contactX = footX;
      contacts = 1;
      contactSpeed = frame.rise[index] * height;
    } else if (penetration >= overlap - 0.5) {
      overlap = Math.max(overlap, penetration);
      contactX += footX;
      contacts++;
      contactSpeed = Math.max(contactSpeed, frame.rise[index] * height);
    }
  }
  if (overlap <= 0) return;
  const offset = Math.max(-1, Math.min(1, (body.x - contactX / contacts) / Math.max(extentX, slot)));
  const approach = Math.max(0, body.vy + contactSpeed);
  const launch = Math.min(360, 62 + approach * 0.52 + overlap * 0.5);
  body.y -= overlap + 0.5;
  body.vy = Math.min(body.vy, -launch);
  body.vx += offset * launch * 0.38;
  body.spin = Math.max(-138, Math.min(138, body.spin + offset * launch * 0.45));
}
