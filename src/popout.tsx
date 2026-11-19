import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Heart, X } from "lucide-react";
import type { Host, Track } from "./host";
import { Ambience } from "./lyssna/ambience";
import { NextIcon, PauseIcon, PlayIcon, PreviousIcon, RepeatIcon, ShuffleIcon } from "./lyssna/player-icons";
import { clock, usePosition } from "./playback";
import type { Settings } from "./settings";

export const pictureInPicture = (window as Window & {
  documentPictureInPicture?: {
    requestWindow(options: { width: number; height: number; disallowReturnToOpener: boolean }): Promise<Window>;
  };
}).documentPictureInPicture;

function PopoutSeek({ host, playing, view }: { host: Host; playing: boolean; view: Window }) {
  const duration = host.duration();
  const position = usePosition(host, playing, view);
  const [seeking, setSeeking] = useState<number | null>(null);
  const shown = Math.max(0, Math.min(seeking ?? position, duration));
  function commit() {
    if (seeking !== null) host.seek(seeking);
    setSeeking(null);
  }
  return <footer className="lyrics-popout-seek">
    <input type="range" aria-label="Seek position" min={0} max={duration || 1} value={shown} disabled={!duration}
      style={{ "--range": `${100 * shown / (duration || 1)}%` } as CSSProperties}
      onChange={(event) => setSeeking(event.target.valueAsNumber)} onPointerUp={commit}
      onKeyUp={commit} onBlur={commit} onPointerCancel={() => setSeeking(null)} />
    <span><time>{clock(shown)}</time><time>{clock(duration)}</time></span>
  </footer>;
}

function PopoutControls({ host, track, playing }: { host: Host; track: Track | null; playing: boolean }) {
  const [controls, setControls] = useState(() => ({ liked: host.liked(), shuffle: host.shuffle(), repeat: host.repeat() }));
  function update() {
    const liked = host.liked(), shuffle = host.shuffle(), repeat = host.repeat();
    setControls((old) => liked === old.liked && shuffle === old.shuffle && repeat === old.repeat ? old : { liked, shuffle, repeat });
  }
  useEffect(() => {
    const unwatch = host.watch(update, true);
    update();
    return unwatch;
  }, [host, track?.id]);
  async function change(operation: () => unknown) {
    try {
      await operation();
    } finally {
      update();
    }
  }
  const { liked, shuffle, repeat } = controls;
  const activate = (operation: () => unknown) => () => { void change(operation).catch(console.error); };
  return <div className="lyrics-popout-controls">
    <button type="button" className={`icon-button lyrics-popout-like${liked ? " active" : ""}`}
      aria-label={liked ? "Remove from Liked Songs" : "Save to Liked Songs"} aria-pressed={liked}
      disabled={!track} onClick={activate(host.toggleLiked)}><Heart size={24} fill={liked ? "currentColor" : "none"} /></button>
    <div className="lyrics-popout-transport">
      <button type="button" className={`icon-button${shuffle ? " active" : ""}`}
        aria-label="Shuffle" aria-pressed={shuffle} onClick={activate(host.toggleShuffle)}><ShuffleIcon size={20} /></button>
      <button type="button" className="icon-button" aria-label="Previous song" onClick={host.previous}><PreviousIcon size={22} /></button>
      <button type="button" className="icon-button" aria-label={playing ? "Pause" : "Play"} onClick={host.toggle}>
        {playing ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
      </button>
      <button type="button" className="icon-button" aria-label="Next song" onClick={host.next}><NextIcon size={22} /></button>
      <button type="button" className={`icon-button${repeat !== "off" ? " active" : ""}`}
        aria-label={`Repeat (${repeat})`} aria-pressed={repeat !== "off"}
        onClick={activate(() => host.setRepeat(repeat === "off" ? "context" : repeat === "context" ? "track" : "off"))}>
        <RepeatIcon size={20} one={repeat === "track"} />
      </button>
    </div>
  </div>;
}

export function LyricsPopout({ host, view, close, track, playing, settings, children }: {
  host: Host; view: Window; close: () => void; track: Track | null; playing: boolean; settings: Settings; children: ReactNode;
}) {
  const [awake, setAwake] = useState(false);
  const sleep = useRef(0);
  function hide() {
    view.clearTimeout(sleep.current);
    setAwake(false);
  }
  function wake() {
    setAwake(true);
    view.clearTimeout(sleep.current);
    sleep.current = view.setTimeout(hide, 2_000);
  }
  useEffect(() => () => view.clearTimeout(sleep.current), [view]);
  useEffect(() => {
    view.document.title = track ? `${track.title} · Lyrics` : "Lyssna Lyrics";
  }, [track?.title, view]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    view.addEventListener("keydown", keydown);
    return () => view.removeEventListener("keydown", keydown);
  }, [view, close]);
  return <section className="lyrics-popout" aria-label="Lyrics pop-out" data-awake={awake || undefined}
    onPointerMove={wake} onPointerLeave={hide}
    style={{ "--lyric-size": `${Math.round(settings.lyric_size * 1.6)}px`, "--lyric-font": settings.lyric_font || undefined } as CSSProperties}>
    {track?.cover && <Ambience image={track.cover} animate={playing} reduceMotion={settings.reduce_motion} />}
    <button type="button" className="icon-button lyrics-popout-close" aria-label="Close lyrics pop-out" onClick={close}><X size={18} /></button>
    <header className="lyrics-popout-title">
      <strong>{track?.title ?? "Nothing playing"}</strong>
      {track?.artists && <span>{track.artists}</span>}
    </header>
    <main className="lyrics-popout-lyrics">{children}</main>
    <PopoutSeek key={track?.id} host={host} playing={playing} view={view} />
    <PopoutControls host={host} track={track} playing={playing} />
  </section>;
}
