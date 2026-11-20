import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { MicVocal, Music2, Settings as GearIcon, X } from "lucide-react";
import { getHost, type Host, type Track } from "./host";
import { useArtworkColor } from "./lyssna/artwork-color";
import { Ambience } from "./lyssna/ambience";
import { setFrameCap } from "./lyssna/frame-cap";
import { presetOf } from "./lyssna/animator-tuning";
import { FullscreenPauseIcon, FullscreenPlayIcon, SkipNextIcon, SkipPreviousIcon } from "./lyssna/fullscreen-icons";
import { LyricsDisplay, LyricsSkeleton } from "./lyssna/renderer";
import { markerColour } from "./lyssna/highlighter";
import { SpaceGravityLyrics } from "./lyssna/space-gravity-lyrics";
import { CompactIcon, FullScreenIcon, HideArtworkIcon, PopoutIcon, RetryIcon, SwapSidesIcon, TranslateIcon, UploadIcon, WordSyncIcon } from "./lyssna/toolbar-icons";
import type { Lyrics } from "./lyssna/types";
import { setWindowActivity, setWindowPosition } from "./lyssna/window-activity";
import { filterWords } from "./lyssna/word-filter";
import { displayLyrics } from "./lyssna/word-sync";
import { readSettings, saveSettings, settingsEvent, type Settings } from "./settings";
import { channelLabels, SettingsPanel, type BuildOptions } from "./settings-panel";
import { startSpicyProvider } from "./spicy";
import { useAppFonts } from "./lyssna/custom-fonts";
import { lyricsChanged, saveLocalLyrics } from "./local-lyrics";
import { enabledSources, readLyrics, refreshLyrics, sourceIds } from "./lyric-sources";
import { LyricCredits } from "./credits";
import { CanvasArtwork, nowPlayingSelector, SpotifyVisualiser, useCanvas } from "./spotify-artwork";
import { clock, usePlayback, usePosition } from "./playback";
import { LyricsPopout, pictureInPicture } from "./popout";
import { startEnhancements } from "./enhancements";
import fontCss from "./fonts/fonts.css?inline";
import desktopCss from "./lyssna/lyrics.css?inline";
import settingsCss from "./lyssna/settings.css?inline";
import viewCss from "./view.css?inline";

function useLiveSettings() {
  const [settings, setSettings] = useState(readSettings);
  useEffect(() => {
    const read = () => setSettings(readSettings());
    window.addEventListener(settingsEvent, read);
    read();
    return () => window.removeEventListener(settingsEvent, read);
  }, []);
  return settings;
}

function useTrackLyrics(track: Track, duration: number, view: Window, settings: Settings) {
  const [lyrics, setLyrics] = useState<Lyrics>();
  const [waiting, setWaiting] = useState(true);
  const sourceKey = enabledSources(settings).join(",");
  useEffect(() => {
    const enabled = sourceKey.split(",").filter((id): id is (typeof sourceIds)[number] => sourceIds.some((source) => source === id));
    let generation = 0;
    let timer = 0;
    function restart() {
      view.clearTimeout(timer);
      const current = ++generation;
      setLyrics(undefined);
      const pendingSpicy = enabled.includes("spicy") || enabled.includes("apple");
      setWaiting(enabled.length > 0);
      if (enabled.length === 0) return;
      const deadline = Date.now() + 15_000;
      async function read() {
        const lyrics = await readLyrics(track, duration, enabled);
        if (generation !== current) return;
        if (lyrics) {
          setLyrics(lyrics);
          setWaiting(false);
          return;
        }
        if (!pendingSpicy) { setWaiting(false); return; }
        const pending = Date.now() < deadline;
        setWaiting(pending);
        timer = view.setTimeout(read, pending ? 500 : 3_000);
      }
      void read();
    }
    window.addEventListener(lyricsChanged, restart);
    restart();
    return () => {
      generation++;
      view.clearTimeout(timer);
      window.removeEventListener(lyricsChanged, restart);
    };
  }, [track, duration, view, sourceKey]);
  return { lyrics, waiting };
}

function LyricsForTrack({ track, host, playing, settings, compact = false, view = window }: {
  track: Track; host: Host; playing: boolean; settings: Settings; compact?: boolean; view?: Window;
}) {
  const duration = host.duration();
  const { lyrics, waiting } = useTrackLyrics(track, duration, view, settings);
  const position = usePosition(host, playing, view);
  const time = position + settings.lyric_offset_ms + (settings.lyric_song_offsets[track.id] ?? 0);
  const gravity = view === window && settings.space_gravity && !compact && !!lyrics &&
    !lyrics.instrumental && (lyrics.synced || duration > 0);
  const estimateTiming = settings.experimental_word_sync || gravity ||
    (!lyrics?.synced && settings.lyrics_highlighter) ||
    (!!lyrics?.synced && presetOf(settings.lyrics_animator) !== "Lyssna");
  const rendered = useMemo(() => filterWords(displayLyrics(lyrics, estimateTiming,
    settings.romanized && { below: settings.romanization_below && !gravity }, duration), settings.lyrics_word_filter),
  [lyrics, duration, estimateTiming, settings.romanized, settings.romanization_below, gravity, settings.lyrics_word_filter]);
  const upcoming = view === window && !compact && settings.lyrics_up_next && duration > 0 && position >= duration - 30_000 ? host.upcoming() : undefined;
  const upNext = upcoming && <div className="lyrics-up-next">
    <button type="button" className="lyrics-up-next-body first" onClick={host.next}>
      {upcoming.image && <img className="cover" src={upcoming.image} alt="" />}
      <span className="lyrics-up-next-text"><small>Up next</small>
        <strong className="lyrics-up-next-title">{upcoming.title}</strong>
        <span className="lyrics-up-next-artist">{upcoming.artist}</span></span>
    </button>
  </div>;

  if (gravity && rendered?.synced && rendered.lines.some((line) => line.words.length)) {
    return <SpaceGravityLyrics lyrics={rendered} time={time} reduceMotion={settings.reduce_motion}
      tuning={settings.lyrics_animator} onSeek={(ms) => host.seek(Math.max(0, ms - (settings.lyrics_seek_compensation ? 300 : 0)))}
      highlighter={settings.lyrics_highlighter ? markerColour(settings.lyrics_highlighter_color) : undefined}
      linkWidth={settings.gravity_links ? settings.gravity_link_width / 100 : 0}
      credits={<>{rendered.songwriters?.length ? <p className="writer-credits">Written by {rendered.songwriters.join(", ")}</p> : null}
        <LyricCredits lyrics={rendered} expanded discord={settings.lyrics_discord_usernames} />{upNext}</>} />;
  }
  if (rendered) return <LyricsDisplay lyrics={rendered} positionMs={time} settings={settings}
    onSeek={host.seek} compact={compact} upNext={upNext} />;
  if (waiting && settings.lyrics_skeleton) return <LyricsSkeleton />;
  if (!waiting && !settings.lyrics_no_lyrics_notice) return null;
  return <div className="lyrics-message" role="status"><MicVocal />
    <h2>{waiting ? "Finding lyrics…" : "Lyrics unavailable"}</h2>
  </div>;
}

function NowPlayingCard({ host, open }: { host: Host; open: () => void }) {
  const { track, playing } = usePlayback(host);
  const settings = useLiveSettings();
  const fonts = useAppFonts(settings);
  if (!track || settings.lyrics_hide_npv) return null;
  return <aside className={`lyssna-now-playing-card${settings.lyrics_hide_npv_empty ? " hide-empty" : ""}`} aria-label="Lyssna Lyrics" style={fonts}>
    {track.cover && settings.npv_ambience && <Ambience image={track.cover} animate={playing} reduceMotion={settings.reduce_motion} />}
    <header><h2>Lyrics</h2><button className="icon-button" type="button" aria-label="Open lyrics" onClick={open}><MicVocal size={18} /></button></header>
    <div className="lyssna-now-playing-lines"><LyricsForTrack key={track.id} track={track} host={host} playing={playing} settings={settings} compact /></div>
  </aside>;
}

function PopoutView({ host, view, close }: { host: Host; view: Window; close: () => void }) {
  const { track, playing } = usePlayback(host);
  const settings = useLiveSettings();
  return <LyricsPopout host={host} view={view} close={close} track={track} playing={playing} settings={settings}>
    {track && <LyricsForTrack key={track.id} track={track} host={host} playing={playing} settings={settings} view={view} />}
  </LyricsPopout>;
}

function FullscreenControls({ host, playing, settings }: { host: Host; playing: boolean; settings: Settings }) {
  const position = usePosition(host, playing);
  const duration = host.duration();
  const [volume, setVolume] = useState(host.volume);
  const volumeSlider = settings.fullscreen_volume !== "off" && <input aria-label="Volume" type="range" min={0} max={1} step={0.01}
    value={volume} onChange={(event) => { setVolume(event.target.valueAsNumber); host.setVolume(event.target.valueAsNumber); }} />;
  const always = settings.fullscreen_always_show;
  return <div className={`lyssna-playback${settings.glass_seek ? " glass" : ""}`} data-always={always}>
    <div className="lyssna-seek"><span>{clock(position)}</span><input aria-label="Seek" type="range" min={0} max={duration || 1}
      value={Math.min(position, duration)} onChange={(event) => host.seek(event.target.valueAsNumber)} /><span>{clock(duration)}</span></div>
    <div className="lyssna-transport">
      {settings.fullscreen_volume === "left" && volumeSlider}
      <button type="button" className="icon-button" aria-label="Previous" onClick={host.previous}><SkipPreviousIcon /></button>
      <button type="button" className="icon-button" aria-label={playing ? "Pause" : "Play"} onClick={host.toggle}>
        {playing ? <FullscreenPauseIcon /> : <FullscreenPlayIcon />}
      </button>
      <button type="button" className="icon-button" aria-label="Next" onClick={host.next}><SkipNextIcon /></button>
      {settings.fullscreen_volume === "right" && volumeSlider}
    </div>
    {settings.fullscreen_volume === "below" && volumeSlider}
  </div>;
}

function LyricsView({ host, options, close, parent, openPopout }: {
  host: Host; options: BuildOptions; close: () => void; parent: HTMLElement; openPopout: () => Promise<void>;
}) {
  const { track, playing } = usePlayback(host);
  const [settings, setSettings] = useState(readSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [popoutError, setPopoutError] = useState(false);
  const [notice, setNotice] = useState("");
  const [artistHeader, setArtistHeader] = useState<{ uri: string; url: string }>();
  const [albumYear, setAlbumYear] = useState<{ uri: string; year: string }>();
  const timer = useRef<number>(0);
  const toolsTimer = useRef<number>(0);
  const lyricsPage = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const importTrack = useRef<Track | null>(null);
  const settingsRef = useRef(settings);
  const fonts = useAppFonts(settings);
  const coverColour = useArtworkColor(track?.cover);
  const canvas = useCanvas(track?.id, settings.canvas_lyrics && !settings.lyrics_hide_artwork);
  const background = settings.lyrics_background;
  const artistUri = track?.artistUri;
  const trackId = track?.id;
  const albumUri = track?.albumUri;
  const year = track?.year ?? (albumYear?.uri === albumUri ? albumYear?.year : undefined);
  useEffect(() => {
    if (settings.lyrics_year_position === "off" || track?.year || !albumUri || !/^spotify:album:[A-Za-z0-9]{22}$/.test(albumUri)) return;
    let live = true;
    void host.releaseYear(albumUri)?.then((year) => {
      if (live && year) setAlbumYear({ uri: albumUri, year });
    });
    return () => { live = false; };
  }, [host, albumUri, track?.year, settings.lyrics_year_position]);
  function importTtml() {
    if (!track) return;
    importTrack.current = track;
    fileInput.current?.click();
  }

  async function loadTtml(file: File, song: Track) {
    try {
      if (file.size > 2_000_000) throw new Error("Choose a TTML file under 2 MB.");
      await saveLocalLyrics([{
        uri: `spotify:track:${song.id}`, text: await file.text(), kind: "ttml", name: song.title, artists: song.artists,
      }]);
      setNotice("Imported lyrics.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn’t load TTML.");
    }
  }

  function sleepTools() {
    window.clearTimeout(toolsTimer.current);
    if (lyricsPage.current) delete lyricsPage.current.dataset.tools;
  }

  function wakeTools() {
    if (!lyricsPage.current) return;
    lyricsPage.current.dataset.tools = "awake";
    window.clearTimeout(toolsTimer.current);
    toolsTimer.current = window.setTimeout(sleepTools, 750);
  }

  useEffect(() => {
    wakeTools();
    return () => window.clearTimeout(toolsTimer.current);
  }, []);
  useEffect(() => {
    if (!notice || showSettings) return;
    const id = window.setTimeout(() => setNotice(""), 3_000);
    return () => window.clearTimeout(id);
  }, [notice, showSettings]);
  useEffect(() => {
    if (background !== "artist" || !artistUri || !trackId) return;
    let current = true;
    void host.artistHeader(artistUri, trackId)?.then((url) => {
      if (current && url) setArtistHeader({ uri: artistUri, url });
    });
    return () => { current = false; };
  }, [host, background, artistUri, trackId]);

  function change(patch: Partial<Settings>) {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    saveSettings(next);
    setSettings(next);
  }

  function toggleFullscreen() {
    if (!fullscreen || !settings.fullscreen_animate_close || settings.reduce_motion) {
      setFullscreen(!fullscreen);
      return;
    }
    if (leaving) return;
    setLeaving(true);
    timer.current = window.setTimeout(() => { setLeaving(false); setFullscreen(false); }, 180);
  }

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 650));
    observer.observe(parent);
    return () => observer.disconnect();
  }, [parent]);
  useEffect(() => {
    parent.classList.toggle("immersive", fullscreen);
    parent.classList.toggle("lyssna-slide-away", leaving);
  }, [parent, fullscreen, leaving]);
  useEffect(() => {
    setFrameCap(settings.animation_fps_cap_enabled ? settings.animation_fps_cap : 0);
  }, [settings.animation_fps_cap_enabled, settings.animation_fps_cap]);
  useEffect(() => {
    const update = () => setWindowActivity({ minimized: document.hidden, focused: document.hasFocus() });
    update();
    for (const event of ["visibilitychange", "focus", "blur"]) window.addEventListener(event, update);
    return () => { for (const event of ["visibilitychange", "focus", "blur"]) window.removeEventListener(event, update); };
  }, []);
  useEffect(() => {
    const update = () => setWindowPosition(window.screenX, window.screenY);
    update();
    if (!settings.space_gravity || settings.reduce_motion) return;
    const id = window.setInterval(update, 100);
    return () => clearInterval(id);
  }, [settings.space_gravity, settings.reduce_motion]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "F11") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (showSettings) setShowSettings(false);
      else if (event.key === "F11" || (fullscreen && !settings.lyrics_escape_exits)) toggleFullscreen();
      else close();
    };
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  });

  const hasAmbience = track?.cover && (background === "animated" || background === "static");
  const banner = background === "artist" && artistHeader?.uri === artistUri ? artistHeader?.url : undefined;
  const backgroundImage = background === "cover" || background === "artist" ? banner || track?.cover : undefined;
  const className = `lyrics-page ${narrow || settings.lyrics_compact ? "narrow" : ""}
    ${settings.lyrics_hide_artwork ? "no-artwork" : ""} ${settings.lyrics_artwork_right ? "artwork-right" : ""}
    ${background === "color" ? "colour-background" : ""} ${settings.lyrics_toolbar_bottom ? "toolbar-bottom" : ""} ${settings.reduce_motion ? "reduce-motion" : ""}`;
  const pageStyle = { ...fonts, "--lyric-size": `${Math.round(settings.lyric_size * 1.6)}px`,
    "--lyrics-cover-color": coverColour, "--hero": coverColour } as CSSProperties;
  return <>
    {hasAmbience && <Ambience image={track.cover} animate={playing && background === "animated"}
      reduceMotion={settings.reduce_motion} followCanvas={canvas ? "window" : false} />}
    {backgroundImage && <img className="lyrics-background" src={backgroundImage}
      style={{ "--artwork-blur": `${settings.lyrics_background_blur}px` } as CSSProperties}
      onError={banner ? () => setArtistHeader((current) => current?.url === banner && current.uri === artistUri ? undefined : current) : undefined} alt="" />}
    <section ref={lyricsPage} className={className} aria-label="Lyssna Lyrics" style={pageStyle}
      onPointerMove={wakeTools} onPointerLeave={sleepTools} onKeyDownCapture={wakeTools}>
      {track ? <>
        <div className="lyrics-album">
          {(canvas || track.cover) && <div className="lyrics-media">{canvas
            ? <CanvasArtwork src={canvas} cover={track.cover} playing={playing && !settings.reduce_motion} />
            : <img className={`cover${settings.cover_animation && !settings.reduce_motion ? " crossfade" : ""}`} key={track.cover} src={track.cover} alt="" />}</div>}
          <div className="lyrics-details"><div className="lyrics-title"><strong className="song-title">{track.title}</strong></div>
            <div className="lyrics-artists">
              {year && settings.lyrics_year_position === "left" && <span>{year} · </span>}
              {track.artists}
              {year && settings.lyrics_year_position === "right" && <span> · {year}</span>}
            </div></div>
        </div>
        <div className="lyrics-body"><LyricsForTrack key={track.id} track={track} host={host} playing={playing} settings={settings} /></div>
      </> : <div className="lyrics-message"><Music2 /><h2>Play something you love</h2><p>Your lyrics will appear here.</p></div>}
      {track && settings.lyrics_visualiser && <SpotifyVisualiser key={track.id} host={host} trackId={track.id}
        opacity={settings.lyrics_visualiser_opacity} playing={playing && !settings.reduce_motion} />}
      <div className="lyrics-toolbar" role="toolbar" aria-label="View controls">
        {([
          ["romanized", "Romanization", TranslateIcon],
          ["experimental_word_sync", "Experimental word sync", WordSyncIcon],
          ["lyrics_compact", "Compact lyrics", CompactIcon],
          ["lyrics_hide_artwork", "Hide artwork", HideArtworkIcon],
          ["lyrics_artwork_right", "Artwork on the right", SwapSidesIcon],
        ] as const).map(([key, label, Icon]) => <button type="button" key={key} data-icon={key} title={label}
          className={`icon-button${settings[key] ? " active" : ""}`} aria-label={label} aria-pressed={settings[key]}
          onClick={() => change({ [key]: !settings[key] })}><Icon /></button>)}
        <span className="toolbar-divider" aria-hidden="true" />
        <button type="button" className="icon-button" data-icon="upload" title="Load TTML" aria-label="Load TTML"
          disabled={!track} onClick={importTtml}><UploadIcon /></button>
        {settings.lyrics_cache_button && <button type="button" className="icon-button" data-icon="retry" title="Refresh lyrics" aria-label="Refresh lyrics"
          disabled={!track} onClick={() => { refreshLyrics(track?.id, settings.lyrics_cache_action); setNotice("Refreshing lyrics…"); }}><RetryIcon /></button>}
        <button type="button" className="icon-button" data-icon="fullscreen" title={fullscreen ? "Exit full screen" : "Full screen"}
          aria-label={fullscreen ? "Exit full screen" : "Full screen"}
          aria-pressed={fullscreen} onClick={toggleFullscreen}><FullScreenIcon /></button>
        {pictureInPicture && settings.cinema_lyrics && <button type="button" className="icon-button" title="Pop out lyrics" aria-label="Pop out lyrics" onClick={() => {
          setPopoutError(false);
          void openPopout().catch(() => setPopoutError(true));
        }}><PopoutIcon /></button>}
        <button type="button" className="icon-button" data-icon="settings" title="Lyssna settings" aria-label="Lyssna settings"
          onClick={() => { setNotice(""); setShowSettings(true); }}><GearIcon size={18} /></button>
        <button type="button" className="icon-button" title="Close lyrics" aria-label="Close lyrics" onClick={close}><X size={18} /></button>
      </div>
      {popoutError && <div className="lyssna-popout-error" role="status">Spotify couldn’t open the lyrics pop-out.</div>}
      {!showSettings && notice && <div className="lyssna-popout-error" role="status">{notice}</div>}
      {fullscreen && <FullscreenControls host={host} playing={playing} settings={settings} />}
    </section>
    <input ref={fileInput} type="file" hidden accept=".ttml,.xml,application/ttml+xml" onChange={(event) => {
      const file = event.currentTarget.files?.[0];
      const song = importTrack.current;
      event.currentTarget.value = "";
      if (file && song) void loadTtml(file, song);
    }} />
    {showSettings && <SettingsPanel settings={settings} change={change} close={() => { setNotice(""); setShowSettings(false); }}
      options={options} trackId={track?.id} importTtml={importTtml} notice={notice} setNotice={setNotice} />}
  </>;
}

export default function start(options: BuildOptions) {
  const host = getHost();
  const settings = readSettings();
  setFrameCap(settings.animation_fps_cap_enabled ? settings.animation_fps_cap : 0);
  const stylesheet = document.createElement("style");
  stylesheet.textContent = `${fontCss}\n${desktopCss}\n${settingsCss}\n${viewCss}`;
  document.head.append(stylesheet);
  let stopProvider: (() => void) | undefined;
  function syncProvider() {
    const disabled = readSettings().lyrics_sources_disabled;
    if (!disabled.includes("spicy") || !disabled.includes("apple")) {
      stopProvider ??= startSpicyProvider();
    } else {
      stopProvider?.();
      stopProvider = undefined;
    }
  }
  syncProvider();
  window.addEventListener(settingsEvent, syncProvider);
  function disposeProvider() {
    window.removeEventListener(settingsEvent, syncProvider);
    stopProvider?.();
  }
  let close: (() => void) | undefined;
  let mainContainer: HTMLElement | undefined;
  let button: ReturnType<Host["button"]> | undefined;
  let removeCard: (() => void) | undefined;
  let card: HTMLElement | undefined;
  let closePopout: (() => void) | undefined;
  let opening = false;
  let disposed = false;

  async function openPopout() {
    if (!pictureInPicture || opening || disposed) return;
    if (closePopout) { closePopout(); return; }
    opening = true;
    try {
      const view = await pictureInPicture.requestWindow({ width: 900, height: 640, disallowReturnToOpener: true });
      if (disposed) { view.close(); return; }
      try {
        view.document.head.append(stylesheet.cloneNode(true));
        const parent = view.document.createElement("div");
        parent.className = "lyssna-lyrics-view lyssna-popout-view";
        view.document.body.append(parent);
        const root = host.mount(parent);
        function release() {
          view.removeEventListener("pagehide", release);
          closePopout = undefined;
          root.unmount();
        }
        const dismiss = () => { release(); view.close(); };
        view.addEventListener("pagehide", release);
        closePopout = dismiss;
        root.render(<PopoutView host={host} view={view} close={dismiss} />);
      } catch (error) {
        if (closePopout) closePopout();
        else view.close();
        throw error;
      }
    } finally {
      opening = false;
    }
  }

  function open() {
    if (close) { close(); return; }
    host.leaveOtherLyricsView();
    const parent = document.createElement("div");
    parent.className = "lyssna-lyrics-view";
    const main = host.mainView();
    (main ?? document.body).append(parent);
    if (!main) parent.classList.add("lyssna-full-window");
    const root = host.mount(parent);
    const dismiss = () => {
      close = undefined;
      mainContainer = undefined;
      button?.setActive(false);
      root.unmount();
      parent.remove();
    };
    close = dismiss;
    mainContainer = parent;
    button?.setActive(true);
    root.render(<LyricsView host={host} options={options} close={dismiss} parent={parent} openPopout={openPopout} />);
  }

  let stopViewSwitch: () => void;
  try {
    button = host.button(`Lyssna Lyrics (${channelLabels[options.channel]})`, open);
    stopViewSwitch = host.watchViewSwitch(() => close?.());
  } catch (error) {
    button?.remove();
    disposeProvider();
    stylesheet.remove();
    throw error;
  }
  const stopEnhancementStartup = startEnhancements();

  function attachCard() {
    if (mainContainer && !mainContainer.isConnected) close?.();
    if (card?.isConnected) return;
    removeCard?.();
    removeCard = undefined;
    const panel = document.querySelector(nowPlayingSelector);
    if (!panel) return;
    const container = document.createElement("div");
    card = container;
    container.className = "lyssna-lyrics-view lyssna-npv";
    panel.append(container);
    const root = host.mount(container);
    root.render(<NowPlayingCard host={host} open={() => { if (!close) open(); }} />);
    removeCard = () => { root.unmount(); container.remove(); };
  }
  const observer = new MutationObserver(attachCard);
  observer.observe(document.body, { childList: true, subtree: true });
  attachCard();
  return {
    dispose() {
      disposed = true;
      observer.disconnect();
      stopViewSwitch();
      removeCard?.();
      closePopout?.();
      close?.();
      button?.remove();
      disposeProvider();
      stopEnhancementStartup();
      stylesheet.remove();
    },
    open,
  };
}
