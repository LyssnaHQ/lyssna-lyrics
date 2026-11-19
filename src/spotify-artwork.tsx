import { useEffect, useMemo, useRef, useState } from "react";
import type { AudioSegment, Host } from "./host";
import { LyricsVisualiser } from "./lyssna/lyrics-visualiser";

export const nowPlayingSelector = 'aside.NowPlayingView, .main-nowPlayingView-section, .now-playing-view';

export function useCanvas(trackId: string | undefined, enabled: boolean) {
  const [canvas, setCanvas] = useState<{ trackId: string; url: string }>();
  useEffect(() => {
    if (!enabled || !trackId) return;
    const find = () => {
      const panel = document.querySelector(nowPlayingSelector);
      const video = panel?.querySelector<HTMLVideoElement>('.main-nowPlayingView-canvasVisualEnhancement video, [data-canvas-surface] video, [data-testid="track-visual-enhancement"] video');
      const src = video?.currentSrc || video?.src;
      if (!src) return;
      try {
        const url = new URL(src);
        if (url.protocol === "https:" && ["canvaz.scdn.co", "video-fa.scdn.co"].includes(url.hostname)) {
          setCanvas((old) => old?.url === url.href ? old : { trackId, url: url.href });
        }
      } catch { /* Spotify has no usable Canvas URL yet. */ }
    };
    find();
    const timer = window.setInterval(find, 500);
    return () => clearInterval(timer);
  }, [trackId, enabled]);
  return enabled && canvas?.trackId === trackId ? canvas?.url : undefined;
}

export function CanvasArtwork({ src, cover, playing }: { src: string; cover: string; playing: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  useEffect(() => {
    if (playing) void ref.current?.play().catch(() => {});
    else ref.current?.pause();
  }, [src, playing, failed]);
  return failed ? <img className="cover" src={cover} alt="" /> : <video ref={ref} className="lyssna-canvas" src={src} data-canvas-video=""
    poster={cover} muted loop playsInline onError={() => setFailed(true)} aria-label="Spotify Canvas" />;
}

export function SpotifyVisualiser({ host, trackId, playing, opacity }: { host: Host; trackId: string; playing: boolean; opacity: number }) {
  const [segments, setSegments] = useState<AudioSegment[]>([]);
  useEffect(() => {
    let active = true;
    void host.analysis(trackId)?.then((result) => { if (active) setSegments(result?.segments ?? []); }).catch(() => {});
    return () => { active = false; };
  }, [host, trackId]);

  const spectrum = useMemo(() => () => {
    const time = host.position() / 1000;
    let low = 0;
    let high = segments.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (segments[middle].start <= time) low = middle + 1;
      else high = middle;
    }
    const segment = segments[low - 1];
    if (!segment?.pitches?.length) return [];
    const level = Math.max(0.15, Math.min(1, (segment.loudness_max + 30) / 30));
    return segment.pitches.map((pitch) => Math.round(255 * level * pitch));
  }, [host, segments]);

  return segments.length > 0 && <LyricsVisualiser playing={playing} opacity={opacity} spectrum={spectrum} />;
}
