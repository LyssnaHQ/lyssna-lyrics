import type { Host } from "../host";
import { spotifySongUri } from "../spotify-song";
import { spectrumBars, VISUALISER_BARS } from "../lyssna/visualiser-frame";
import { createSpectrumAnalyser, spectrumLevel, SPECTRUM_WINDOW_SIZE } from "./spectrum-analysis.js";
import analyserSource from "./spectrum-analysis.js?raw";
import { spotifyWindowMarker } from "./spotify-window";
import { createCapturedReplay, isRecordingComplete, recordedCoverage, savedAudioCleared, type ReplayPacket } from "./captured-replay";
import { trackCapture } from "./capture-sessions";
import processorSource from "./live-spectrum-processor.js?raw";
import {
  LIVE_COLUMNS, LIVE_ROWS, LIVE_SAMPLE_MS,
  AMPLITUDE_COLUMN, MEASURED_COLUMN, INTERPOLATED_COLUMN, saveLiveTiles, type LiveTile,
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
type CaptureStatus = "idle" | "selecting" | "live";
type FrameBatch = { first: number; amplitudes: Float32Array };
type ReplayBatch = { firstFrame: number; samples: Float32Array };
const signalFloor = 10 ** (-120 / 20);
const pcm24Scale = 0x800000;
const capturePeakLimit = 10 ** (-1 / 20);
const captureGain = (volume: number) =>
  Number.isFinite(volume) && volume > 0 && volume < 1 ? 1 / volume : 1;

function encodeCapture(samples: Float32Array, volume: number) {
  let gain = captureGain(volume);
  if (gain > 1) {
    let peak = 0;
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    gain = peak ? Math.max(1, Math.min(gain, capturePeakLimit / peak)) : 1;
  }
  const scale = pcm24Scale * gain;
  return Int32Array.from(samples, (sample) =>
    Math.max(-pcm24Scale, Math.min(pcm24Scale - 1, Math.round(sample * scale))));
}

function captureError(error: unknown) {
  if (!(error instanceof Error)) return "Spotify couldn’t start audio sharing.";
  if (error.name === "NotAllowedError") return "Sharing was cancelled or blocked by this Spotify client (NotAllowedError).";
  return error.message || error.name;
}

type CaptureState = { status: CaptureStatus; message: string; scope?: string };

export function createSpotifyCapture(host: Host, view: Window & typeof globalThis = window) {
  const desktop = view.location.hostname === "xpui.app.spotify.com";
  const sharePrompt = desktop ? "Choose the Spotify window and enable window audio." : "Choose this Spotify tab and enable tab audio.";
  const listeners = new Set<() => void>();
  let state: CaptureState = { status: "idle", message: "" };
  let session: { stop(message?: string): Promise<void> } | undefined;
  let stoppingSession: Promise<void> | undefined;
  let transportRevision = 0;
  let usingLocalAudio = false;
  let syncProcessing: (() => void) | undefined;
  let flushSpectrum: (() => Promise<void>) | undefined;
  const spectrum = new Uint8Array(VISUALISER_BARS);
  let spectrumTrack = "";
  let spectrumAt = 0;

  function publish(next: CaptureState) {
    state = next;
    listeners.forEach((listener) => listener());
  }

  function setStatus(status: CaptureStatus) { publish({ ...state, status }); }
  function setMessage(message: string) { if (message !== state.message) publish({ ...state, message }); }

  const recordings = createCapturedReplay(
    (summary) => view.dispatchEvent(new CustomEvent(recordedAudioSaved, { detail: summary })),
    () => setMessage("Couldn’t save all recorded audio. Check Spotify’s local storage space."),
    () => flushSpectrum?.(),
  );
  const { append: appendReplay, flush: flushReplay } = recordings;

  async function start(scope: string) {
    if (session || stoppingSession) return;
    const devices: CaptureDevices | undefined = view.navigator.mediaDevices;
    const origin = view.location.origin;
    if (!devices?.getDisplayMedia || (!desktop && (!devices.setCaptureHandleConfig || origin === "null"))) {
      publish({ status: "idle", scope, message: "This Spotify client can’t verify Spotify-only audio sharing." });
      return;
    }

    const dirty = new Map<string, Map<number, LiveTile>>();
    const durations = new Map<string, number>();
    const sealed = new Set<string>();
    const verification = new AbortController();
    let marker: ReturnType<typeof spotifyWindowMarker> | undefined;
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    let timer = 0;
    let saveTimer = 0;
    let worklet: AudioWorkletNode | undefined;
    let stopWatching: (() => void) | undefined;
    let configured = false;
    let spectrumWrites = Promise.resolve();
    let stopping: Promise<void> | undefined;
    let untrack: (() => void) | undefined;
    const flush = () => {
      if (!dirty.size) return spectrumWrites;
      const changed = [...dirty.entries()];
      dirty.clear();
      spectrumWrites = spectrumWrites.then(async () => {
        for (const [uri, tiles] of changed) {
          if (scope === "auto" && sealed.has(uri)) continue;
          const saved = await saveLiveTiles(uri, durations.get(uri) ?? 0, [...tiles.values()], scope === "auto");
          if (!saved) sealed.add(uri);
        }
      }).catch(() => {
        if (session === active) setMessage("Couldn’t save the spectrogram to Spotify’s local storage.");
      });
      return spectrumWrites;
    };
    const clearSeals = (event: Event) => {
      const uri = (event as CustomEvent<string | undefined>).detail;
      if (uri) sealed.delete(uri);
      else sealed.clear();
    };
    const stop = (notice = "") => {
      if (stopping) return stopping;
      if (session !== active) return Promise.resolve();
      session = undefined;
      spectrumAt = 0;
      view.clearInterval(timer);
      view.clearInterval(saveTimer);
      view.removeEventListener(savedAudioCleared, clearSeals);
      stopWatching?.();
      syncProcessing = undefined;
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
      const spectrumSaved = flush();
      const audioSaved = flushReplay();
      if (flushSpectrum === flush) flushSpectrum = undefined;
      stopping = stoppingSession = Promise.allSettled([spectrumSaved, audioSaved]).then(() => {
        untrack?.();
        stoppingSession = undefined;
      });
      publish({ status: "idle", message: notice, scope });
      return stopping;
    };
    const active = { stop };
    session = active;
    flushSpectrum = flush;
    view.addEventListener(savedAudioCleared, clearSeals);
    untrack = trackCapture(stop);
    publish({ status: "selecting", message: sharePrompt, scope });
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
      if (session !== active) {
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
        if (session !== active) return;
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

      // Keep a partial recording on one sample grid. New recordings prefer the shared stream's rate.
      await flushReplay();
      const prior = scope === "auto" ? undefined : await recordedCoverage(scope).catch(() => undefined);
      if (session !== active) return;
      const sampleRate = prior?.sampleRate ?? audio.getSettings().sampleRate;
      if (sampleRate && sampleRate !== context.sampleRate) {
        const previous = context;
        try { context = new view.AudioContext({ sampleRate }); }
        catch (error) { if (prior) throw error; }
        if (context !== previous) {
          void previous.close().catch(() => {});
          void context.resume().catch(() => {});
        }
      }

      const stopped = () => stop("Spotify audio sharing ended.");
      video.addEventListener("ended", stopped, { once: true });
      audio.addEventListener("ended", stopped, { once: true });
      video.addEventListener("capturehandlechange", () => { if (!isSpotify()) stop("Spotify audio sharing ended when the source changed."); });
      // Only connect the verified audio track. Captured video is never stored.
      const source = context.createMediaStreamSource(new view.MediaStream([audio]));
      const audioContext = context;
      const halfWindowMs = 500 * SPECTRUM_WINDOW_SIZE / audioContext.sampleRate;
      let previousClock: { uri: string; ms: number; audioMs: number; transportRevision: number } | undefined;
      let lastUri: string | undefined;
      let captureFrom = 0;
      let replayFrom = 0;
      let columnOffset: number | undefined;
      let replayOrigin: number | undefined;
      const leadingAudio: ReplayPacket[] = [];
      let replayHeard = false;
      let noSignalSince = 0;
      let suspendedSince = 0;
      let heard = false;
      const levels = new Uint16Array(LIVE_ROWS);
      setStatus("live");
      setMessage("");
      function musicTrack() {
        if (usingLocalAudio || !host.playing() || host.djNarrating()) return;
        const track = host.track();
        if (!track) return;
        const uri = spotifySongUri(track.id);
        if (scope === "auto" || scope === uri) return uri;
      }
      const captureClock = () => {
        if (session !== active) return;
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
        const uri = musicTrack();
        const ms = host.position();
        const duration = host.duration();
        if (!uri || !Number.isFinite(ms) || duration <= 0) {
          previousClock = undefined;
          noSignalSince = 0;
          return;
        }
        if (!durations.has(uri)) {
          durations.set(uri, duration);
          void isRecordingComplete(uri, duration).then((full) => {
            if (session === active && full) sealed.add(uri);
          }).catch(() => {});
        }
        const playback = { uri, ms, transportRevision };
        const switched = !!lastUri && lastUri !== uri;
        lastUri = uri;
        const discontinuity = !previousClock || switched || playback.transportRevision !== previousClock.transportRevision ||
          playback.ms < previousClock.ms - 40 || Math.abs(playback.ms - previousClock.ms - (audioMs - previousClock.audioMs)) > 100;
        if (discontinuity) {
          captureFrom = audioMs + 160;
          // Allow the first worklet batch at the beginning of a track. Other
          // discontinuities need time for the captured audio to catch up.
          replayFrom = playback.ms < 200
            ? audioMs - (switched ? Math.max(0, Math.min(125, playback.ms - 25)) : 125) : captureFrom;
          columnOffset = undefined;
          replayOrigin = undefined;
          leadingAudio.length = 0;
          replayHeard = false;
        }
        previousClock = { ...playback, audioMs };
        return { uri, duration, ms, now, audioMs, volume: host.volume(), discontinuity };
      };
      const acceptSignal = (signal: boolean, now: number) => {
        if (signal) noSignalSince = 0;
        else if (!heard) {
          noSignalSince ||= now;
          if (scope !== "auto" && now - noSignalSince > 5000) stop("Spotify audio sharing stopped after five seconds of silence.");
          return false;
        }
        heard = true;
        return true;
      };
      const encodeFrame = (amplitudes: Float32Array, now: number, volume: number, start = 0) => {
        let peak = 0;
        for (let row = 0; row < LIVE_ROWS; row++) peak = Math.max(peak, amplitudes[start + row]);
        if (!acceptSignal(peak > signalFloor, now)) return false;
        const gain = captureGain(volume);
        for (let row = 0; row < LIVE_ROWS; row++) {
          levels[row] = spectrumLevel(amplitudes[start + row] * gain);
        }
        return true;
      };
      const writeFrame = (uri: string, duration: number, frame: number, levels: Uint16Array, before?: Uint16Array, weight = 1) => {
        if (frame < 0 || frame * LIVE_SAMPLE_MS >= duration) return;
        if (!before) {
          spectrumBars(spectrum, levels, 1, 0, true);
          spectrumTrack = uri;
          spectrumAt = view.performance.now();
        }
        if (scope === "auto" && sealed.has(uri)) return;
        const index = Math.floor(frame / LIVE_COLUMNS);
        const column = frame % LIVE_COLUMNS;
        let tiles = dirty.get(uri);
        if (!tiles) dirty.set(uri, tiles = new Map());
        let tile = tiles.get(index);
        if (!tile) {
          tile = { uri, index, levels: new Uint16Array(LIVE_ROWS * LIVE_COLUMNS), filled: new Uint8Array(LIVE_COLUMNS) };
          tiles.set(index, tile);
        }
        if (before && (tile.filled[column] & MEASURED_COLUMN)) return;
        for (let row = 0; row < LIVE_ROWS; row++) {
          const level = levels[row];
          tile.levels[row * LIVE_COLUMNS + column] = before ? Math.round(before[row] + (level - before[row]) * weight) : level;
        }
        tile.filled[column] = AMPLITUDE_COLUMN | (before ? INTERPOLATED_COLUMN : MEASURED_COLUMN);
      };
      const sampleOnTimer = () => {
        setMessage("Saving spectrograms only. This client couldn’t start audio recording.");
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = SPECTRUM_WINDOW_SIZE;
        source.connect(analyser);
        const samples = new Float32Array(SPECTRUM_WINDOW_SIZE);
        const amplitudes = new Float32Array(LIVE_ROWS);
        const analyse = createSpectrumAnalyser(audioContext.sampleRate, LIVE_ROWS);
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
          analyser.getFloatTimeDomainData(samples);
          analyse(samples, samples, samples.length / 2, amplitudes);
          if (!encodeFrame(amplitudes, clock.now, clock.volume)) return;
          const sample = Math.floor((clock.ms - halfWindowMs) / LIVE_SAMPLE_MS);
          const elapsed = clock.now - previousSampleAt;
          const distance = sample - previousSample;
          if (!clock.discontinuity && previousSample >= 0 && distance > 1 && distance * LIVE_SAMPLE_MS <= 80 && elapsed <= 100 &&
            Math.abs(distance * LIVE_SAMPLE_MS - elapsed) < 35) {
            for (let missing = 1; missing < distance; missing++) writeFrame(clock.uri, clock.duration, previousSample + missing, levels, previousLevels, missing / distance);
          }
          writeFrame(clock.uri, clock.duration, sample, levels);
          previousLevels.set(levels);
          previousSample = sample;
          previousSampleAt = clock.now;
        }, LIVE_SAMPLE_MS);
      };
      saveTimer = view.setInterval(() => { flush(); void flushReplay(); }, 1000);
      try {
        const url = view.URL.createObjectURL(new view.Blob([analyserSource, "\n", processorSource], { type: "text/javascript" }));
        try { await audioContext.audioWorklet.addModule(url); }
        finally { view.URL.revokeObjectURL(url); }
        if (session !== active) return;
        const node = new view.AudioWorkletNode(audioContext, "lyssna-live-spectrum", {
          processorOptions: { rows: LIVE_ROWS, interval: LIVE_SAMPLE_MS },
          outputChannelCount: [1],
        });
        worklet = node;
        const output = audioContext.createGain();
        output.gain.value = 0;
        node.port.onmessage = ({ data }: MessageEvent<FrameBatch | ReplayBatch>) => {
          const clock = captureClock();
          if (!clock) return;
          if (audio.muted) { acceptSignal(false, clock.now); return; }
          if ("samples" in data) {
            if (sealed.has(clock.uri)) return;
            const sampleRate = audioContext.sampleRate;
            if (clock.volume !== 0 && data.firstFrame * 1000 / sampleRate >= replayFrom) {
              replayOrigin ??= Math.round((clock.ms - clock.audioMs) * sampleRate / 1000);
              const startFrame = data.firstFrame + replayOrigin;
              const remaining = Math.round(clock.duration * sampleRate / 1000) - startFrame;
              if (remaining <= 0) return;
              const samples = encodeCapture(data.samples.subarray(0, remaining * 2), clock.volume);
              const packet = { uri: clock.uri, duration: clock.duration, startFrame, sampleRate, samples, bitrate: host.captureBitrate() };
              replayHeard ||= samples.some((sample) => Math.abs(sample) >= 512);
              if (!replayHeard) {
                leadingAudio.push(packet);
                if (leadingAudio.length > 50) leadingAudio.shift();
                return;
              }
              if (leadingAudio.length) {
                leadingAudio.forEach(appendReplay);
                leadingAudio.length = 0;
              }
              appendReplay(packet);
            } else if (clock.volume === 0) {
              replayHeard = false;
              leadingAudio.length = 0;
            }
            return;
          }
          // Map the worklet's continuous audio clock to the Spotify playhead once per uninterrupted stretch.
          const offset = columnOffset ??= Math.round((clock.ms - clock.audioMs - halfWindowMs) / LIVE_SAMPLE_MS);
          for (let i = 0; i < data.amplitudes.length / LIVE_ROWS; i++) {
            if (session !== active) break;
            const sequence = data.first + i;
            if ((sequence + 0.5) * LIVE_SAMPLE_MS < captureFrom || !encodeFrame(data.amplitudes, clock.now, clock.volume, i * LIVE_ROWS)) continue;
            writeFrame(clock.uri, clock.duration, sequence + offset, levels);
          }
        };
        node.onprocessorerror = () => {
          if (session !== active) return;
          stopWatching?.();
          stopWatching = undefined;
          syncProcessing = undefined;
          node.port.close();
          source.disconnect(node);
          node.disconnect();
          worklet = undefined;
          view.clearInterval(timer);
          sampleOnTimer();
        };
        source.connect(node).connect(output).connect(audioContext.destination);
        let processing: boolean | undefined;
        const syncWorklet = () => {
          const next = !!musicTrack();
          if (next !== processing) node.port.postMessage(processing = next);
        };
        syncProcessing = syncWorklet;
        stopWatching = host.watchControls(syncWorklet);
        syncWorklet();
        timer = view.setInterval(() => { syncWorklet(); captureClock(); }, 250);
      } catch {
        if (session === active) {
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


  return {
    start,
    stop: () => session?.stop() ?? stoppingSession,
    stopAuto: () => { if (state.scope === "auto") void session?.stop(); },
    transportChanged: () => { transportRevision++; },
    setLocalAudio(active: boolean) {
      usingLocalAudio = active;
      spectrumAt = 0;
      transportRevision++;
      syncProcessing?.();
    },
    state: () => state,
    spectrum(trackId: string) {
      if (spectrumAt && spectrumTrack === spotifySongUri(trackId) && view.performance.now() - spectrumAt < 180) return spectrum;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    sharePrompt,
    recordings,
  };
}

export type SpotifyCapture = ReturnType<typeof createSpotifyCapture>;
export const recordedAudioSaved = "lyssna-lyrics:recorded-audio-saved";
