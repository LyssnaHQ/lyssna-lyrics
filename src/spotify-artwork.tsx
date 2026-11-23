import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { CanvasInfo, Host } from "./host";
import { LyricsVisualiser } from "./lyssna/lyrics-visualiser";
import { VISUALISER_BARS, type VisualiserFrame } from "./lyssna/visualiser-frame";
import { playCanvasMedia } from "./canvas-media";
import type { SpotifyCapture } from "./creator/spotify-capture";

export function useCanvas(host: Host, trackId: string | undefined, enabled: boolean) {
  const [canvas, setCanvas] = useState<{ trackId: string; info: CanvasInfo }>();
  useEffect(() => {
    if (!enabled || !trackId) return;
    let active = true;
    let timer: number | undefined;
    async function lookup(retry: boolean) {
      const info = await host.trackCanvas(trackId!);
      if (!active) return;
      if (info && (!info.type || /^VIDEO(?:_|$)/i.test(info.type)) && (info.fileId || canvasUrl(info.url))) {
        setCanvas({ trackId: trackId!, info });
      } else if (info === undefined && retry) {
        timer = window.setTimeout(() => void lookup(false), 1_500);
      } else {
        setCanvas((old) => old?.trackId === trackId ? undefined : old);
      }
    }
    void lookup(true);
    return () => { active = false; window.clearTimeout(timer); };
  }, [host, trackId, enabled]);
  return enabled && canvas?.trackId === trackId ? canvas?.info : undefined;
}

function canvasUrl(value?: string) {
  try {
    const url = new URL(value ?? "");
    if (url.protocol === "https:" && /\.(?:scdn\.co|spotifycdn\.(?:com|net))$/i.test(url.hostname)) return url.href;
  } catch { /* Keep the cover when Spotify has no usable Canvas URL. */ }
}

export function CanvasArtwork({ info, cover, playing, onUnavailable, onVideo, heldFrame }: {
  info: CanvasInfo; cover: string; playing: boolean; onUnavailable(info: CanvasInfo): void;
  onVideo(video: HTMLVideoElement | null): void; heldFrame?: number;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  function syncFrame(video: HTMLVideoElement) {
    if (heldFrame !== undefined) {
      video.pause();
      if (Number.isFinite(video.duration)) {
        const target = Math.min(heldFrame, Math.max(0, video.duration - 0.001));
        if (Math.abs(video.currentTime - target) > 0.001) video.currentTime = target;
      }
    } else if (playing) void video.play().catch(() => {});
    else video.pause();
  }
  const attach = useCallback((video: HTMLVideoElement | null) => {
    ref.current = video;
    onVideo(video);
  }, [onVideo]);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const controller = new AbortController();
    const direct = canvasUrl(info.url);
    let usingDirect = false;
    function useDirect() {
      if (controller.signal.aborted) return;
      if (usingDirect || !direct) { onUnavailable(info); return; }
      usingDirect = true;
      video!.src = direct;
    }
    video.addEventListener("error", useDirect);
    if (info.fileId) void playCanvasMedia(video, info.fileId, controller.signal).catch(() => { if (!usingDirect) useDirect(); });
    else useDirect();
    return () => {
      video.removeEventListener("error", useDirect);
      controller.abort();
      video.removeAttribute("src");
      video.load();
    };
  }, [info, onUnavailable]);
  useEffect(() => {
    if (ref.current) syncFrame(ref.current);
  }, [playing, heldFrame]);
  return <div className="lyrics-canvas-cover"><video ref={attach} data-canvas-video=""
    poster={cover || undefined} muted autoPlay={playing && heldFrame === undefined} loop playsInline
    onCanPlay={(event) => syncFrame(event.currentTarget)} aria-label="Spotify Canvas" /></div>;
}

function preceding<Entry extends { start: number }>(entries: readonly Entry[], second: number): Entry | undefined {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (entries[middle].start <= second) low = middle + 1;
    else high = middle;
  }
  return entries[low - 1];
}

export function SpotifyVisualiser({ host, trackId, playing, opacity, capture, motion, read }: {
  host: Host; trackId: string; playing: boolean; opacity: number; capture: SpotifyCapture;
  motion: RefObject<VisualiserFrame | null>; read?: () => number;
}) {
  const [analysis, setAnalysis] = useState<Awaited<ReturnType<Host["analysis"]>>>();
  useEffect(() => {
    let active = true;
    void host.analysis(trackId)?.then((result) => { if (active) setAnalysis(result); }).catch(() => {});
    return () => { active = false; };
  }, [host, trackId]);

  const spectrum = useMemo(() => {
    const bars = new Uint8Array(VISUALISER_BARS);
    return () => {
      const time = (read?.() ?? host.position()) / 1000;
      const beat = preceding(analysis?.beats ?? [], time);
      const beatLevel = beat ? Math.max(0, 1 - (time - beat.start) / 0.14) : 0;
      const captured = capture.spectrum(trackId);
      if (captured) return captured;
      const segment = preceding(analysis?.segments ?? [], time);
      if (!segment?.pitches?.length) return;
      const level = Math.max(0, Math.min(1, (segment.loudness_max + 32) / 32));
      // Spotify's analysis is pitch-class data. Interpolate it for display
      // without presenting it as an actual frequency spectrum.
      for (let bar = 0; bar < bars.length; bar++) {
        const pitch = bar * (segment.pitches.length - 1) / (bars.length - 1);
        const low = Math.floor(pitch);
        const value = segment.pitches[low] + (segment.pitches[Math.ceil(pitch)] - segment.pitches[low]) * (pitch - low);
        bars[bar] = Math.round(255 * level * value * (0.84 + beatLevel * 0.16));
      }
      return bars;
    };
  }, [host, trackId, analysis, capture, read]);

  return <LyricsVisualiser playing={playing} opacity={opacity} spectrum={spectrum} motion={motion} />;
}
