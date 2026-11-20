import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Headphones, X } from "lucide-react";
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
import { createCapturedReplay, recordedFrames, replaySampleRate } from "./captured-replay";
import { useCreatorPlaybar } from "./playbar";
import { creatorPitchSpectrum, creatorSpectrum, creatorWaveform } from "./audio";
import { TtmlCreator } from "./ttml-creator";
import { currentCreatorLyrics, within } from "./current-lyrics";
import { dismissDraft } from "./ttml-working";
import type { CreatorState, PlayerRequest, Track } from "./types";
import { formatTime } from "./ttml-creator-model";
import css from "./ttml-creator.css?inline";

type EditorAudio = {
  uri: string;
  url: string;
  name: string;
  buffer?: AudioBuffer;
  replay?: { startMs: number; endMs: number; positionMs: number; speed: number };
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

export function CreatorSurface({ host, view: owner, settings, close }: { host: Host; view: Window; settings: Settings; close: () => void }) {
  const view = owner as Window & typeof globalThis;
  const { track, playing } = usePlayback(host);
  const duration = host.duration();
  const current = useMemo(() => track ? creatorTrack(track, duration) : undefined, [track, duration]);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  const playbar = useCreatorPlaybar(view, !!current, settings.reduce_motion);
  const [seed, setSeed] = useState<{ uri: string; lyrics?: Lyrics }>();
  const [notice, setNotice] = useState<{ message: string; error: boolean }>();
  const [audio, setAudio] = useState<EditorAudio>();
  const [recorded, setRecorded] = useState<{ uri: string; frames: number }>();
  const [recordingAudio, setRecordingAudio] = useState(false);
  const [deletingRecording, setDeletingRecording] = useState(false);
  const activeUri = useRef<string | undefined>(undefined);
  const recordingError = useRef(false);
  const replaying = useRef(false);
  const [localPlaying, setLocalPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(host.volume);
  const audioElement = useRef<HTMLAudioElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const openAudio = useCallback(() => picker.current?.click(), []);
  const audioLoad = useRef(0);
  const transportRevision = useRef(0);
  const clip = useRef<{ uri: string; end: number; from: number; expires: number; started: boolean }>(undefined);
  const audioForSong = audio?.uri === current?.uri ? audio : undefined;
  const isPlaying = audioForSong ? localPlaying : playing;
  const readCapturePosition = useCallback((uri: string) => {
    if (!replaying.current && host.playing() && !host.djNarrating() && uri === `spotify:track:${host.track()?.id}`) {
      return { ms: host.position(), transportRevision: transportRevision.current, volume: host.volume() };
    }
  }, [host]);
  const notify = useCallback((message: string, error = false) => setNotice({ message, error }), []);
  const [captured] = useState(() => createCapturedReplay(
    (uri, frames) => { if (activeUri.current === uri) setRecorded({ uri, frames }); },
    () => {
      if (recordingError.current || !activeUri.current) return;
      recordingError.current = true;
      notify("Couldn’t save all recorded audio. Check Spotify’s local storage space.", true);
    },
  ));
  const savedFrames = recorded?.uri === current?.uri ? recorded?.frames ?? 0 : 0;
  const recordedPercent = savedFrames > 0 && duration > 0
    ? Math.max(1, Math.min(100, Math.round(100 * savedFrames / (duration * replaySampleRate / 1000)))) : undefined;

  useLayoutEffect(() => {
    activeUri.current = current?.uri;
    replaying.current = false;
    audioLoad.current++;
    setAudio((entry) => entry?.replay && entry.uri !== current?.uri ? undefined : entry);
    return () => { activeUri.current = undefined; void captured.flush(); };
  }, [captured, current?.uri]);
  useEffect(() => {
    const uri = current?.uri;
    if (!uri) return;
    let live = true;
    void recordedFrames(uri).then((frames) => {
      if (live) setRecorded((previous) => ({ uri, frames: Math.max(previous?.uri === uri ? previous.frames : 0, frames) }));
    }).catch(() => {});
    return () => { live = false; };
  }, [current?.uri]);

  const recordingChanged = useCallback((recording: boolean) => {
    if (recording) recordingError.current = false;
    setRecordingAudio(recording);
  }, []);

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
    if (replay) void element.play().catch((error) => {
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
          if (element.ended) element.currentTime = 0;
          void element.play().catch((why) => notify(String(why), true));
        } else if (!host.playing()) host.toggle();
        break;
      case "pause":
        clip.current = undefined;
        if (element) element.pause();
        else if (host.playing()) {
          transportRevision.current++;
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
          transportRevision.current++;
          host.seek(Math.min(host.duration(), request.positionMs));
        }
        break;
      case "repeat":
        void Promise.resolve(host.setRepeat(request.repeat)).catch(() => {});
        break;
      case "volume":
        if (element) element.volume = request.volume / 100;
        host.setVolume(request.volume / 100);
        setVolume(request.volume / 100);
    }
  }, [audioForSong, current?.uri, host, notify]);

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
  }, [current?.uri, player, read, view]);
  const returnToSpotify = useCallback(() => {
    const element = audioElement.current;
    const uri = `spotify:track:${host.track()?.id}`;
    if (element?.hasAttribute("data-captured-replay")) {
      element.pause();
    } else if (element?.dataset.trackUri === uri) {
      const resume = !clip.current && !element.paused;
      element.pause();
      host.seek(Math.round(element.currentTime * 1000));
      if (resume && !host.playing()) host.toggle();
    } else if (clip.current?.uri === uri && host.playing()) {
      host.toggle();
    }
    audioLoad.current++;
    replaying.current = false;
    clip.current = undefined;
  }, [host]);
  useLayoutEffect(() => returnToSpotify, [returnToSpotify]);

  const setSpeed = useCallback(async (speed: number) => {
    if (!audioElement.current || !audioForSong) return;
    audioElement.current.playbackRate = speed;
    setRate(speed);
  }, [audioForSong]);
  async function replayCaptured(speed: number) {
    if (!current || current.id !== host.track()?.id) return;
    const generation = ++audioLoad.current;
    const position = host.position();
    let replay: Awaited<ReturnType<typeof captured.read>>;
    try { replay = await captured.read(current.uri, position, duration); }
    catch {
      if (generation === audioLoad.current && activeUri.current === current.uri) notify("Couldn’t open the saved recording.", true);
      return;
    }
    if (generation !== audioLoad.current || activeUri.current !== current.uri || current.id !== host.track()?.id) return;
    if (!replay) { notify("Share Spotify audio and play the section first.", true); return; }
    transportRevision.current++;
    replaying.current = true;
    clip.current = undefined;
    if (host.playing()) host.toggle();
    const { blob, startMs, endMs } = replay;
    const positionMs = position >= startMs && position < endMs - 500 ? position : startMs;
    const name = `Saved audio · ${formatTime(startMs)}–${formatTime(endMs)}`;
    setAudio({ uri: current.uri, url: URL.createObjectURL(blob), name, replay: { startMs, endMs, positionMs, speed } });
  }

  async function removeRecording() {
    if (!current || recordingAudio || deletingRecording) return;
    const uri = current.uri;
    audioLoad.current++;
    setDeletingRecording(true);
    if (audioForSong?.replay) releaseAudio();
    try {
      await captured.remove(uri);
      if (activeUri.current === uri) setRecorded({ uri, frames: 0 });
    } catch {
      if (activeUri.current === uri) notify("Couldn’t delete the saved recording.", true);
    } finally {
      setDeletingRecording(false);
    }
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
      replaying.current = false;
      setAudio({ uri: current.uri, url: URL.createObjectURL(file), name: file.name, buffer });
    } catch {
      if (generation === audioLoad.current) notify("Couldn’t decode this audio file.", true);
    }
  }

  function releaseAudio() {
    returnToSpotify();
    setAudio(undefined);
  }

  const state: CreatorState = {
    settings: { lyric_offset_ms: settings.lyric_offset_ms + (track ? settings.lyric_song_offsets[track.id] ?? 0 : 0), reduce_motion: settings.reduce_motion },
    playback: { item: current, is_playing: isPlaying, repeat_state: host.repeat(), volume: volume * 100 },
    playback_rate: audioForSong ? rate : 1, speedEnabled: !!audioForSong,
    lyrics: seed?.uri === current?.uri ? seed?.lyrics : undefined, lyrics_uri: seed?.uri,
    lyrics_pending: !!current && seed?.uri !== current.uri,
  };

  return <div className={`lyssna-creator-surface${settings.reduce_motion ? " reduce-motion" : ""}`} ref={setRoot}>
    <style>{css}</style>
    <div className="lyssna-creator-tools">
      <button type="button" className="icon-button" title="Open local audio for speed and spectrogram" aria-label="Open local audio"
        disabled={!current} onClick={openAudio}><Headphones size={17} /></button>
      <input type="file" ref={picker} hidden accept="audio/*,.wav,.flac,.mp3,.m4a,.ogg,.opus" onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file) void pickAudio(file);
      }} />
      {audioForSong && <button type="button" onClick={releaseAudio} title="Return to Spotify playback">{audioForSong.name} <X size={13} /></button>}
      {recordedPercent !== undefined && <small>{recordedPercent}% recorded on this device</small>}
      {recordedPercent !== undefined && !recordingAudio && <button type="button" disabled={deletingRecording}
        onClick={() => void removeRecording()}>Delete recording</button>}
    </div>
    {audioForSong && <audio key={audioForSong.url} ref={audioElement} src={audioForSong.url} data-track-uri={audioForSong.uri}
      data-captured-replay={audioForSong.replay ? "" : undefined}
      onPlay={() => setLocalPlaying(true)} onPause={() => setLocalPlaying(false)} onEnded={() => setLocalPlaying(false)} />}
    <div className="lyssna-creator-body">
      {root && portal && <CreatorEnvironment.Provider value={{ root, portal, view, read, readCapturePosition, waveform, spectrogram,
        appendReplay: captured.append, flushReplay: captured.flush, setRecordingAudio: recordingChanged,
        replayAvailable: !deletingRecording && savedFrames >= replaySampleRate / 2, replayCaptured,
        spectrumKey: audio?.buffer ? audio.url : "spotify", spectrumAudioUri: audio?.buffer ? audio.uri : undefined,
        openAudio, playClip }}>
        <TtmlCreator state={state} onPlayer={player} onToggle={() => player({ command: isPlaying ? "pause" : "play" })}
          onSpeed={setSpeed} notify={notify} barSlot={playbar?.wave ?? bar} playbar={playbar}
          onClose={close}
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
                <Ambience image={cover} animate={isPlaying && settings.lyrics_background === "animated"} reduceMotion={settings.reduce_motion} />}
              {artwork && <div className="lyssna-creator-preview-album">
                <img src={cover} alt="" /><strong>{song.name}</strong><span>{song.artists.map(({ name }) => name).join(", ")}</span>
              </div>}
              <div className="lyssna-creator-preview-lines">
                <LyricsDisplay lyrics={lyrics} positionMs={position} settings={settings}
                  onSeek={(positionMs) => player({ command: "seek", positionMs: Math.max(0, positionMs - state.settings.lyric_offset_ms) })} />
              </div>
            </div>;
          }} />
      </CreatorEnvironment.Provider>}
    </div>
    {!playbar && <div className="lyssna-creator-transport" ref={setBar} />}
    <div className="lyssna-creator-portals" ref={setPortal} />
    {notice && <p className="lyssna-creator-notice" role={notice.error ? "alert" : "status"}>{notice.message}</p>}
  </div>;
}
