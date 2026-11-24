import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "../host-dom";
import { AudioLines, Square, X } from "lucide-react";
import type { Host } from "../host";
import { spotifySongUri } from "../spotify-song";
import { usePlayback } from "../playback";
import { recordedAudioSaved, type SpotifyCapture } from "./spotify-capture";
import { couldBeComplete, isRecordingComplete, recordedCoverage, recordingPercent, savedAudioCleared, type RecordingCoverage } from "./captured-replay";
import { RecordingDetails } from "./recording-meter";
import { exportSavedAudio } from "./recording-metadata";
import type { RecordingFormat } from "./recording-export";
import type { CreatorPlayback } from "./surface";

function PlaybarRecordingMeter({ host, capture, message, start, stop, playback, manageStoredData }: {
  host: Host; capture: SpotifyCapture; message: string; start?(uri: string): void; stop?(): void;
  playback?: CreatorPlayback; manageStoredData(trigger: HTMLElement | null): void;
}) {
  const { track, narrating } = usePlayback(host, true);
  const uri = track && spotifySongUri(track.id);
  const duration = host.duration();
  const [coverage, setCoverage] = useState<RecordingCoverage>();
  const [complete, setComplete] = useState<{ uri: string; duration: number }>();
  const [deleting, setDeleting] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const revision = useRef(0);
  const [slot, setSlot] = useState<HTMLElement>();
  const saved = coverage?.uri === uri ? coverage : undefined;
  const full = !!complete && complete.uri === uri && complete.duration === duration;
  const percent = recordingPercent(saved, duration, full) ?? 0;
  const local = playback?.trackId === track?.id ? playback : undefined;

  useEffect(() => {
    if (!uri) return;
    let current = true;
    const attempt = revision.current;
    const update = (event: Event) => {
      const summary = (event as CustomEvent<RecordingCoverage>).detail;
      if (summary.uri === uri) setCoverage(summary);
    };
    const cleared = (event: Event) => {
      const removed = (event as CustomEvent<string | undefined>).detail;
      if (removed && removed !== uri) return;
      revision.current++;
      setCoverage(undefined);
      setComplete(undefined);
    };
    setRemoveError("");
    window.addEventListener(recordedAudioSaved, update);
    window.addEventListener(savedAudioCleared, cleared);
    void recordedCoverage(uri).then((summary) => {
      if (current && attempt === revision.current && summary) {
        setCoverage((previous) => previous?.uri === uri && previous.frames >= summary.frames ? previous : summary);
      }
    }).catch(() => {});
    return () => {
      current = false;
      window.removeEventListener(recordedAudioSaved, update);
      window.removeEventListener(savedAudioCleared, cleared);
    };
  }, [uri]);

  useEffect(() => {
    if (!uri || !saved || saved.sealed || full || !couldBeComplete(saved.frames, duration, saved.sampleRate)) return;
    let current = true;
    const attempt = revision.current;
    void isRecordingComplete(uri, duration).then((complete) => {
      if (current && attempt === revision.current && complete) setComplete({ uri, duration });
    }).catch(() => {});
    return () => { current = false; };
  }, [uri, saved?.frames, saved?.sampleRate, saved?.sealed, duration, full]);

  useLayoutEffect(() => {
    const container = document.createElement("div");
    container.className = "lyssna-auto-record-slot";
    const place = () => {
      const bar = document.querySelector('[data-testid="now-playing-bar"], .Root__now-playing-bar');
      const repeat = bar?.querySelector('[data-testid="control-button-repeat"]');
      if (!repeat) { container.remove(); setSlot(undefined); return; }
      if (repeat.nextElementSibling !== container) repeat.after(container);
      setSlot(container);
    };
    place();
    const observer = new MutationObserver(place);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); container.remove(); };
  }, []);

  async function remove() {
    if (!uri || capture.state().status !== "idle" || deleting) return;
    setDeleting(true);
    setRemoveError("");
    try {
      local?.returnToSpotify?.();
      await capture.recordings.remove(uri);
    } catch { setRemoveError("Couldn’t delete the saved recording."); }
    finally { setDeleting(false); }
  }
  async function exportAudio(format: RecordingFormat) {
    if (!uri || !track) return;
    const recording = await capture.recordings.read(uri, local?.read() ?? host.position(), duration);
    if (!recording) throw new Error("There’s no saved section to export.");
    await exportSavedAudio(host, track, recording, format);
  }

  const meter = <RecordingDetails view={window} percent={percent} sharing={!!stop} deleting={deleting}
    track={uri && track ? { uri, name: track.title, artists: track.artists, cover: track.cover } : undefined}
    message={removeError || message || (stop && (narrating ? "Waiting for the DJ to finish…" : "Sharing Spotify audio.")) || undefined}
    start={start && uri ? () => start(uri) : undefined} stop={stop}
    returnToSpotify={local?.returnToSpotify} remove={remove} exportAudio={exportAudio} manageStoredData={manageStoredData} />;
  return slot ? createPortal(meter, slot) : <div className="lyssna-auto-record-slot floating">{meter}</div>;
}

export function PlaybarRecorder({ capture, host, autoRecord, editorOpen, playback, manageStoredData }: {
  capture: SpotifyCapture; host: Host; autoRecord: boolean; editorOpen: boolean;
  playback?: CreatorPlayback; manageStoredData(trigger: HTMLElement | null): void;
}) {
  const state = useSyncExternalStore(capture.subscribe, capture.state);
  const [skipped, setSkipped] = useState(false);
  if (editorOpen) return null;

  const selecting = state.status === "selecting";
  const stop = () => { setSkipped(true); void capture.stop(); };
  const showPrompt = autoRecord && !skipped && (state.status === "idle" || (selecting && state.scope === "auto"));
  return <>
    <PlaybarRecordingMeter host={host} capture={capture} message={state.message}
      start={state.status === "idle" ? (uri) => void capture.start(autoRecord ? "auto" : uri) : undefined}
      stop={state.status !== "idle" ? stop : undefined} playback={playback} manageStoredData={manageStoredData} />
    {showPrompt && <aside className="lyssna-auto-record" aria-label="Lyssna Auto Record">
      <AudioLines size={18} aria-hidden="true" />
      <div role="status">
        <strong>Lyssna Auto Record</strong>
        <p>{state.message || capture.sharePrompt}</p>
      </div>
      {selecting ? <button type="button" onClick={stop}>
        <Square size={14} aria-hidden="true" />Cancel
      </button> : <>
        <button type="button" onClick={() => void capture.start("auto")}>Share Spotify audio</button>
        <button type="button" title="Skip Auto Record this session" aria-label="Skip Auto Record this session" onClick={() => setSkipped(true)}>
          <X size={16} />
        </button>
      </>}
    </aside>}
  </>;
}
