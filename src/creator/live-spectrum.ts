import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { spectrumFrequency } from "./audio";
import { useCreatorEnvironment } from "./environment";
import { spotifyWindowMarker } from "./spotify-window";
import processorSource from "./live-spectrum-processor.js?raw";
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
type FrameBatch = { first: number; decibels: Float32Array };
const signalFloor = -120;

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
    let worklet: AudioWorkletNode | undefined;
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
      if (worklet) {
        worklet.port.close();
        worklet.disconnect();
      }
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
      // Only connect the verified audio track. Captured video is never stored.
      const source = context.createMediaStreamSource(new view.MediaStream([audio]));
      const audioContext = context;
      const fftSize = 4096;
      const halfWindowMs = 500 * fftSize / audioContext.sampleRate;
      const frequencies = Array.from({ length: LIVE_ROWS + 1 }, (_, row) => spectrumFrequency(1 - row / LIVE_ROWS));
      let previousClock: { ms: number; audioMs: number; transportRevision: number; volume: number } | undefined;
      let captureFrom = 0;
      let columnOffset: number | undefined;
      let noSignalSince = 0;
      let suspendedSince = 0;
      let heard = false;
      let frames = 0;
      let referencePeak = signalFloor;
      const levels = new Uint16Array(LIVE_ROWS);
      setStatus("live");
      setMessage("");
      const captureClock = () => {
        if (session.current !== active) return;
        if (!isSpotify()) { stop("Spotify audio sharing ended when the source changed."); return; }
        const now = view.performance.now();
        const audioMs = audioContext.currentTime * 1000;
        if (audioContext.state !== "running") {
          previousClock = undefined;
          suspendedSince ||= now;
          if (now - suspendedSince > 3000) stop("Spotify couldn’t start the audio analyser.");
          return;
        }
        suspendedSince = 0;
        const playback = readCapturePosition(uri);
        if (!playback || !Number.isFinite(playback.ms)) {
          previousClock = undefined;
          noSignalSince = 0;
          return;
        }
        const discontinuity = !previousClock || playback.transportRevision !== previousClock.transportRevision ||
          playback.ms < previousClock.ms - 40 || Math.abs(playback.ms - previousClock.ms - (audioMs - previousClock.audioMs)) > 100;
        if (discontinuity) {
          captureFrom = audioMs + 160;
          columnOffset = undefined;
        }
        if (discontinuity || playback.volume !== previousClock?.volume) {
          referencePeak = signalFloor;
        }
        previousClock = { ...playback, audioMs };
        return { ms: playback.ms, now, audioMs };
      };
      const acceptSignal = (signal: boolean, now: number) => {
        if (signal) noSignalSince = 0;
        else if (!heard) {
          noSignalSince ||= now;
          if (now - noSignalSince > 5000) stop("Spotify audio sharing stopped after five seconds of silence.");
          return false;
        }
        if (!heard) { heard = true; setHasSaved(true); }
        return true;
      };
      const normalizeFrame = (decibels: Float32Array, now: number, start = 0) => {
        let peak = signalFloor;
        for (let row = 0; row < LIVE_ROWS; row++) peak = Math.max(peak, decibels[start + row]);
        if (!acceptSignal(peak > signalFloor, now)) return false;

        // Follow the strongest bands without amplifying short dips between syllables.
        referencePeak = Math.max(peak, referencePeak - 18 * LIVE_SAMPLE_MS / 1000);
        const gain = Math.min(72, -25 - referencePeak);
        for (let row = 0; row < LIVE_ROWS; row++) {
          const db = decibels[start + row];
          levels[row] = db <= signalFloor ? 0 : Math.round(Math.max(0, Math.min(1, (db + gain + 95) / 70)) * 5400);
        }
        return true;
      };
      const writeFrame = (frame: number, levels: Uint16Array, before?: Uint16Array, weight = 1) => {
        if (frame < 0 || frame * LIVE_SAMPLE_MS >= duration) return;
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
        if (before && entry.tile.filled[column] === MEASURED_COLUMN) return;
        for (let row = 0; row < LIVE_ROWS; row++) {
          const level = levels[row];
          entry.tile.levels[row * LIVE_COLUMNS + column] = before ? Math.round(before[row] + (level - before[row]) * weight) : level;
        }
        entry.tile.filled[column] = before ? INTERPOLATED_COLUMN : MEASURED_COLUMN;
        entry.revision++;
        dirty.add(index);
        if (++frames % 4 === 1) redraw((value) => value + 1);
      };
      const sampleOnTimer = () => {
        setMessage("Sharing Spotify audio in compatibility mode.");
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = fftSize;
        analyser.smoothingTimeConstant = 0;
        source.connect(analyser);
        const bins = new Float32Array(analyser.frequencyBinCount);
        const edges = Uint16Array.from(frequencies, (hz) => Math.min(bins.length, Math.round(hz * fftSize / audioContext.sampleRate)));
        const decibels = new Float32Array(LIVE_ROWS);
        const previousLevels = new Uint16Array(LIVE_ROWS);
        let previousSample = -1;
        let previousSampleAt = 0;
        timer = view.setInterval(() => {
          const clock = captureClock();
          if (!clock || clock.audioMs < captureFrom || audio.muted) {
            previousSample = -1;
            if (clock && audio.muted) acceptSignal(false, clock.now);
            return;
          }
          analyser.getFloatFrequencyData(bins);
          for (let row = 0; row < LIVE_ROWS; row++) {
            const first = edges[row + 1];
            const last = Math.min(bins.length, Math.max(first + 1, edges[row]));
            let peak = -Infinity;
            for (let bin = first; bin < last; bin++) peak = Math.max(peak, bins[bin]);
            decibels[row] = peak;
          }
          if (!normalizeFrame(decibels, clock.now)) return;
          const sample = Math.floor((clock.ms - halfWindowMs) / LIVE_SAMPLE_MS);
          const elapsed = clock.now - previousSampleAt;
          const distance = sample - previousSample;
          if (previousSample >= 0 && distance > 1 && distance <= 4 && elapsed <= 100 &&
            Math.abs(distance * LIVE_SAMPLE_MS - elapsed) < 35) {
            for (let missing = 1; missing < distance; missing++) writeFrame(previousSample + missing, levels, previousLevels, missing / distance);
          }
          writeFrame(sample, levels);
          previousLevels.set(levels);
          previousSample = sample;
          previousSampleAt = clock.now;
        }, LIVE_SAMPLE_MS);
      };
      saveTimer = view.setInterval(flush, 1000);
      try {
        const url = view.URL.createObjectURL(new view.Blob([processorSource], { type: "text/javascript" }));
        try { await audioContext.audioWorklet.addModule(url); }
        finally { view.URL.revokeObjectURL(url); }
        if (session.current !== active) return;
        const node = new view.AudioWorkletNode(audioContext, "lyssna-live-spectrum", {
          processorOptions: { frequencies, interval: LIVE_SAMPLE_MS },
          outputChannelCount: [1],
        });
        worklet = node;
        const output = audioContext.createGain();
        output.gain.value = 0;
        node.port.onmessage = ({ data }: MessageEvent<FrameBatch>) => {
          const clock = captureClock();
          if (!clock) return;
          if (audio.muted) { acceptSignal(false, clock.now); return; }
          // Map the worklet's continuous audio clock to the Spotify playhead once per uninterrupted stretch.
          const offset = columnOffset ??= Math.round((clock.ms - clock.audioMs - halfWindowMs) / LIVE_SAMPLE_MS);
          for (let i = 0; i < data.decibels.length / LIVE_ROWS; i++) {
            if (session.current !== active) break;
            const sequence = data.first + i;
            if (sequence * LIVE_SAMPLE_MS < captureFrom || !normalizeFrame(data.decibels, clock.now, i * LIVE_ROWS)) continue;
            writeFrame(sequence + offset, levels);
          }
        };
        node.onprocessorerror = () => {
          if (session.current !== active) return;
          node.port.close();
          source.disconnect(node);
          node.disconnect();
          worklet = undefined;
          view.clearInterval(timer);
          sampleOnTimer();
        };
        source.connect(node).connect(output).connect(audioContext.destination);
        timer = view.setInterval(captureClock, 250);
      } catch {
        if (session.current === active) {
          worklet?.port.close();
          worklet?.disconnect();
          worklet = undefined;
          sampleOnTimer();
        }
      }
    } catch (error) {
      stop(captureError(error));
    }
  }

  return { status, message, sharePrompt, hasSaved, tiles: tiles.current, load, start, stop: () => session.current?.stop() };
}
