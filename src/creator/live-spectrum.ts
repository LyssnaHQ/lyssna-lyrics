import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { spectrumFrequency } from "./audio";
import { useCreatorEnvironment } from "./environment";
import { spotifyWindowMarker } from "./spotify-window";
import {
  hasLiveSpectrum, INTERPOLATED_COLUMN, LIVE_COLUMNS, LIVE_ROWS, LIVE_SAMPLE_MS, MEASURED_COLUMN, mergeLiveTile,
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
  windowAudio: "window" | "exclude";
  selfBrowserSurface: "include" | "exclude";
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
  const desktop = view.location.hostname === "xpui.app.spotify.com";
  const sharePrompt = desktop ? "Choose the Spotify window and enable window audio." : "Choose this Spotify tab and enable tab audio.";
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
    if (!devices?.getDisplayMedia || (!desktop && (!devices.setCaptureHandleConfig || origin === "null"))) {
      setMessage("This Spotify client can’t verify Spotify-only audio sharing.");
      return;
    }

    const dirty = new Set<number>();
    const verification = new AbortController();
    let marker: ReturnType<typeof spotifyWindowMarker> | undefined;
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
      verification.abort();
      marker?.remove();
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
    setMessage(sharePrompt);
    try {
      const handle = view.crypto.randomUUID();
      if (desktop) marker = spotifyWindowMarker(view);
      else {
        devices.setCaptureHandleConfig?.({ handle, exposeOrigin: true, permittedOrigins: [origin] });
        configured = true;
      }
      context = new view.AudioContext();
      void context.resume().catch(() => {});
      const options: DisplayOptions = {
        video: { displaySurface: desktop ? "window" : "browser", frameRate: { ideal: 1 } },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          restrictOwnAudio: false,
          suppressLocalAudioPlayback: false,
        } as MediaTrackConstraints,
        preferCurrentTab: !desktop,
        systemAudio: "exclude",
        windowAudio: desktop ? "window" : "exclude",
        selfBrowserSurface: desktop ? "exclude" : "include",
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
      if (!audio || audio.readyState !== "live") {
        throw new Error(desktop ? "The picker didn’t supply window audio. Enable Share window audio if offered." :
          "Spotify didn’t share an audio track. Enable tab audio in the picker if offered.");
      }
      let windowVerified = false;
      if (desktop) {
        if (video?.getSettings().displaySurface !== "window" || audio.label !== "Application Audio") {
          throw new Error("Choose the Spotify window with application audio. This client may only offer tab or system audio.");
        }
        setMessage("Verifying the Spotify window…");
        windowVerified = await marker!.matches(video, verification.signal);
        marker?.remove();
        if (session.current !== active) return;
        if (!windowVerified) throw new Error("Couldn’t verify the Spotify window. Keep it visible and choose it in the picker.");
      }
      const isSpotify = () => {
        if (video?.readyState !== "live") return false;
        if (desktop) return windowVerified && video.getSettings().displaySurface === "window" && audio.label === "Application Audio";
        const source = video?.getCaptureHandle?.();
        return video.getSettings().displaySurface === "browser" &&
          source?.handle === handle && source.origin === origin;
      };
      if (!isSpotify()) throw new Error("Choose the current Spotify tab. Other tabs, windows and system audio are rejected.");
      if (audio.readyState !== "live") throw new Error("Spotify audio sharing ended before capture started.");

      const stopped = () => stop("Spotify audio sharing ended.");
      video.addEventListener("ended", stopped, { once: true });
      audio.addEventListener("ended", stopped, { once: true });
      video.addEventListener("capturehandlechange", () => { if (!isSpotify()) stop("Spotify audio sharing ended when the source changed."); });
      const analyser = context.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0;
      // Only connect the verified audio track. Captured video is never stored.
      const source = context.createMediaStreamSource(new view.MediaStream([audio]));
      source.connect(analyser);
      const bins = new Float32Array(analyser.frequencyBinCount);
      const hzPerBin = context.sampleRate / analyser.fftSize;
      const edges = Uint16Array.from({ length: LIVE_ROWS + 1 }, (_, row) =>
        Math.min(bins.length, Math.round(spectrumFrequency(1 - row / LIVE_ROWS) / hzPerBin)));
      const halfWindowMs = 500 / hzPerBin;
      let levels = new Uint16Array(LIVE_ROWS);
      let previousLevels = new Uint16Array(LIVE_ROWS);
      let previousSample = -1;
      let previousSampleAt = 0;
      let previousSamplePosition = 0;
      let previous = -Infinity;
      let previousAt = 0;
      let previousTransport: number | undefined;
      let settleUntil = 0;
      let noSignalSince = 0;
      let suspendedSince = 0;
      let heard = false;
      let frames = 0;
      setStatus("live");
      setMessage("");
      const audioContext = context;
      timer = view.setInterval(() => {
        if (!isSpotify()) { stop("Spotify audio sharing ended when the source changed."); return; }
        const now = view.performance.now();
        if (audioContext.state !== "running") {
          previousSample = -1;
          suspendedSince ||= now;
          if (now - suspendedSince > 3000) stop("Spotify couldn’t start the audio analyser.");
          return;
        }
        suspendedSince = 0;
        const playback = readCapturePosition(uri);
        if (!playback || !Number.isFinite(playback.ms)) {
          previous = -Infinity;
          previousSample = -1;
          noSignalSince = 0;
          return;
        }
        const { ms, transportRevision } = playback;
        const delta = ms - previous;
        if (transportRevision !== previousTransport || delta < -40 || delta > now - previousAt + 160) {
          settleUntil = now + 160;
          previousSample = -1;
        }
        previous = ms;
        previousAt = now;
        previousTransport = transportRevision;
        const position = ms - halfWindowMs;
        if (now < settleUntil || position < 0 || position >= duration) return;

        if (audio.muted) {
          previousSample = -1;
          if (heard) return;
          bins.fill(-Infinity);
        } else analyser.getFloatFrequencyData(bins);
        const signal = bins.some((level) => level > -82);
        if (signal) noSignalSince = 0;
        else if (!heard) {
          noSignalSince ||= now;
          if (now - noSignalSince > 5000) stop("Spotify audio sharing stopped after five seconds of silence.");
          return;
        }
        if (!heard) { heard = true; setHasSaved(true); }

        for (let row = 0; row < LIVE_ROWS; row++) {
          const first = edges[row + 1];
          const last = Math.min(bins.length, Math.max(first + 1, edges[row]));
          let peak = -95;
          for (let bin = first; bin < last; bin++) peak = Math.max(peak, bins[bin]);
          levels[row] = Math.round(Math.min(1, (peak + 95) / 70) * 5400);
        }
        const sample = Math.floor(position / LIVE_SAMPLE_MS);
        const elapsed = now - previousSampleAt;
        const distance = sample - previousSample;
        // Timer drift can skip columns. Interpolate only between nearby frames on the same stretch of playback.
        const interpolate = previousSample >= 0 && distance > 1 && distance <= 4 && elapsed <= 100 &&
          Math.abs(position - previousSamplePosition - elapsed) < 35;
        for (let frame = interpolate ? previousSample + 1 : sample; frame <= sample; frame++) {
          const index = Math.floor(frame / LIVE_COLUMNS);
          const column = frame % LIVE_COLUMNS;
          let entry = tiles.current.get(index);
          if (!entry) {
            entry = {
              tile: { uri, index, levels: new Uint16Array(LIVE_ROWS * LIVE_COLUMNS), filled: new Uint8Array(LIVE_COLUMNS) },
              revision: 0, savedRevision: 0,
            };
            tiles.current.set(index, entry);
          }
          const measured = frame === sample;
          if (!measured && entry.tile.filled[column] === MEASURED_COLUMN) continue;
          const weight = measured ? 1 : (frame - previousSample) / distance;
          for (let row = 0; row < LIVE_ROWS; row++) {
            entry.tile.levels[row * LIVE_COLUMNS + column] = measured ? levels[row] :
              Math.round(previousLevels[row] + (levels[row] - previousLevels[row]) * weight);
          }
          entry.tile.filled[column] = measured ? MEASURED_COLUMN : INTERPOLATED_COLUMN;
          entry.revision++;
          dirty.add(index);
        }
        previousSample = sample;
        previousSampleAt = now;
        previousSamplePosition = position;
        [previousLevels, levels] = [levels, previousLevels];
        if (++frames % 4 === 1) redraw((value) => value + 1);
      }, LIVE_SAMPLE_MS);
      saveTimer = view.setInterval(flush, 1000);
    } catch (error) {
      stop(captureError(error));
    }
  }

  return { status, message, sharePrompt, hasSaved, tiles: tiles.current, load, start, stop: () => session.current?.stop() };
}
