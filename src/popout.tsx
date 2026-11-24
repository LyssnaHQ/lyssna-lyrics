import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Heart, X } from "lucide-react";
import type { Host, Track } from "./host";
import { Ambience } from "./lyssna/ambience";
import { NextIcon, PauseIcon, PlayIcon, PreviousIcon, RepeatIcon, ShuffleIcon } from "./lyssna/player-icons";
import { clock, usePlaybackControls, usePosition } from "./playback";
import { appFontStyles } from "./font-settings";
import type { Settings } from "./settings";
import type { CreatorPlayback } from "./creator/surface";
import { DJ_COVER, DJInterlude } from "./dj-interlude";

export const pictureInPicture = (window as Window & {
  documentPictureInPicture?: {
    requestWindow(options: { width: number; height: number; disallowReturnToOpener: boolean }): Promise<Window>;
  };
}).documentPictureInPicture;

function PopoutSeek({ host, playing, view, disabled, localPlayback }: {
  host: Host; playing: boolean; view: Window; disabled: boolean; localPlayback?: CreatorPlayback;
}) {
  const duration = host.duration();
  const position = usePosition(host, playing, view, localPlayback?.read);
  const [seeking, setSeeking] = useState<number | null>(null);
  const shown = Math.max(0, Math.min(seeking ?? position, duration));
  function commit() {
    if (!disabled && seeking !== null) (localPlayback?.seek ?? host.seek)(seeking);
    setSeeking(null);
  }
  return <footer className="lyrics-popout-seek">
    <input type="range" aria-label="Seek position" min={0} max={duration || 1} value={shown} disabled={disabled || !duration}
      style={{ "--range": `${100 * shown / (duration || 1)}%` } as CSSProperties}
      onChange={(event) => setSeeking(event.target.valueAsNumber)} onPointerUp={commit}
      onKeyUp={commit} onBlur={commit} onPointerCancel={() => setSeeking(null)} />
    <span><time>{clock(shown)}</time><time>{clock(duration)}</time></span>
  </footer>;
}

function PopoutControls({ host, track, playing, toggle }: { host: Host; track: Track | null; playing: boolean; toggle(): void }) {
  const { liked, shuffle, repeat, activate, cycleRepeat } = usePlaybackControls(host, track?.id);
  return <div className="lyrics-popout-controls">
    <button type="button" className={`icon-button lyrics-popout-like${liked ? " active" : ""}`}
      aria-label={liked ? "Remove from Liked Songs" : "Save to Liked Songs"} aria-pressed={liked}
      disabled={!track} onClick={activate(host.toggleLiked)}><Heart size={24} fill={liked ? "currentColor" : "none"} /></button>
    <div className="lyrics-popout-transport">
      <button type="button" className={`icon-button${shuffle ? " active" : ""}`}
        aria-label="Shuffle" aria-pressed={shuffle} onClick={activate(host.toggleShuffle)}><ShuffleIcon size={20} /></button>
      <button type="button" className="icon-button" aria-label="Previous song" onClick={host.previous}><PreviousIcon size={22} /></button>
      <button type="button" className="icon-button" aria-label={playing ? "Pause" : "Play"} onClick={toggle}>
        {playing ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
      </button>
      <button type="button" className="icon-button" aria-label="Next song" onClick={host.next}><NextIcon size={22} /></button>
      <button type="button" className={`icon-button${repeat !== "off" ? " active" : ""}`}
        aria-label={`Repeat (${repeat})`} aria-pressed={repeat !== "off"}
        onClick={activate(cycleRepeat)}>
        <RepeatIcon size={20} one={repeat === "track"} />
      </button>
    </div>
  </div>;
}

export function LyricsPopout({ host, view, close, track, playing, settings, narrating, children, localPlayback, draft }: {
  host: Host; view: Window; close: () => void; track: Track | null; playing: boolean;
  settings: Settings; narrating: boolean; children: ReactNode; localPlayback?: CreatorPlayback; draft?: boolean;
}) {
  const fonts = appFontStyles(settings);
  const artwork = narrating ? DJ_COVER : track?.cover;
  const title = narrating ? "DJ" : track?.title;
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
    view.document.title = title ? `${title} · Lyrics` : "Lyssna Lyrics";
  }, [title, view]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    view.addEventListener("keydown", keydown);
    return () => view.removeEventListener("keydown", keydown);
  }, [view, close]);
  return <section className={`lyrics-popout${narrating ? " dj-narration" : ""}`} aria-label="Lyrics pop-out" data-awake={awake || undefined}
    onPointerMove={wake} onPointerLeave={hide}
    style={{ ...fonts, "--lyric-size": `${Math.round(settings.lyric_size * 1.6)}px` } as CSSProperties}>
    {artwork && <Ambience image={artwork} animate={playing} reduceMotion={settings.reduce_motion} brightness={settings.lyrics_background_brightness} />}
    <div className="lyssna-popout-grab" aria-hidden="true" />
    <button type="button" className="icon-button lyrics-popout-close" aria-label="Close lyrics pop-out" onClick={close}><X size={18} /></button>
    <header className="lyrics-popout-title">
      <strong>{title ?? "Nothing playing"}</strong>
      {track?.artists && <span>{track.artists}</span>}
      {draft && <span>TTML draft preview</span>}
    </header>
    <main className="lyrics-popout-lyrics">
      {narrating ? <DJInterlude playing={playing} reduceMotion={settings.reduce_motion} /> : children}
    </main>
    <PopoutSeek key={track?.id} host={host} playing={playing} view={view} disabled={narrating} localPlayback={localPlayback} />
    <PopoutControls host={host} track={track} playing={playing} toggle={localPlayback?.toggle ?? host.toggle} />
  </section>;
}
