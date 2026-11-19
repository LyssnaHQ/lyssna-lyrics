import { useEffect, useState } from "react";
import type { Host } from "./host";
import { frameDue } from "./lyssna/frame-cap";

export function usePlayback(host: Host) {
  const [track, setTrack] = useState(host.track);
  const [playing, setPlaying] = useState(host.playing);
  useEffect(() => {
    const update = () => {
      const next = host.track();
      setTrack((old) => next?.id === old?.id && next?.cover === old?.cover && next?.artistUri === old?.artistUri ? old : next);
      setPlaying(host.playing());
    };
    const unwatch = host.watch(update);
    update();
    return unwatch;
  }, [host]);
  return { track, playing };
}

export function usePosition(host: Host, playing: boolean, view: Window = window) {
  const [position, setPosition] = useState(host.position);
  useEffect(() => {
    const update = () => setPosition(host.position());
    const unwatch = host.watch(update, true);
    update();
    if (!playing) return unwatch;
    let frame = 0;
    let last = 0;
    function tick(now: number) {
      if (frameDue(last, now)) {
        last = now;
        update();
      }
      frame = view.requestAnimationFrame(tick);
    }
    frame = view.requestAnimationFrame(tick);
    return () => { view.cancelAnimationFrame(frame); unwatch(); };
  }, [host, playing, view]);
  return position;
}

export function clock(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
