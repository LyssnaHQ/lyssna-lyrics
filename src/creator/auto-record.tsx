import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "../host-dom";
import { AudioLines, Square, X } from "lucide-react";
import type { Host } from "../host";
import { usePlayback } from "../playback";
import { recordedAudioSaved, type SpotifyCapture } from "./spotify-capture";
import { couldBeComplete, isRecordingComplete, recordedCoverage, recordingPercent, type RecordingCoverage } from "./captured-replay";
import { RecordingMeter, RecordingProgress, RecordingTrack } from "./recording-meter";

function AutoRecordMeter({ host, message, stop }: { host: Host; message: string; stop(): void }) {
  const { track, narrating } = usePlayback(host, true);
  const uri = track && `spotify:track:${track.id}`;
  const duration = host.duration();
  const [coverage, setCoverage] = useState<RecordingCoverage>();
  const [complete, setComplete] = useState<{ uri: string; duration: number }>();
  const [slot, setSlot] = useState<HTMLElement>();
  const saved = coverage?.uri === uri ? coverage : undefined;
  const full = !!complete && complete.uri === uri && complete.duration === duration;
  const percent = recordingPercent(saved, duration, full) ?? 0;

  useEffect(() => {
    if (!uri) return;
    let current = true;
    const update = (event: Event) => {
      const summary = (event as CustomEvent<RecordingCoverage>).detail;
      if (summary.uri === uri) setCoverage(summary);
    };
    window.addEventListener(recordedAudioSaved, update);
    void recordedCoverage(uri).then((summary) => {
      if (current && summary) setCoverage((previous) => previous?.uri === uri && previous.frames >= summary.frames ? previous : summary);
    }).catch(() => {});
    return () => { current = false; window.removeEventListener(recordedAudioSaved, update); };
  }, [uri]);

  useEffect(() => {
    if (!uri || !saved || full || !couldBeComplete(saved.frames, duration, saved.sampleRate)) return;
    let current = true;
    void isRecordingComplete(uri, duration).then((complete) => {
      if (current && complete) setComplete({ uri, duration });
    }).catch(() => {});
    return () => { current = false; };
  }, [uri, saved?.frames, saved?.sampleRate, duration, full]);

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

  const meter = <RecordingMeter view={window} percent={percent} label="Auto Record">
    {({ id }) => <>
      {track && <RecordingTrack key={track.id} page={document} cover={track.cover} name={track.title} artists={track.artists} />}
      {track && <RecordingProgress id={`${id}-progress`} percent={percent} />}
      <p role="status">{message || (narrating ? "Waiting for the DJ to finish…" : track ? "Saving Spotify audio during playback." : "Waiting for Spotify playback…")}</p>
      <button type="button" onClick={stop}><Square size={14} aria-hidden="true" />Stop recording</button>
    </>}
  </RecordingMeter>;
  return slot ? createPortal(meter, slot) : <div className="lyssna-auto-record-slot floating">{meter}</div>;
}

export function AutoRecordPrompt({ capture, host }: { capture: SpotifyCapture; host: Host }) {
  const state = useSyncExternalStore(capture.subscribe, capture.state);
  const [skipped, setSkipped] = useState(false);
  if (skipped || (state.status !== "idle" && state.scope !== "auto")) return null;

  const selecting = state.status === "selecting";
  const message = state.scope === "auto" ? state.message : "";
  const stop = () => { setSkipped(true); void capture.stop(); };
  if (state.status === "live") return <AutoRecordMeter host={host} message={message} stop={stop} />;

  return <aside className="lyssna-auto-record" aria-label="Lyssna Auto Record">
    <AudioLines size={18} aria-hidden="true" />
    <div role="status">
      <strong>Lyssna Auto Record</strong>
      <p>{message || capture.sharePrompt}</p>
    </div>
    {selecting ? <button type="button" onClick={stop}>
      <Square size={14} aria-hidden="true" />Cancel
    </button> : <>
      <button type="button" onClick={() => void capture.start("auto")}>Share Spotify audio</button>
      <button type="button" title="Skip Auto Record this session" aria-label="Skip Auto Record this session" onClick={() => setSkipped(true)}>
        <X size={16} />
      </button>
    </>}
  </aside>;
}
