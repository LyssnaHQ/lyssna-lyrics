import { useState, useSyncExternalStore } from "react";
import { AudioLines, Square, X } from "lucide-react";
import type { SpotifyCapture } from "./spotify-capture";

export function AutoRecordPrompt({ capture }: { capture: SpotifyCapture }) {
  const state = useSyncExternalStore(capture.subscribe, capture.state);
  const [skipped, setSkipped] = useState(false);
  if (skipped || (state.status !== "idle" && state.scope !== "auto")) return null;

  const live = state.status === "live";
  const selecting = state.status === "selecting";
  const message = state.scope === "auto" ? state.message : "";
  return <aside className="lyssna-auto-record" aria-label="Lyssna Auto Record">
    <AudioLines size={18} aria-hidden="true" />
    <div role="status">
      <strong>{live ? "Recording Spotify audio" : "Lyssna Auto Record"}</strong>
      {(!live || message) && <p>{message || capture.sharePrompt}</p>}
    </div>
    {live || selecting ? <button type="button" onClick={() => { setSkipped(true); void capture.stop(); }}>
      <Square size={14} aria-hidden="true" />{live ? "Stop" : "Cancel"}
    </button> : <>
      <button type="button" onClick={() => void capture.start("auto")}>Share Spotify audio</button>
      <button type="button" title="Skip Auto Record this session" aria-label="Skip Auto Record this session" onClick={() => setSkipped(true)}>
        <X size={16} />
      </button>
    </>}
  </aside>;
}
