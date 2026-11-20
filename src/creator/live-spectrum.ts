import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { spectrumFrequency } from "./audio";
import { useCreatorEnvironment } from "./environment";
import {
  hasLiveSpectrum, LIVE_COLUMNS, LIVE_ROWS, LIVE_SAMPLE_MS, LIVE_TILE_MS, mergeLiveTile,
  readLiveTiles, saveLiveTiles, type LiveTile,
} from "./spectrum-storage";

type CaptureHandle = { handle: string; origin?: string };
type CaptureDevices = MediaDevices & {
  setCaptureHandleConfig?(config: { handle?: string; exposeOrigin?: boolean; permittedOrigins?: string[] }): void;
};
type CaptureVideo = MediaStreamTrack & { getCaptureHandle?(): CaptureHandle | null };
type DisplayOptions = DisplayMediaStreamOptions & {
  preferCurrentTab: boolean;
  systemAudio: "exclude";
  windowAudio: "exclude";
  monitorTypeSurfaces: "exclude";
  surfaceSwitching: "exclude";
};
type BufferedTile = { tile: LiveTile; revision: number; savedRevision: number };
type CaptureStatus = "idle" | "selecting" | "live";

function captureError(error: unknown) {
  if (!(error instanceof Error)) return "Spotify couldn’t start audio sharing.";
  if (error.name === "NotAllowedError") return "Sharing was cancelled or blocked by this Spotify client (NotAllowedError).";
  return error.message || error.name;
}

export function useLiveSpectrum(uri: string, duration: number, canCapture: boolean) {
  const { view, readCapturePosition } = useCreatorEnvironment();
  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [hasSaved, setHasSaved] = useState(false);
  const [message, setMessage] = useState("");
  const [, redraw] = useState(0);
  const tiles = useRef(new Map<number, BufferedTile>());
  const visible = useRef({ first: 0, last: -1 });
  const session = useRef<{ stop(): void } | undefined>(undefined);
  const mounted = useRef(false);

  useLayoutEffect(() => {
    mounted.current = true;
    const stop = () => session.current?.stop();
    view.addEventListener("pagehide", stop);
    return () => {
      mounted.current = false;
      view.removeEventListener("pagehide", stop);
      stop();
    };
  }, [view]);
  useLayoutEffect(() => { if (!canCapture) session.current?.stop(); }, [canCapture]);
  useEffect(() => {
    let current = true;
    void hasLiveSpectrum(uri).then((saved) => { if (current && saved) setHasSaved(true); }).catch(() => {});
    return () => { current = false; };
  }, [uri]);

  const trim = useCallback(() => {
    if (tiles.current.size <= 64) return;
    const { first, last } = visible.current;
    for (const [index, entry] of tiles.current) {
      if (entry.revision === entry.savedRevision && (index < first || index > last)) tiles.current.delete(index);
      if (tiles.current.size <= 64) break;
    }
  }, []);

  const load = useCallback((first: number, last: number) => {
    visible.current = { first, last };
    if (last < first) return () => {};
    let current = true;
    void readLiveTiles(uri, first, last).then((loaded) => {
      if (!current) return;
      for (const tile of loaded) {
        const existing = tiles.current.get(tile.index);
        if (existing) {
          mergeLiveTile(existing.tile, tile, false);
          if (existing.revision === existing.savedRevision) existing.savedRevision++;
          existing.revision++;
        } else tiles.current.set(tile.index, { tile, revision: 0, savedRevision: 0 });
      }
      trim();
      if (loaded.length) redraw((value) => value + 1);
    }).catch(() => {});
    return () => { current = false; };
  }, [uri, trim]);

  async function start() {
    if (!canCapture || session.current) return;
    const devices: CaptureDevices | undefined = view.navigator.mediaDevices;
    const origin = view.location.origin;
    if (!devices?.getDisplayMedia || !devices.setCaptureHandleConfig || origin === "null") {
      setMessage("This Spotify client can’t verify Spotify-only audio sharing.");
      return;
    }

    const dirty = new Set<number>();
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    let timer = 0;
    let saveTimer = 0;
    let configured = false;
    const flush = () => {
      const changed = [...dirty].flatMap((index) => {
        const entry = tiles.current.get(index);
        if (!entry) return [];
        const { tile, revision } = entry;
        return [{ entry, revision, snapshot: { ...tile, filled: tile.filled.slice(), levels: tile.levels.slice() } }];
      });
      if (!changed.length) return;
      dirty.clear();
      void saveLiveTiles(changed.map(({ snapshot }) => snapshot)).then(() => {
        for (const { entry, revision } of changed) entry.savedRevision = Math.max(entry.savedRevision, revision);
        trim();
      }).catch(() => {
        if (mounted.current) setMessage("Couldn’t save the spectrogram to Spotify’s local storage.");
      });
    };
    const stop = (notice = "") => {
      if (session.current !== active) return;
      session.current = undefined;
      view.clearInterval(timer);
      view.clearInterval(saveTimer);
      stream?.getTracks().forEach((track) => track.stop());
      if (configured) {
        try { devices.setCaptureHandleConfig?.({ permittedOrigins: [] }); }
        catch { /* The document may already be unloading. */ }
      }
      if (context) void context.close().catch(() => {});
      flush();
      if (mounted.current) {
        setStatus("idle");
        setMessage(notice);
      }
    };
    const active = { stop };
    session.current = active;
    setStatus("selecting");
    setMessage("");
    try {
      const handle = view.crypto.randomUUID();
      devices.setCaptureHandleConfig({ handle, exposeOrigin: true, permittedOrigins: [origin] });
      configured = true;
      context = new view.AudioContext();
      void context.resume().catch(() => {});
      const options: DisplayOptions = {
        video: { displaySurface: "browser", frameRate: { ideal: 1 } },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false } as MediaTrackConstraints,
        preferCurrentTab: true,
        systemAudio: "exclude",
        windowAudio: "exclude",
        monitorTypeSurfaces: "exclude",
        surfaceSwitching: "exclude",
      };
      stream = await devices.getDisplayMedia(options);
      if (session.current !== active) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const [video] = stream.getVideoTracks() as CaptureVideo[];
      const [audio] = stream.getAudioTracks();
      const isSpotify = () => {
        const source = video?.getCaptureHandle?.();
        return video?.readyState === "live" && video.getSettings().displaySurface === "browser" &&
          source?.handle === handle && source.origin === origin;
      };
      if (!isSpotify()) throw new Error("Choose the current Spotify tab. Other tabs, windows and system audio are rejected.");
      if (!audio || audio.readyState !== "live") throw new Error("Spotify didn’t share an audio track. Enable tab audio in the picker if offered.");

      const stopped = () => stop("Spotify audio sharing ended.");
      video.addEventListener("ended", stopped, { once: true });
      audio.addEventListener("ended", stopped, { once: true });
      video.addEventListener("capturehandlechange", () => { if (!isSpotify()) stop("Spotify audio sharing ended when the source changed."); });
      const analyser = context.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0;
      // Only connect the verified audio track. The video track is used for identity checks.
      const source = context.createMediaStreamSource(new view.MediaStream([audio]));
      source.connect(analyser);
      const bins = new Float32Array(analyser.frequencyBinCount);
      const hzPerBin = context.sampleRate / analyser.fftSize;
      const edges = Uint16Array.from({ length: LIVE_ROWS + 1 }, (_, row) =>
        Math.min(bins.length, Math.round(spectrumFrequency(1 - row / LIVE_ROWS) / hzPerBin)));
      const halfWindowMs = 500 / hzPerBin;
      let previous = -Infinity;
      let previousAt = 0;
      let settleUntil = 0;
      let noSignalSince = 0;
      let heard = false;
      let quiet = false;
      let frames = 0;
      setStatus("live");
      timer = view.setInterval(() => {
        if (!isSpotify()) { stop("Spotify audio sharing ended when the source changed."); return; }
        const ms = readCapturePosition(uri);
        if (ms === undefined || !Number.isFinite(ms)) { previous = -Infinity; noSignalSince = 0; return; }
        const now = view.performance.now();
        const delta = ms - previous;
        if (delta < -40 || delta > now - previousAt + 160) settleUntil = now + 160;
        previous = ms;
        previousAt = now;
        const position = ms - halfWindowMs;
        if (now < settleUntil || position < 0 || position >= duration) return;

        if (audio.muted) bins.fill(-Infinity);
        else analyser.getFloatFrequencyData(bins);
        const signal = bins.some((level) => level > -82);
        if (signal) {
          noSignalSince = 0;
          if (quiet) { quiet = false; setMessage(""); }
        } else {
          noSignalSince ||= now;
          if (!quiet && now - noSignalSince > 3000) {
            quiet = true;
            setMessage("The shared Spotify tab is silent. This client may play music outside the tab.");
          }
          if (!heard) return;
        }
        if (!heard) { heard = true; setHasSaved(true); }

        const index = Math.floor(position / LIVE_TILE_MS);
        const column = Math.floor((position % LIVE_TILE_MS) / LIVE_SAMPLE_MS);
        let entry = tiles.current.get(index);
        if (!entry) {
          entry = {
            tile: { uri, index, levels: new Uint16Array(LIVE_ROWS * LIVE_COLUMNS), filled: new Uint8Array(LIVE_COLUMNS) },
            revision: 0, savedRevision: 0,
          };
          tiles.current.set(index, entry);
        }
        for (let row = 0; row < LIVE_ROWS; row++) {
          const first = edges[row + 1];
          const last = Math.min(bins.length, Math.max(first + 1, edges[row]));
          let peak = -95;
          for (let bin = first; bin < last; bin++) peak = Math.max(peak, bins[bin]);
          entry.tile.levels[row * LIVE_COLUMNS + column] = Math.round(Math.min(1, (peak + 95) / 70) * 5400);
        }
        entry.tile.filled[column] = 1;
        entry.revision++;
        dirty.add(index);
        if (++frames % 4 === 1) redraw((value) => value + 1);
      }, LIVE_SAMPLE_MS);
      saveTimer = view.setInterval(flush, 1000);
    } catch (error) {
      stop(captureError(error));
    }
  }

  return { status, message, hasSaved, tiles: tiles.current, load, start, stop: () => session.current?.stop() };
}
