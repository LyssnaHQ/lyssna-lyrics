import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AudioSegment, CanvasInfo, Host } from "./host";
import { LyricsVisualiser } from "./lyssna/lyrics-visualiser";
import { playCanvasMedia } from "./canvas-media";

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
