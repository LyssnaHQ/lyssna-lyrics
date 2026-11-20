import { useEffect, useState } from "react";
import type { Host } from "./host";
import { frameDue } from "./lyssna/frame-cap";

export function usePlayback(host: Host, watchNarration = false) {
  const [track, setTrack] = useState(host.track);
  const [playing, setPlaying] = useState(host.playing);
  const [narrating, setNarrating] = useState(() => watchNarration && host.djNarrating());
  useEffect(() => {
    const update = () => {
      const next = host.track();
      setTrack((old) => next?.id === old?.id && next?.cover === old?.cover &&
        next?.artistUri === old?.artistUri && next?.year === old?.year &&
        next?.isrc === old?.isrc && next?.albumUri === old?.albumUri && next?.albumUpc === old?.albumUpc ? old : next);
      setPlaying(host.playing());
      if (watchNarration) setNarrating(host.djNarrating());
    };
    const unwatch = watchNarration ? host.watchControls(update) : host.watch(update);
    update();
    return unwatch;
  }, [host, watchNarration]);
  return { track: narrating ? null : track, playing, narrating };
}

export function usePosition(host: Host, playing: boolean, view: Window = window, read = host.position) {
  const [position, setPosition] = useState(read);
  useEffect(() => {
    const update = () => setPosition(read());
    // Spicetify's progress event only ticks during playback. A paused seek
    // still changes the underlying player state.
    const unwatch = playing ? host.watch(update, true) : host.watchControls(update);
    update();
    if (!playing) {
      if (read === host.position) return unwatch;
      const timer = view.setInterval(update, 100);
      return () => { view.clearInterval(timer); unwatch(); };
    }
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
  }, [host, playing, view, read]);
  return position;
}

export function usePlaybackControls(host: Host, trackId?: string, includeDJ = false) {
  const read = () => ({
    liked: !!trackId && host.liked(),
    shuffle: host.shuffle(),
    repeat: host.repeat(),
    canJumpDJ: includeDJ && host.canJumpDJ(),
  });
  const [controls, setControls] = useState(read);
  function update() {
    const next = read();
    setControls((old) => old.liked === next.liked && old.shuffle === next.shuffle &&
      old.repeat === next.repeat && old.canJumpDJ === next.canJumpDJ ? old : next);
  }
  useEffect(() => {
    const unwatch = host.watchControls(update);
    update();
    return unwatch;
  }, [host, trackId, includeDJ]);

  function activate(operation: () => unknown) {
    return async () => {
      try { await operation(); }
      catch (error) { console.warn("[Lyssna Lyrics] Playback control failed", error); }
      finally { update(); }
    };
  }
  const cycleRepeat = () => {
    const mode = host.repeat();
    return host.setRepeat(mode === "off" ? "context" : mode === "context" ? "track" : "off");
  };
  return { ...controls, activate, cycleRepeat };
}

export function clock(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
