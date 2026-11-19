import { useEffect, useRef, useState } from "react";
import { getHost, type Host, type Track } from "./host";
import { LyricAnimator } from "./lyssna/lyric-animator";
import { lineBlur, wordGroups } from "./lyssna/lyric-motion";
import { LyricWord } from "./lyssna/lyric-word";
import type { Lyrics } from "./lyssna/types";
import { readSpicyLyrics, startSpicyProvider } from "./spicy";
import desktopCss from "./lyssna/lyrics.css?inline";
import viewCss from "./view.css?inline";

type Channel = "stable" | "beta" | "canary";
type Options = {
  channel: Channel;
  channels: Record<Channel, string | null>;
  selectChannel: (channel: Channel) => Promise<void>;
};

function SyncedLyrics({ lyrics, host }: { lyrics: Lyrics; host: Host }) {
  const scroller = useRef<HTMLDivElement>(null);
  const lines = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!lyrics.synced) return;
    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animator = new LyricAnimator(lyrics, (index) => lines.current[index] ?? null, reduceMotion);
    let current = -2;
    let frame = 0;
    let inspected = 0;
    let previousTime = -1;
    let previousFrame = 0;

    function update(now: number) {
      frame = requestAnimationFrame(update);
      const time = host.position();
      if (!Number.isFinite(time) || time === previousTime) return;
      if (previousTime < 0 || Math.abs(time - previousTime) > Math.max(600, now - previousFrame + 350)) animator.reset();
      previousTime = time;
      previousFrame = now;
      if (now >= inspected) {
        inspected = now + 40;
        const active = lyrics.lines.findLastIndex((line) => !line.background && line.start_ms <= time + 100);
        if (active !== current) {
          current = active;
          const line = lines.current[active];
          const box = scroller.current;
          if (line && box) {
            box.scrollTo({ top: line.offsetTop - box.clientHeight * 0.31, behavior: reduceMotion ? "instant" : "smooth" });
          }
        }
        lyrics.lines.forEach((line, index) => {
          const button = lines.current[index];
          const singing = line.start_ms <= time + 100 && line.end_ms > time;
          button?.classList.toggle("active", singing);
          button?.classList.toggle("past", !singing && line.end_ms <= time);
          button?.style.setProperty("--blur", `${reduceMotion || singing ? 0 : lineBlur(Math.min(5, Math.abs(index - active)))}px`);
        });
      }
      animator.update(time);
    }

    frame = requestAnimationFrame(update);
    return () => {
      cancelAnimationFrame(frame);
      animator.dispose();
    };
  }, [host, lyrics]);

  return (
    <div className={`lyrics-display${lyrics.synced ? "" : " static-lyrics"}`}>
      <div ref={scroller} className="lyric-scroll" data-at-end="true">
        <div className="lyric-spacer" />
        {lyrics.lines.map((line, index) => (
          <button
            key={index}
            type="button"
            className={`lyric-line${line.opposite ? " opposite" : ""}${line.background ? " background-vocal" : ""}`}
            ref={(node) => { lines.current[index] = node; }}
            disabled={!lyrics.synced}
            onClick={() => host.seek(line.start_ms)}
          >
            <span className="lyric-main">
              {line.words.length ? wordGroups(line.words).map((words, group) => (
                <LyricWord key={group} words={words} />
              )) : <span className="lyric-plain">{line.text}</span>}
            </span>
          </button>
        ))}
        <div className="lyric-spacer" />
      </div>
    </div>
  );
}

function LyricsForTrack({ track, host }: { track: Track; host: Host }) {
  const [lyrics, setLyrics] = useState<Lyrics>();
  const [waiting, setWaiting] = useState(true);

  useEffect(() => {
    let live = true;
    let timer = 0;
    const deadline = Date.now() + 15_000;

    async function read() {
      const lyrics = await readSpicyLyrics(track.id).catch(() => undefined);
      if (!live) return;
      if (lyrics) {
        setLyrics(lyrics);
        return;
      }
      const pending = Date.now() < deadline;
      setWaiting(pending);
      timer = window.setTimeout(read, pending ? 500 : 3_000);
    }

    void read();
    return () => { live = false; clearTimeout(timer); };
  }, [track.id]);

  if (lyrics && !lyrics.instrumental) return <SyncedLyrics host={host} lyrics={lyrics} />;
  return <p className="lyrics-message" role="status">
    {lyrics?.instrumental ? "Instrumental" : waiting ? "Waiting for Spicy Lyrics…" : "Lyrics unavailable for this track."}
  </p>;
}

function LyricsView({ host, options, close }: { host: Host; options: Options; close: () => void }) {
  const [track, setTrack] = useState(host.track);
  const [playing, setPlaying] = useState(host.playing);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => host.watch(() => {
    setTrack(host.track());
    setPlaying(host.playing());
  }), [host]);

  async function select(channel: Channel) {
    setSwitching(true);
    setError(false);
    try {
      await options.selectChannel(channel);
    } catch {
      setError(true);
    } finally {
      setSwitching(false);
    }
  }

  return (
    <>
      {track?.cover && <img className="lyrics-background" src={track.cover} alt="" />}
      <section className="lyrics-page" aria-label="Lyssna Lyrics">
        <div className="lyrics-album">
          {track?.cover && <img className="cover" src={track.cover} alt="" />}
          <div className="lyrics-title"><strong className="song-title">{track?.title}</strong></div>
          <div className="lyrics-artists">{track?.artists}</div>
        </div>
        <div className="lyrics-body">
          {track ? <LyricsForTrack key={track.id} track={track} host={host} /> : <p className="lyrics-message">Play a song to see its lyrics.</p>}
        </div>
      </section>
      <div className="lyrics-actions">
        {error && <span role="alert">Couldn’t load that build.</span>}
        <button type="button" onClick={host.toggle}>{playing ? "Pause" : "Play"}</button>
        <select aria-label="Build channel" value={options.channel} disabled={switching} onChange={(event) => void select(event.target.value as Channel)}>
          {(Object.keys(options.channels) as Channel[]).map((channel) => (
            <option key={channel} value={channel} disabled={!options.channels[channel]}>
              {channel[0].toUpperCase() + channel.slice(1)}{options.channels[channel] ? "" : " (no build)"}
            </option>
          ))}
        </select>
        <button type="button" onClick={close}>Close</button>
      </div>
    </>
  );
}

export default function start(options: Options) {
  const host = getHost();
  const stylesheet = document.createElement("style");
  stylesheet.textContent = desktopCss + "\n" + viewCss;
  document.head.append(stylesheet);
  const stopProvider = startSpicyProvider();
  let close: (() => void) | undefined;

  function open() {
    if (close) return;
    const parent = document.createElement("div");
    parent.className = "lyssna-lyrics-view";
    document.body.append(parent);
    const root = host.mount(parent);
    const dismiss = () => {
      document.removeEventListener("keydown", escape);
      root.unmount();
      parent.remove();
      close = undefined;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    close = dismiss;
    root.render(<LyricsView host={host} options={options} close={dismiss} />);
    document.addEventListener("keydown", escape);
  }

  function dispose() {
    close?.();
    removeButton();
    stopProvider();
    stylesheet.remove();
  }

  let removeButton: () => void;
  try {
    removeButton = host.button(open);
  } catch (error) {
    stopProvider();
    stylesheet.remove();
    throw error;
  }
  return { dispose, open };
}
