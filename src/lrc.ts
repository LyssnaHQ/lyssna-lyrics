import type { Line, Lyrics } from "./lyssna/types";

function line(text: string, start_ms = 0, end_ms = 0): Line {
  return { text, start_ms, end_ms, words: [], translation: "", romanization: "", background: false, opposite: false };
}

export function fromLrc(source: string, synced: string, plain: string, duration: number): Lyrics | undefined {
  const offset = Number(/^\[offset:([+-]?\d+)\]/im.exec(synced)?.[1] ?? 0);
  const timed = synced.split(/\r?\n/).flatMap((raw) => {
    const tags = [...raw.matchAll(/\[(\d+):(\d{2})(?:\.(\d+))?\]/g)];
    const text = raw.replace(/^(?:\[\d+:\d{2}(?:\.\d+)?\])+/g, "").trim();
    if (!text) return [];
    return tags.map((tag) => {
      const start = (60 * Number(tag[1]) + Number(tag[2]) + Number(`0.${tag[3] ?? "0"}`)) * 1000;
      return line(text, Math.max(0, Math.round(start + offset)));
    });
  }).sort((left, right) => left.start_ms - right.start_ms);
  if (timed.length) {
    timed.forEach((item, index) => {
      item.end_ms = timed[index + 1]?.start_ms ?? (duration > item.start_ms ? duration : item.start_ms + 5_000);
    });
    return { source, lines: timed, synced: true, instrumental: false };
  }
  const lines = plain.split(/\r?\n/).map((text) => text.trim()).filter(Boolean).map((text) => line(text));
  if (lines.length) return { source, lines, synced: false, instrumental: false };
}
