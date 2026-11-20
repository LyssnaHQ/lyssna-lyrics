import { useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AudioLines } from "lucide-react";
import { useAnchoredPopover } from "../anchored-popover";
import { findPlaybarCover } from "../now-playing";

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
