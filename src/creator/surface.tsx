import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import type { Host, Track as SpotifyTrack } from "../host";
import type { Settings } from "../settings";
import { usePlayback } from "../playback";
import { enabledSources, type LyricSource } from "../lyric-sources";
import { lyricsChanged, parseLocalTtml, saveLocalLyrics } from "../local-lyrics";
import { displayLyrics, needsWordSync } from "../word-sync";
import type { Lyrics } from "../lyssna/types";
import { LyricsDisplay } from "../lyssna/renderer";
import { Ambience } from "../lyssna/ambience";
import { fromLrc } from "../lrc";
import { submitLyssnaTtml } from "../lyssna-submission";
import { revalidateLyssnaSong } from "../lyssna-provider";
import { lyssnaInstallReady } from "../lyssna-api";
import { CreatorEnvironment } from "./environment";
import { couldBeComplete, recordedCoverage, recordingPercent, savedAudioCleared, type RecordingCoverage, type SavedRecording } from "./captured-replay";
import { recordedAudioSaved, type SpotifyCapture } from "./spotify-capture";
import { downloadRecording, recordingExportEnabled, type RecordingFormat } from "./recording-export";
import { readRecordingMetadata } from "./recording-metadata";
import { useCreatorPlaybar, usePreviewTransport } from "./playbar";
import { useCreatorRepeat } from "./repeat";
import { creatorPitchSpectrum, creatorSpectrum, creatorWaveform } from "./audio";
import { TtmlCreator } from "./ttml-creator";
import { currentCreatorLyrics, within } from "./current-lyrics";
import { dismissDraft } from "./ttml-working";
import type { CreatorState, PlayerRequest, Track } from "./types";
import { formatTime } from "./ttml-creator-model";
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
};

function creatorTrack(track: SpotifyTrack, duration: number): Track {
  return { id: track.id, uri: `spotify:track:${track.id}`, name: track.title,
    artists: track.artistLinks?.length ? track.artistLinks : track.artists ? [{ name: track.artists }] : [],
    album: { name: track.album, images: track.cover ? [{ url: track.cover }] : [] }, duration_ms: duration, spotify: track };
}

async function seedTimings(host: Host, lyrics: Lyrics, duration: number, trackId?: string) {
  if (!lyrics.synced || !needsWordSync(lyrics, duration)) return lyrics;
  const analysis = trackId ? await within(Promise.resolve().then(() => host.analysis(trackId)), 1500) : undefined;
  return displayLyrics(lyrics, true, false, duration, analysis ? {
    track: analysis.track, segments: analysis.segments ?? [], beats: analysis.beats ?? [],
  } : undefined) ?? lyrics;
}

export function CreatorSurface({ host, view: owner, settings, close, closeReview, previewing, onLocalPlayback, manageStoredData, capture }: {
  host: Host; view: Window; settings: Settings; close: () => void; previewing: boolean;
  capture: SpotifyCapture;
  closeReview?: () => void;
  onLocalPlayback(playback: CreatorPlayback | undefined): void; manageStoredData(trigger: HTMLElement | null): void;
}) {
  const view = owner as Window & typeof globalThis;
  const { track, playing } = usePlayback(host);
  const duration = host.duration();
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
  const picker = useRef<HTMLInputElement>(null);
  const openAudio = useCallback(() => picker.current?.click(), []);
  const audioLoad = useRef(0);
  const audioCacheGeneration = useRef(0);
  const clip = useRef<{ uri: string; end: number; from: number; expires: number; started: boolean }>(undefined);
  const audioForSong = audio?.uri === current?.uri ? audio : undefined;
  useLayoutEffect(() => {
    if (!audioForSong) return;
    capture.setLocalAudio(true);
    return () => capture.setLocalAudio(false);
  }, [capture, audioForSong]);
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
  useLayoutEffect(() => { if (previewing) clip.current = undefined; }, [previewing]);

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
      setSeed({ uri: `spotify:track:${track.id}`, lyrics: skeleton });
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
    const adjusted = raw + (isPlaying && at !== undefined ? (at - now) * (element ? element.playbackRate : 1) : 0);
    return Math.max(0, Math.min(adjusted, audioForSong?.replay?.endMs ?? Infinity));
  }, [audioForSong, host, isPlaying, view]);

  const player = useCallback((request: PlayerRequest) => {
    const element = audioForSong && audioElement.current;
    switch (request.command) {
      case "play":
        if (request.uri && request.uri !== current?.uri) {
          element && element.pause();
          void host.playTrack(request.uri).catch((why) => notify(String(why), true));
        } else if (element) {
          if (host.playing()) host.toggle();
          if (element.ended || element.currentTime >= element.duration) element.currentTime = 0;
          void element.play().catch((why) => notify(String(why), true));
        } else if (!host.playing()) host.toggle();
        break;
      case "pause":
        clip.current = undefined;
        if (element) element.pause();
        else if (host.playing()) {
          capture.transportChanged();
          host.toggle();
        }
        break;
      case "seek":
        clip.current = undefined;
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
  }, [audioForSong, capture, current?.uri, host, notify]);

  const toggle = useCallback(() => {
    const element = audioForSong && audioElement.current;
    player({ command: (element ? !element.paused : host.playing()) ? "pause" : "play" });
  }, [audioForSong, host, player]);

  const playback = useMemo<CreatorPlayback | undefined>(() => audioForSong && current ? {
    trackId: current.id, playing: isPlaying, read, toggle,
    seek: (positionMs) => player({ command: "seek", positionMs }),
  } : undefined, [audioForSong, current?.id, isPlaying, player, read, toggle]);
  useLayoutEffect(() => {
    if (!playback) return;
    onLocalPlayback(playback);
    return () => onLocalPlayback(undefined);
  }, [playback, onLocalPlayback]);
  const stopLocalForSpotify = useCallback(() => {
    audioLoad.current++;
    audioElement.current?.pause();
    setSpotifyOnly(current?.uri);
    setAudio(undefined);
  }, [current?.uri]);
  usePreviewTransport(view, host, previewing ? playback : undefined, stopLocalForSpotify);

  useLayoutEffect(() => {
    if (previewing && !audioForSong) return;
    function onSpace(event: KeyboardEvent) {
      if ((event.code !== "Space" && event.key !== " ") || event.altKey || event.ctrlKey ||
        event.metaKey || event.shiftKey || event.isComposing) return;

      const target = event.composedPath()[0];
      if (previewing && target instanceof view.Element && target.closest("button, a[href], input, select, textarea, [contenteditable]")) return;
      event.stopImmediatePropagation();
      if (target instanceof view.Element && target.closest(
        "textarea, input:is(:not([type]), [type='text'], [type='search'], [type='number'], [type='password'], [type='email'], [type='url'], [type='tel']), [contenteditable]:not([contenteditable='false'])",
      )) return;

      event.preventDefault();
      if (event.type === "keydown" && !event.repeat) toggle();
    }

    view.addEventListener("keydown", onSpace, true);
    view.addEventListener("keyup", onSpace, true);
    return () => {
      view.removeEventListener("keydown", onSpace, true);
      view.removeEventListener("keyup", onSpace, true);
    };
  }, [audioForSong, previewing, toggle, view]);

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
    const element = audioElement.current;
    const uri = `spotify:track:${host.track()?.id}`;
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

  const setSpeed = useCallback(async (speed: number) => {
    if (!audioElement.current || !audioForSong) return;
    audioElement.current.playbackRate = speed;
    setRate(speed);
  }, [audioForSong]);

  const activateRecording = useCallback((uri: string, replay: SavedRecording, speed: number, resume: boolean, position: number) => {
    capture.transportChanged();
    clip.current = undefined;
    if (host.playing()) host.toggle();
    const { blob, startMs, endMs, full } = replay;
    const positionMs = full ? Math.max(0, Math.min(position, endMs)) : position >= startMs && position < endMs - 500 ? position : startMs;
    setAudio({ uri, url: URL.createObjectURL(blob), replay: { startMs, endMs, positionMs, speed, resume, full } });
  }, [capture, host]);

  useEffect(() => {
    const uri = current?.uri;
    if (previewing || !uri || !fullRecording || spotifyOnly === uri || audioForSong || deletingRecording ||
      activeUri.current !== uri || uri !== `spotify:track:${host.track()?.id}`) return;
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
    const metadata = await readRecordingMetadata(host, track, writers);
    const title = [metadata.tags.find(({ name }) => name === "TITLE")?.value,
      metadata.tags.find(({ name }) => name === "ARTIST")?.value].filter(Boolean).join(" - ");
    const name = recording.full ? title : `${title} [${formatTime(recording.startMs)}–${formatTime(recording.endMs)}]`;
    await downloadRecording(recording.blob, name, format, metadata);
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

  function releaseAudio() {
    setSpotifyOnly(current?.uri);
    returnToSpotify();
    setAudio(undefined);
  }

  useLayoutEffect(() => {
    const cleared = () => {
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
    settings: { lyric_offset_ms: settings.lyric_offset_ms + (track ? settings.lyric_song_offsets[track.id] ?? 0 : 0), reduce_motion: settings.reduce_motion },
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
        recording: recordingAudio || recordedPercent !== undefined ? {
          percent: recordedPercent ?? 0, sharing: recordingAudio, deleting: deletingRecording, remove: removeRecording, exportAudio,
          returnToSpotify: audioForSong?.replay ? releaseAudio : undefined,
        } : undefined,
        playingFullRecording: !!audioForSong?.replay?.full,
        replayAvailable: !deletingRecording && !!saved && saved.frames >= saved.sampleRate / 2, replayCaptured,
        spectrumKey: audio?.buffer ? audio.url : "spotify", spectrumAudioUri: audio?.buffer ? audio.uri : undefined,
        openAudio, playClip, manageStoredData }}>
        <TtmlCreator state={state} onPlayer={player} onToggle={toggle} draftPreview={previewing}
          onSpeed={setSpeed} notify={notify} barSlot={previewing ? undefined : playbar?.wave ?? bar} playbar={playbar}
          onClose={close}
          onCloseReview={closeReview}
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
          onSubmit={async (song, text) => {
            const spotify = song.spotify ?? { id: song.id, title: song.name, cover: song.album.images[0]?.url ?? "",
              album: song.album.name, artists: song.artists.map(({ name }) => name).join(", "), artistLinks: song.artists };
            const result = await submitLyssnaTtml(new File([text], "lyrics.ttml"), spotify, host);
            if (result.approved) {
              revalidateLyssnaSong(song.id, result.isrc, result.published);
              window.dispatchEvent(new CustomEvent(lyricsChanged, { detail: [song.id] }));
            }
            return result.message;
          }}
          renderPreview={(lyrics, position, song) => {
            const cover = song.album.images[0]?.url;
            const artwork = cover && !settings.lyrics_hide_artwork && !settings.lyrics_compact;
            return <div className={`lyssna-creator-preview${settings.lyrics_artwork_right ? " artwork-right" : ""}`}>
              {cover && (settings.lyrics_background === "animated" || settings.lyrics_background === "static") &&
                <Ambience image={cover} animate={isPlaying && settings.lyrics_background === "animated"}
                  reduceMotion={settings.reduce_motion} brightness={settings.lyrics_background_brightness} />}
              {artwork && <div className="lyssna-creator-preview-album">
                <img src={cover} alt="" /><strong>{song.name}</strong><span>{song.artists.map(({ name }) => name).join(", ")}</span>
              </div>}
              <div className="lyssna-creator-preview-lines">
                <LyricsDisplay lyrics={lyrics} positionMs={position} playing={isPlaying} settings={settings}
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
