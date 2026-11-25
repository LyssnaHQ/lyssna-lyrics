import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Music2 } from "lucide-react";
import type { CanvasInfo, Host } from "./host";
import { LyricsVisualiser } from "./lyssna/lyrics-visualiser";
import { spectrumBars, VISUALISER_BARS, type VisualiserFrame } from "./lyssna/visualiser-frame";
import { playCanvasMedia } from "./canvas-media";
import type { SpotifyCapture } from "./creator/spotify-capture";
import { AMPLITUDE_COLUMN, LIVE_TILE_MS, liveSpectrumCleared, readLiveTiles, type LiveTile } from "./creator/spectrum-storage";
import { spotifySongUri } from "./spotify-song";

export function TrackArtwork({ src, className = "cover" }: { src?: string; className?: string }) {
  const [failed, setFailed] = useState<string>();
  if (src && src !== failed) return <img className={className} src={src} alt="" onError={() => setFailed(src)} />;
  return <div className={`${className} lyssna-cover-placeholder`} role="img" aria-label="No cover artwork">
    <Music2 aria-hidden="true" />
  </div>;
}

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
  const frameSelected = useRef(false);
  function syncFrame(video: HTMLVideoElement) {
    if (heldFrame === undefined && playing) {
      void video.play().catch(() => {});
      return;
    }
    video.pause();
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    if (heldFrame !== undefined) {
      const target = Math.min(heldFrame, Math.max(0, video.duration - 0.001));
      if (!frameSelected.current || Math.abs(video.currentTime - target) > 0.001) video.currentTime = target;
    } else {
      if (frameSelected.current || !video.seekable.length) return;
      const start = video.seekable.start(0);
      const end = video.seekable.end(0);
      if (end <= start) return;
      video.currentTime = start + (end - start) * (0.05 + Math.random() * 0.9);
    }
    frameSelected.current = true;
  }
  const attach = useCallback((video: HTMLVideoElement | null) => {
    ref.current = video;
    onVideo(video);
  }, [onVideo]);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    frameSelected.current = false;
    const controller = new AbortController();
    const direct = canvasUrl(info.url);
    let usingDirect = false;
    function useDirect() {
      if (controller.signal.aborted) return;
      if (usingDirect || !direct) { onUnavailable(info); return; }
      usingDirect = true;
      frameSelected.current = false;
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
    poster={cover || undefined} preload="auto" muted autoPlay={playing && heldFrame === undefined} loop playsInline
    onDurationChange={(event) => syncFrame(event.currentTarget)} onLoadedData={(event) => syncFrame(event.currentTarget)}
    onCanPlay={(event) => syncFrame(event.currentTarget)} onPlaying={() => { frameSelected.current = true; }}
    aria-label="Spotify Canvas" /></div>;
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
  const saved = useRef<{ index: number; tile?: LiveTile }>(undefined);
  useEffect(() => {
    let active = true;
    void host.analysis(trackId)?.then((result) => { if (active) setAnalysis(result); }).catch(() => {});
    return () => { active = false; };
  }, [host, trackId]);
  useEffect(() => {
    const clear = (event: Event) => {
      const uri = (event as CustomEvent<string | undefined>).detail;
      if (!uri || uri === spotifySongUri(trackId)) saved.current = undefined;
    };
    window.addEventListener(liveSpectrumCleared, clear);
    return () => {
      saved.current = undefined;
      window.removeEventListener(liveSpectrumCleared, clear);
    };
  }, [trackId]);

  const spectrum = useMemo(() => {
    const bars = new Uint8Array(VISUALISER_BARS);
    return () => {
      const position = read?.() ?? host.position();
      if (!Number.isFinite(position) || position < 0) return;
      const captured = capture.spectrum(trackId);
      if (captured) return captured;
      const time = position / 1000;
      const beat = preceding(analysis?.beats ?? [], time);
      const beatLevel = beat ? Math.max(0, 1 - (time - beat.start) / 0.14) : 0;
      const segment = preceding(analysis?.segments ?? [], time);
      if (!segment?.pitches?.length) {
        const index = Math.floor(position / LIVE_TILE_MS);
        if (saved.current?.index !== index) {
          const request = { index, tile: undefined as LiveTile | undefined };
          saved.current = request;
          void readLiveTiles(spotifySongUri(trackId), index, index).then(([tile]) => { request.tile = tile; }).catch(() => {});
        }
        const tile = saved.current.tile;
        if (tile) {
          const columns = tile.filled.length;
          const column = Math.floor((position % LIVE_TILE_MS) * columns / LIVE_TILE_MS);
          const format = tile.filled[column];
          if (format) return spectrumBars(bars, tile.levels, columns, column, !!(format & AMPLITUDE_COLUMN));
        }
        if (!beatLevel) return;
        for (let bar = 0; bar < bars.length; bar++) {
          bars[bar] = Math.round(beatLevel * 180 * (1 - bar / bars.length));
        }
        return bars;
      }
      const level = Math.max(0, Math.min(1, ((segment.loudness_max ?? -32) + 32) / 32));
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
