import { useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AudioLines, ChevronDown, ChevronRight, Download, HardDrive, RotateCcw, SkipForward, Square, Trash2 } from "lucide-react";
import { useAnchoredPopover } from "../anchored-popover";
import { findPlaybarCover } from "../now-playing";
import type { RecordingStatus } from "./environment";
import { recordingExportEnabled, recordingFormats, type RecordingFormat } from "./recording-export";

export function RecordingMeter({ view, percent, label, children }: {
  view: Window; percent: number; label: string;
  children: (controls: { id: string; close: () => void; trigger: HTMLButtonElement | null }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useAnchoredPopover(view, open, trigger, panel);

  return <div className="ttml-recording">
    <button type="button" className="ttml-recording-trigger" ref={trigger}
      aria-label={`${label}, ${percent}% recorded`} aria-expanded={open} aria-controls={id}
      title={label} onClick={() => setOpen(!open)}>
      <span className="ttml-recording-ring" aria-hidden="true" style={{ "--recorded": `${percent}%` } as CSSProperties} />
      <span>{percent}%</span>
    </button>
    <div className="ttml-recording-popover" ref={panel} id={id} popover="auto" role="dialog" aria-labelledby={`${id}-title`}
      onToggle={(event) => { if (event.newState === "closed") setOpen(false); }}>
      <h2 id={`${id}-title`}>{label}</h2>
      {open && children({ id, close: () => setOpen(false), trigger: trigger.current })}
    </div>
  </div>;
}

export function RecordingTrack({ cover, page, name, artists }: { cover?: string; page: Document; name: string; artists: string }) {
  const [failed, setFailed] = useState<string[]>([]);
  const [playbarCover] = useState(() => {
    const image = findPlaybarCover(page)?.querySelector<HTMLImageElement>(":scope > img");
    return image?.currentSrc || image?.getAttribute("src");
  });
  const src = [cover, playbarCover].find((url) => url && !failed.includes(url));

  return <div className="ttml-recording-track">
    <span className="ttml-recording-cover" aria-hidden="true">
      {src ? <img key={src} src={src} alt="" onError={() => setFailed((previous) => [...previous, src])} />
        : <AudioLines size={22} />}
    </span>
    <div>
      <strong title={name}>{name}</strong>
      {artists && <span title={artists}>{artists}</span>}
    </div>
  </div>;
}

export function RecordingProgress({ id, percent }: { id: string; percent: number }) {
  const complete = percent === 100;
  return <div className="ttml-recording-status" data-complete={complete || undefined}>
    <span id={id}>{complete ? "Full song saved on this device" : "Saved on this device"}</span>
    <span aria-hidden="true">{percent}%</span>
    <progress value={percent} max={100} aria-labelledby={id} />
  </div>;
}

export function RecordingDetails({ view, track, percent, sharing, deleting, returnToSpotify, remove, exportAudio,
  manageStoredData, message, start, stop, skipToMissing }: RecordingStatus & {
  view: Window; track?: { name: string; artists: string; cover?: string; uri: string };
  manageStoredData(trigger: HTMLElement | null): void;
}) {
  const [format, setFormat] = useState<RecordingFormat>("flac");
  const [exporting, setExporting] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [error, setError] = useState("");
  const complete = percent === 100;
  async function exportRecording() {
    setExporting(true);
    setError("");
    try { await exportAudio(format); }
    catch (why) { setError(why instanceof Error ? why.message : "Couldn’t export the recording."); }
    finally { setExporting(false); }
  }

  return <RecordingMeter view={view} percent={percent} label="Saved audio">
    {({ id, close, trigger }) => <>
      {track && <>
        <RecordingTrack key={track.uri} {...track} page={view.document} />
        <RecordingProgress id={`${id}-progress`} percent={percent} />
      </>}
      {message && <p role="status">{message}</p>}
      <div className="ttml-recording-actions">
        {start && <button type="button" onClick={start}><AudioLines size={15} aria-hidden="true" />Share Spotify audio</button>}
        {stop && <button type="button" onClick={stop}><Square size={14} aria-hidden="true" />Stop sharing Spotify audio</button>}
        {skipToMissing && <button type="button" disabled={seeking || deleting || exporting} onClick={async () => {
          setSeeking(true);
          setError("");
          try {
            if (await skipToMissing()) { trigger?.focus(); close(); }
            else setError("No missing section found.");
          } catch (why) { setError(why instanceof Error ? why.message : "Couldn’t find missing audio."); }
          finally { setSeeking(false); }
        }}><SkipForward size={15} aria-hidden="true" />{seeking ? "Finding missing audio…" : "Skip to missing"}</button>}
        {returnToSpotify && <button type="button" className="ttml-recording-return" onClick={() => {
          returnToSpotify(); trigger?.focus(); close();
        }}><RotateCcw size={15} aria-hidden="true" />Return to Spotify playback</button>}
        {percent > 0 && recordingExportEnabled() && <div className="ttml-recording-export">
          <label>
            <select aria-label="Audio export format" value={format} disabled={exporting || deleting}
              onChange={(event) => setFormat(event.currentTarget.value as RecordingFormat)}>
              {Object.entries(recordingFormats).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </label>
          <button type="button" disabled={exporting || deleting || seeking} onClick={() => void exportRecording()}>
            <Download size={15} aria-hidden="true" />{exporting ? "Exporting…" : complete ? "Export audio" : "Export section"}
          </button>
        </div>}
        {error && <p className="ttml-recording-error" role="alert">{error}</p>}
      </div>
      <div className="ttml-recording-manage">
        {percent > 0 && <button type="button" className="ttml-recording-delete" disabled={sharing || deleting || exporting || seeking} onClick={() => void remove()}>
          <Trash2 size={15} aria-hidden="true" />{deleting ? "Deleting…" : "Delete recording"}
        </button>}
        {sharing && percent > 0 && <p>Stop sharing Spotify audio to delete this recording.</p>}
        <button type="button" onClick={() => { close(); manageStoredData(trigger); }}>
          <HardDrive size={15} aria-hidden="true" />Manage Stored Data<ChevronRight size={15} aria-hidden="true" />
        </button>
      </div>
    </>}
  </RecordingMeter>;
}
