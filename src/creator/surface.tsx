import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import type { Host, Track as SpotifyTrack } from "../host";
import { spotifySongUri } from "../spotify-song";
import type { Settings } from "../settings";
import { usePlayback } from "../playback";
import { TrackArtwork } from "../spotify-artwork";
import { InstrumentalAction } from "../instrumental-actions";
import { enabledSources, refreshPublishedLyrics, type LyricSource } from "../lyric-sources";
import { useLocalTrackIsrc } from "../local-track-isrc";
import { lyricsChanged, parseLocalTtml, saveLocalLyrics } from "../local-lyrics";
import { displayLyrics, needsWordSync } from "../word-sync";
import type { Lyrics } from "../lyssna/types";
import { LyricsDisplay } from "../lyssna/renderer";
import { Ambience } from "../lyssna/ambience";
import { fromLrc } from "../lrc";
import { submitLyssnaTtml, type SubmissionFeedback } from "../lyssna-submission";
import { lyssnaInstallReady } from "../lyssna-api";
import { CreatorEnvironment } from "./environment";
import { couldBeComplete, recordedCoverage, recordingPercent, savedAudioCleared, type RecordingCoverage, type SavedRecording } from "./captured-replay";
import { recordedAudioSaved, type SpotifyCapture } from "./spotify-capture";
import { recordingExportEnabled, type RecordingFormat } from "./recording-export";
import { exportSavedAudio } from "./recording-metadata";
import { useCreatorPlaybar, usePreviewTransport } from "./playbar";
import { useCreatorRepeat } from "./repeat";
import { useCreatorPlaybackTransitions } from "./playback-transitions";
import { creatorPitchSpectrum, creatorSpectrum, creatorWaveform } from "./audio";
import type { ReviewSelection } from "./review-panel";
import { TtmlCreator } from "./ttml-creator";
import { currentCreatorLyrics, within } from "./current-lyrics";
import { dismissDraft } from "./ttml-working";
import type { CreatorState, PlayerRequest, Track } from "./types";
import css from "./ttml-creator.css?inline";
import meterCss from "./recording-meter.css?inline";

type EditorAudio = {
  uri: string;
  url: string;
  name?: string;
  buffer?: AudioBuffer;
  replay?: { startMs: number; endMs: number; positionMs: number; speed: number; resume: boolean; full: boolean };
};

export type CreatorPlayback = {
  trackId: string;
  playing: boolean;
  read(): number;
  seek(ms: number): void;
  toggle(): void;
  returnToSpotify?(): void;
};

function creatorTrack(track: SpotifyTrack, duration: number): Track {
  return { id: track.id, uri: spotifySongUri(track.id), name: track.title, is_local: track.local,
    artists: track.artistLinks?.length ? track.artistLinks : track.artists ? [{ name: track.artists }] : [],
    album: { name: track.album, images: track.cover ? [{ url: track.cover }] : [] }, duration_ms: duration, spotify: track };
}

async function seedTimings(host: Host, lyrics: Lyrics, duration: number, trackId?: string) {
  if (!lyrics.synced || !needsWordSync(lyrics, duration)) return lyrics;
  const analysis = trackId ? await within(Promise.resolve().then(() => host.analysis(trackId)), 1500) : undefined;
  return displayLyrics(lyrics, true, duration, analysis ? {
    track: analysis.track, segments: analysis.segments ?? [], beats: analysis.beats ?? [],
  } : undefined) ?? lyrics;
}

export function CreatorSurface({ host, view: owner, settings, close, reviewSelection, closeReview, previewing, onLocalPlayback, onSubmitted, manageStoredData, capture, confirmFirstUpload }: {
  host: Host; view: Window; settings: Settings; close: () => void; previewing: boolean;
  capture: SpotifyCapture;
  reviewSelection?: ReviewSelection;
  closeReview?: () => void;
  onLocalPlayback(playback: CreatorPlayback | undefined): void; manageStoredData(trigger: HTMLElement | null): void;
  onSubmitted(feedback: SubmissionFeedback, closeEditor?: boolean): void;
  confirmFirstUpload: () => Promise<boolean>;
}) {
  const view = owner as Window & typeof globalThis;
  const { track, playing } = usePlayback(host);
  const duration = host.duration();
  const localIsrc = useLocalTrackIsrc(track, duration, host, !previewing);
  const current = useMemo(() => track ? creatorTrack(track, duration) : undefined, [track, duration]);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  const playbar = useCreatorPlaybar(view, !!current, settings.reduce_motion, previewing);
  const [seed, setSeed] = useState<{ uri: string; lyrics?: Lyrics }>();
  const [notice, setNotice] = useState<{ message: string; error: boolean }>();
  const [audio, setAudio] = useState<EditorAudio>();
  const [recorded, setRecorded] = useState<RecordingCoverage>();
  const [completeAudio, setCompleteAudio] = useState<{ uri: string; duration: number; recording: SavedRecording }>();
  const [spotifyOnly, setSpotifyOnly] = useState<string>();
  const captureState = useSyncExternalStore(capture.subscribe, capture.state);
  const recordingAudio = captureState.status !== "idle";
  const [deletingRecording, setDeletingRecording] = useState(false);
  const activeUri = useRef<string | undefined>(undefined);
  const [localPlaying, setLocalPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(host.volume);
  const audioElement = useRef<HTMLAudioElement>(null);
  const returningToSpotify = useRef(false);
  const picker = useRef<HTMLInputElement>(null);
  const openAudio = useCallback(() => picker.current?.click(), []);
  const audioLoad = useRef(0);
  const audioCacheGeneration = useRef(0);
  const clip = useRef<{ uri: string; end: number; from: number; expires: number; started: boolean }>(undefined);
  const pausedAt = useRef<{ uri?: string; position: number; requested: number; settled?: number }>(undefined);
  const audioForSong = audio?.uri === current?.uri ? audio : undefined;
  useLayoutEffect(() => {
    if (!audioForSong) return;
    capture.setLocalAudio(true);
    return () => capture.setLocalAudio(false);
  }, [capture, audioForSong]);
  const localTrackId = audioForSong ? current?.id : undefined;
  useLayoutEffect(() => {
    if (previewing || !localTrackId) return;
    returningToSpotify.current = false;
    let pauseRequested = false;
    const keepSpotifyPaused = () => {
      if (returningToSpotify.current || host.track()?.id !== localTrackId) return;
      if (!host.playing()) pauseRequested = false;
      else if (!pauseRequested) {
        pauseRequested = true;
        host.toggle();
      }
    };
    const unwatch = host.watch(keepSpotifyPaused);
    keepSpotifyPaused();
    return unwatch;
  }, [host, localTrackId, previewing]);
  const isPlaying = audioForSong ? localPlaying : playing;
  const notify = useCallback((message: string, error = false) => setNotice({ message, error }), []);
  const captured = capture.recordings;
  const saved = recorded?.uri === current?.uri ? recorded : undefined;
  const fullRecording = completeAudio?.uri === current?.uri && completeAudio?.duration === duration ? completeAudio.recording : undefined;
  const recordedPercent = recordingPercent(saved, duration, !!fullRecording);

  useLayoutEffect(() => {
    activeUri.current = current?.uri;
    audioLoad.current++;
    setCompleteAudio(undefined);
    setSpotifyOnly(undefined);
    setAudio((entry) => entry?.replay && entry.uri !== current?.uri ? undefined : entry);
    return () => { activeUri.current = undefined; void captured.flush(); };
  }, [captured, current?.uri]);
  useEffect(() => {
    const uri = current?.uri;
    if (!uri) return;
    let live = true;
    const generation = audioCacheGeneration.current;
    const onSaved = (event: Event) => {
      const summary = (event as CustomEvent<RecordingCoverage>).detail;
      if (summary.uri === uri) setRecorded(summary);
    };
    view.addEventListener(recordedAudioSaved, onSaved);
    void recordedCoverage(uri).then((summary) => {
      if (live && summary && generation === audioCacheGeneration.current) {
        setRecorded((previous) => previous?.uri === uri && previous.frames >= summary.frames ? previous : summary);
      }
    }).catch(() => {});
    return () => { live = false; view.removeEventListener(recordedAudioSaved, onSaved); };
  }, [current?.uri, view]);
  useEffect(() => {
    const uri = current?.uri;
    if (!uri || fullRecording || deletingRecording || !saved || !couldBeComplete(saved.frames, duration, saved.sampleRate)) return;
    let live = true;
    const generation = audioCacheGeneration.current;
    void captured.read(uri, 0, duration, true).then((recording) => {
      if (live && recording && generation === audioCacheGeneration.current) setCompleteAudio({ uri, duration, recording });
    }).catch(() => { if (live) notify("Couldn’t open the saved recording.", true); });
    return () => { live = false; };
  }, [captured, current?.uri, deletingRecording, duration, fullRecording, notify, saved?.frames, saved?.sampleRate]);

  useCreatorRepeat(host, notify, !previewing);
  useCreatorPlaybackTransitions(host, !previewing);
  useLayoutEffect(() => {
    pausedAt.current = undefined;
    if (previewing) clip.current = undefined;
  }, [previewing, current?.uri, audioForSong]);

  const sourceKey = enabledSources(settings).join(",");
  useEffect(() => {
    if (!track) return;
    let generation = 0;
    async function load(event?: Event) {
      if (!track || (event instanceof CustomEvent && Array.isArray(event.detail) && !event.detail.includes(track.id))) return;
      const request = ++generation;
      const sources = sourceKey ? sourceKey.split(",") as LyricSource[] : [];
      const lyrics = await currentCreatorLyrics(host, track, duration, sources).catch(() => undefined);
      if (request !== generation) return;
      const skeleton = lyrics && await seedTimings(host, lyrics, duration, track.id).catch(() => lyrics);
      if (request !== generation) return;
      setSeed({ uri: spotifySongUri(track.id), lyrics: skeleton });
    }
    setSeed(undefined);
    const reload = (event: Event) => { void load(event); };
    window.addEventListener(lyricsChanged, reload);
    window.addEventListener(lyssnaInstallReady, reload);
    void load();
    return () => {
      generation++;
      window.removeEventListener(lyricsChanged, reload);
      window.removeEventListener(lyssnaInstallReady, reload);
    };
  }, [track, duration, sourceKey, host]);

  useEffect(() => host.watchControls(() => setVolume(host.volume())), [host]);
  useEffect(() => {
    if (audioElement.current && audioForSong) audioElement.current.volume = volume;
  }, [audioForSong, volume]);
  useEffect(() => {
    if (!notice) return;
    const timer = view.setTimeout(() => setNotice(undefined), 5000);
    return () => view.clearTimeout(timer);
  }, [notice, view]);
  useEffect(() => {
    if (!audio) return;
    return () => URL.revokeObjectURL(audio.url);
  }, [audio]);
  useEffect(() => {
    if (!audioForSong || !audioElement.current) return;
    const element = audioElement.current;
    const replay = audioForSong.replay;
    element.currentTime = replay ? (replay.positionMs - replay.startMs) / 1000 : host.position() / 1000;
    element.volume = host.volume();
    element.playbackRate = replay?.speed ?? 1;
    element.preservesPitch = true;
    setLocalPlaying(false);
    setRate(element.playbackRate);
    if (replay?.resume) void element.play().catch((error) => {
      if (audioElement.current === element && error.name !== "AbortError") notify("Couldn’t start the captured replay.", true);
    });
    return () => { element.pause(); };
  }, [audioForSong, host, notify]);

  const read = useCallback((at?: number) => {
    const element = audioForSong && audioElement.current;
    const now = view.performance.now();
    const raw = element ? (audioForSong?.replay?.startMs ?? 0) + element.currentTime * 1000 : host.position();
    const pause = pausedAt.current;
    if (pause && pause.uri === current?.uri) {
      const stillPlaying = element ? !element.paused : host.playing();
      if (stillPlaying) {
        if (pause.settled === undefined && now - pause.requested < 1500) return pause.position;
        pausedAt.current = undefined;
      } else if (pause.settled === undefined || Math.abs(raw - pause.settled) < 25) {
        pause.settled ??= raw;
        return pause.position;
      } else pausedAt.current = undefined;
    }
    const adjusted = raw + (isPlaying && at !== undefined ? (at - now) * (element ? element.playbackRate : 1) : 0);
    return Math.max(0, Math.min(adjusted, audioForSong?.replay?.endMs ?? Infinity));
  }, [audioForSong, current?.uri, host, isPlaying, view]);

  const player = useCallback((request: PlayerRequest) => {
    const element = audioForSong && audioElement.current;
    switch (request.command) {
      case "play":
        pausedAt.current = undefined;
        if (request.uri && request.uri !== current?.uri) {
          element && element.pause();
          void host.playTrack(request.uri).catch((why) => notify(String(why), true));
        } else if (element) {
          if (previewing && host.playing()) host.toggle();
          if (element.ended || element.currentTime >= element.duration) element.currentTime = 0;
          void element.play().catch((why) => notify(String(why), true));
        } else if (!host.playing()) host.toggle();
        break;
      case "pause":
        clip.current = undefined;
        if (!previewing) pausedAt.current = { uri: current?.uri, position: read(), requested: view.performance.now() };
        if (element) element.pause();
        else if (host.playing()) {
          capture.transportChanged();
          host.toggle();
        }
        break;
      case "seek":
        clip.current = undefined;
        pausedAt.current = undefined;
        if (element) {
          const replay = audioForSong?.replay;
          const position = Math.min(request.positionMs, replay?.endMs ?? Infinity) - (replay?.startMs ?? 0);
          element.currentTime = Math.max(0, position / 1000);
        } else {
          capture.transportChanged();
          host.seek(Math.min(host.duration(), request.positionMs));
        }
        break;
      case "volume":
        if (element) element.volume = request.volume / 100;
        host.setVolume(request.volume / 100);
        setVolume(request.volume / 100);
    }
  }, [audioForSong, capture, current?.uri, host, notify, previewing, read, view]);

  const toggle = useCallback(() => {
    const element = audioForSong && audioElement.current;
    player({ command: (element ? !element.paused : host.playing()) ? "pause" : "play" });
  }, [audioForSong, host, player]);
  const togglePlayback = useRef(toggle);
  useLayoutEffect(() => { togglePlayback.current = toggle; }, [toggle]);

  const stopLocalForSpotify = useCallback(() => {
    audioLoad.current++;
    audioElement.current?.pause();
    setSpotifyOnly(current?.uri);
    setAudio(undefined);
  }, [current?.uri]);

  const handlesSpace = !previewing || !!audioForSong;
  useLayoutEffect(() => {
    if (!handlesSpace) return;
    let spaceDown = false;
    function onSpace(event: KeyboardEvent) {
      if (event.code !== "Space" && event.key !== " ") return;
      const keydown = event.type === "keydown";
      // Spotify can consume keydown before Creator sees it. A lone keyup
      // can still control local audio without toggling Spotify twice.
      const toggleNow = keydown ? !event.repeat : !spaceDown && !!audioElement.current;
      spaceDown = keydown;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;

      const target = event.composedPath()[0];
      if (previewing && target instanceof view.Element && target.closest("button, a[href], input, select, textarea, [contenteditable]")) return;
      event.stopImmediatePropagation();
      if (target instanceof view.Element && target.closest(
        "textarea, input:is(:not([type]), [type='text'], [type='search'], [type='number'], [type='password'], [type='email'], [type='url'], [type='tel']), [contenteditable]:not([contenteditable='false'])",
      )) return;

      event.preventDefault();
      if (toggleNow) togglePlayback.current();
    }

    const resetSpace = () => { spaceDown = false; };
    view.addEventListener("keydown", onSpace, true);
    view.addEventListener("keyup", onSpace, true);
    view.addEventListener("blur", resetSpace);
    return () => {
      view.removeEventListener("keydown", onSpace, true);
      view.removeEventListener("keyup", onSpace, true);
      view.removeEventListener("blur", resetSpace);
    };
  }, [handlesSpace, previewing, view]);

  const playClip = useCallback((uri: string, from: number, end: number) => {
    if (uri !== current?.uri || end <= from) return;
    const replay = audioForSong?.replay;
    if (replay) {
      from = Math.max(from, replay.startMs);
      end = Math.min(end, replay.endMs);
      if (end <= from) { notify("That timing is outside the captured section.", true); return; }
    }
    player({ command: "seek", positionMs: from });
    player({ command: "play" });
    clip.current = { uri, end, from, started: false, expires: Date.now() + 4_000 + (end - from) / Math.max(0.25, rate) };
  }, [audioForSong?.replay, current?.uri, notify, player, rate]);

  useEffect(() => {
    if (previewing) return;
    const timer = view.setInterval(() => {
      const active = clip.current;
      if (!active) return;
      if (active.uri !== current?.uri) { clip.current = undefined; return; }
      const position = read();
      if (position >= active.from - 50 && position < active.end) active.started = true;
      if ((active.started && position >= active.end) || Date.now() >= active.expires) {
        clip.current = undefined;
        player({ command: "pause" });
        if (active.started) player({ command: "seek", positionMs: active.end });
      }
    }, 20);
    return () => view.clearInterval(timer);
  }, [current?.uri, player, previewing, read, view]);
  const returnToSpotify = useCallback(() => {
    returningToSpotify.current = true;
    const element = audioElement.current;
    const track = host.track();
    const uri = track && spotifySongUri(track.id);
    if (element?.hasAttribute("data-captured-replay") && !element.hasAttribute("data-full-recording")) {
      element.pause();
    } else if (element?.dataset.trackUri === uri) {
      const resume = !clip.current && !element.paused;
      element.pause();
      host.seek(Math.min(Math.max(0, host.duration() - 1), Math.round(element.currentTime * 1000)));
      if (resume && !host.playing()) host.toggle();
    } else if (clip.current?.uri === uri && host.playing()) {
      host.toggle();
    }
    audioLoad.current++;
    clip.current = undefined;
  }, [host]);
  useLayoutEffect(() => returnToSpotify, [returnToSpotify]);
  const releaseAudio = useCallback(() => {
    setSpotifyOnly(current?.uri);
    returnToSpotify();
    setAudio(undefined);
  }, [current?.uri, returnToSpotify]);
  const playback = useMemo<CreatorPlayback | undefined>(() => audioForSong && current ? {
    trackId: current.id, playing: isPlaying, read, toggle, returnToSpotify: audioForSong.replay ? releaseAudio : undefined,
    seek: (positionMs) => player({ command: "seek", positionMs }),
  } : undefined, [audioForSong, current?.id, isPlaying, player, read, toggle, releaseAudio]);
  useLayoutEffect(() => {
    if (!playback) return;
    onLocalPlayback(playback);
    return () => onLocalPlayback(undefined);
  }, [playback, onLocalPlayback]);
  usePreviewTransport(view, host, previewing ? playback : undefined, stopLocalForSpotify);

  const setSpeed = useCallback(async (speed: number) => {
    if (!audioElement.current || !audioForSong) return;
    audioElement.current.playbackRate = speed;
    setRate(speed);
  }, [audioForSong]);

  const activateRecording = useCallback((uri: string, replay: SavedRecording, speed: number, resume: boolean, position: number) => {
    capture.transportChanged();
    clip.current = undefined;
    if (previewing && host.playing()) host.toggle();
    const { blob, startMs, endMs, full } = replay;
    const positionMs = full ? Math.max(0, Math.min(position, endMs)) : position >= startMs && position < endMs - 500 ? position : startMs;
    setAudio({ uri, url: URL.createObjectURL(blob), replay: { startMs, endMs, positionMs, speed, resume, full } });
  }, [capture, host, previewing]);

  useEffect(() => {
    const uri = current?.uri;
    if (previewing || !uri || !fullRecording || spotifyOnly === uri || audioForSong || deletingRecording ||
      activeUri.current !== uri || current.id !== host.track()?.id) return;
    const position = host.position();
    const resume = host.playing() && position < fullRecording.endMs - 100;
    activateRecording(uri, fullRecording, 1, resume, position);
  }, [activateRecording, audioForSong, current?.uri, deletingRecording, fullRecording, host, previewing, spotifyOnly]);

  async function replayCaptured(speed: number) {
    if (!current || current.id !== host.track()?.id) return;
    const generation = ++audioLoad.current;
    const position = host.position();
    const reportError = previewing ? host.notifyError : (message: string) => notify(message, true);
    let replay: Awaited<ReturnType<typeof captured.read>>;
    try { replay = await captured.read(current.uri, position, duration); }
    catch {
      if (generation === audioLoad.current && activeUri.current === current.uri) reportError("Couldn’t open the saved recording.");
      return;
    }
    if (generation !== audioLoad.current || activeUri.current !== current.uri || current.id !== host.track()?.id) return;
    if (!replay) { reportError("Share Spotify audio and play the section first."); return; }
    activateRecording(current.uri, replay, speed, !previewing || host.playing(), position);
  }

  async function removeRecording() {
    if (!current || recordingAudio || deletingRecording) return;
    const uri = current.uri;
    audioLoad.current++;
    setDeletingRecording(true);
    if (audioForSong?.replay) releaseAudio();
    try {
      await captured.remove(uri);
      if (activeUri.current === uri) {
        setCompleteAudio(undefined);
        setRecorded(undefined);
      }
    } catch {
      if (activeUri.current === uri) notify("Couldn’t delete the saved recording.", true);
    } finally {
      setDeletingRecording(false);
    }
  }

  async function exportAudio(format: RecordingFormat) {
    if (!track || !current || !recordingExportEnabled()) return;
    const recording = fullRecording ?? await captured.read(current.uri, read(), duration);
    if (!recording) throw new Error("There’s no saved section to export.");
    const writers = seed?.uri === current.uri ? seed.lyrics?.songwriters : undefined;
    await exportSavedAudio(host, track, recording, format, writers);
  }

  const waveform = useCallback((uri: string, buckets: number) => creatorWaveform(host, uri, buckets,
    audio?.uri === uri ? audio.buffer : undefined), [host, audio]);
  const spectrogram = useCallback(async (uri: string, from: number, to: number, columns: number, rows: number, signal: AbortSignal) => {
    if (audio?.uri === uri && audio.buffer) return creatorSpectrum(audio.buffer, from, to, columns, rows, signal);
    return creatorPitchSpectrum(host, uri, from, to, columns, signal);
  }, [host, audio]);

  async function pickAudio(file: File) {
    if (!current) return;
    const generation = ++audioLoad.current;
    try {
      const context = new view.AudioContext();
      let buffer: AudioBuffer;
      try { buffer = await context.decodeAudioData(await file.arrayBuffer()); }
      finally { void context.close().catch(() => {}); }
      if (generation !== audioLoad.current) return;
      setAudio({ uri: current.uri, url: URL.createObjectURL(file), name: file.name, buffer });
    } catch {
      if (generation === audioLoad.current) notify("Couldn’t decode this audio file.", true);
    }
  }

  useLayoutEffect(() => {
    const cleared = (event: Event) => {
      const uri = (event as CustomEvent<string | undefined>).detail;
      if (uri && uri !== activeUri.current) return;
      audioCacheGeneration.current++;
      audioLoad.current++;
      setCompleteAudio(undefined);
      setRecorded(undefined);
      if (audioForSong?.replay) {
        returnToSpotify();
        setAudio(undefined);
      }
      setSpotifyOnly(undefined);
    };
    window.addEventListener(savedAudioCleared, cleared);
    return () => window.removeEventListener(savedAudioCleared, cleared);
  }, [audioForSong, returnToSpotify]);

  const state: CreatorState = {
    settings: {
      lyric_offset_ms: settings.lyric_offset_ms + (track ? settings.lyric_song_offsets[track.id] ?? 0 : 0),
      reduce_motion: settings.reduce_motion,
      romaji_as_written: settings.romaji_as_written,
    },
    playback: { item: current, is_playing: isPlaying, volume: volume * 100 },
    playback_rate: audioForSong ? rate : 1, speedEnabled: !!audioForSong,
    lyrics: seed?.uri === current?.uri ? seed?.lyrics : undefined, lyrics_uri: seed?.uri,
    lyrics_pending: !!current && seed?.uri !== current.uri,
  };

  return <div className={`lyssna-creator-surface${settings.reduce_motion ? " reduce-motion" : ""}`} ref={setRoot}>
    <style>{`${css}\n${meterCss}`}</style>
    <input type="file" ref={picker} hidden accept="audio/*,.wav,.flac,.mp3,.m4a,.ogg,.opus" onChange={(event) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (file) void pickAudio(file);
    }} />
    {audioForSong?.name && <div className="lyssna-creator-tools">
      <button type="button" onClick={releaseAudio} title="Return to Spotify playback">{audioForSong.name} <X size={13} /></button>
    </div>}
    {audioForSong && <audio key={audioForSong.url} ref={audioElement} src={audioForSong.url} data-track-uri={audioForSong.uri}
      data-captured-replay={audioForSong.replay ? "" : undefined}
      data-full-recording={audioForSong.replay?.full ? "" : undefined}
      onPlay={() => setLocalPlaying(true)} onPause={() => setLocalPlaying(false)} onEnded={(event) => {
        setLocalPlaying(false);
        if (!audioForSong.replay?.full) return;
        if (host.repeat() === "track") {
          event.currentTarget.currentTime = 0;
          if (previewing) void event.currentTarget.play().catch(() => {});
        } else if (previewing && current?.id === host.track()?.id) {
          stopLocalForSpotify();
          host.next();
        }
      }} />}
    <div className="lyssna-creator-body">
      {root && portal && <CreatorEnvironment.Provider value={{ root, portal, view, read, capture, waveform, spectrogram,
        recording: current ? {
          percent: recordedPercent ?? 0, sharing: recordingAudio, deleting: deletingRecording, remove: removeRecording, exportAudio,
          message: captureState.message || undefined,
          start: !recordingAudio && !audioForSong && recordedPercent !== 100 ? () => void capture.start(current.uri) : undefined,
          stop: recordingAudio ? () => void capture.stop() : undefined,
          skipToMissing: !audioForSong && recordedPercent && recordedPercent < 100
            ? () => capture.skipToMissing(current.uri) : undefined,
          returnToSpotify: audioForSong?.replay ? releaseAudio : undefined,
        } : undefined,
        playingFullRecording: !!audioForSong?.replay?.full,
        replayAvailable: !deletingRecording && !!saved && saved.frames >= saved.sampleRate / 2, replayCaptured,
        spectrumKey: audio?.buffer ? audio.url : "spotify", spectrumAudioUri: audio?.buffer ? audio.uri : undefined,
        openAudio, playClip, manageStoredData }}>
        <TtmlCreator host={host} state={state} onPlayer={player} onToggle={toggle} draftPreview={previewing}
          onSpeed={setSpeed} notify={notify} barSlot={previewing ? undefined : playbar?.wave ?? bar} playbar={playbar}
          onClose={close}
          onSubmitted={onSubmitted}
          reviewSelection={reviewSelection}
          onCloseReview={closeReview}
          localIsrc={localIsrc}
          instrumentalAction={track && !track.local && seed?.uri === current?.uri &&
            !seed?.lyrics?.lines.length && !seed?.lyrics?.instrumental
            ? <InstrumentalAction key={track.id} track={track} host={host} notify={notify} />
            : undefined}
          onResetToSource={async (song) => {
            if (track?.id !== song.id || host.track()?.id !== song.id) return;
            const sources = enabledSources(settings).filter(source => source !== "local");
            const lyrics = await currentCreatorLyrics(host, track, duration, sources);
            if (!lyrics) return;
            const seeded = await seedTimings(host, lyrics, duration, song.id).catch(() => lyrics);
            if (host.track()?.id === song.id) return seeded;
          }}
          onParse={async (filename, text, song) => {
            const ms = song?.duration_ms ?? 0;
            const lyrics = /\.lrc$/i.test(filename)
              ? fromLrc("Imported LRC", text, text.replace(/^\s*\[[a-z]+:[^\]\r\n]*\][\t ]*$/gim, ""), ms)
              : parseLocalTtml(text);
            if (!lyrics) throw new Error("No lyric lines found.");
            return seedTimings(host, lyrics, ms, song?.id);
          }}
          onApply={async (song, _filename, text) => {
            try {
              await saveLocalLyrics([{ uri: song.uri, kind: "ttml", text, name: song.name,
                artists: song.artists.map(({ name }) => name).join(", "), image: song.album.images[0]?.url }]);
              dismissDraft(song.uri);
              notify("Lyrics saved for this song.");
              return true;
            } catch (why) { notify(String(why), true); return false; }
          }}
          onSubmit={async (song, text, appleOriginal) => {
            const spotify: SpotifyTrack = song.spotify ?? { id: song.id, local: song.is_local ? true : undefined, title: song.name, cover: song.album.images[0]?.url ?? "",
              album: song.album.name, artists: song.artists.map(({ name }) => name).join(", "), artistLinks: song.artists };
            const target = song.is_local && current?.uri === song.uri ? { ...spotify, isrc: localIsrc } : spotify;
            const result = await submitLyssnaTtml(new File([text], "lyrics.ttml"), target, host, confirmFirstUpload, appleOriginal);
            if (!result) return;
            if (result.approved) refreshPublishedLyrics(target, result.isrc, result.published);
            return result;
          }}
          renderPreview={(lyrics, position, song) => {
            const cover = current?.uri === song.uri ? track?.cover : song.album.images[0]?.url;
            const artwork = !settings.lyrics_hide_artwork && !settings.lyrics_compact;
            return <div className={`lyssna-creator-preview${settings.lyrics_artwork_right ? " artwork-right" : ""}`}>
              {cover && (settings.lyrics_background === "animated" || settings.lyrics_background === "static") &&
                <Ambience image={cover} animate={isPlaying && settings.lyrics_background === "animated"}
                  reduceMotion={settings.reduce_motion} brightness={settings.lyrics_background_brightness} />}
              {artwork && <div className="lyssna-creator-preview-album">
                <TrackArtwork key={cover || song.id} src={cover} /><strong>{song.name}</strong><span>{song.artists.map(({ name }) => name).join(", ")}</span>
              </div>}
              <div className="lyssna-creator-preview-lines">
                <LyricsDisplay lyrics={lyrics} positionMs={position} playing={isPlaying} settings={{ ...settings, reduce_motion: true }}
                  onSeek={(positionMs) => {
                    const offset = state.settings.lyric_offset_ms;
                    const target = Math.max(0, positionMs - offset);
                    player({ command: "seek", positionMs: target });
                    return target + offset;
                  }} />
              </div>
            </div>;
          }} />
      </CreatorEnvironment.Provider>}
    </div>
    {!previewing && !playbar && <div className="lyssna-creator-transport" ref={setBar} />}
    <div className="lyssna-creator-portals" ref={setPortal} />
    {notice && <p className="lyssna-creator-notice" role={notice.error ? "alert" : "status"}>{notice.message}</p>}
  </div>;
}
