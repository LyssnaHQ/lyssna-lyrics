import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { MicVocal, Music2, Settings as GearIcon, X } from "lucide-react";
import { getHost, type CanvasInfo, type Host, type Track } from "./host";
import { useArtworkColor } from "./lyssna/artwork-color";
import { Ambience } from "./lyssna/ambience";
import { setFrameCap } from "./lyssna/frame-cap";
import { FullscreenPauseIcon, FullscreenPlayIcon, FullscreenVolumeIcon, SkipNextIcon, SkipPreviousIcon } from "./lyssna/fullscreen-icons";
import { LyricsDisplay, LyricsSkeleton, WriterCredits } from "./lyssna/renderer";
import { markerColour } from "./lyssna/highlighter";
import { SpaceGravityLyrics } from "./lyssna/space-gravity-lyrics";
import { CompactIcon, FullScreenIcon, HideArtworkIcon, PopoutIcon, RetryIcon, SwapSidesIcon, TranslateIcon, UploadIcon, WordSyncIcon } from "./lyssna/toolbar-icons";
import type { Lyrics } from "./lyssna/types";
import { setWindowActivity, setWindowPosition } from "./lyssna/window-activity";
import { filterWords } from "./lyssna/word-filter";
import { displayLyrics, needsWordSync } from "./word-sync";
import type { AudioAnalysisData } from "./experimental-word-sync";
import { readSettings, saveSettings, settingsEvent, type Settings } from "./settings";
import { channelLabels, SettingsPanel, type BuildOptions } from "./settings-panel";
import { startSpicyProvider } from "./spicy";
import { useAppFonts } from "./lyssna/custom-fonts";
import { lyricsChanged, saveLocalLyrics } from "./local-lyrics";
import { enabledSources, readLyrics, refreshLyrics, sourceIds } from "./lyric-sources";
import { LyricCredits } from "./credits";
import { CanvasArtwork, SpotifyVisualiser, useCanvas } from "./spotify-artwork";
import { findNowPlaying, nowPlayingArtwork, placeNowPlayingPreview } from "./now-playing";
import { TrackMetadata } from "./track-metadata";
import { useDefaultLyricsFont } from "./lyrics-font-fallback";
import { clock, usePlayback, usePosition } from "./playback";
import { LyricsPopout, pictureInPicture } from "./popout";
import { startEnhancements } from "./enhancements";
import { startPreferenceSync } from "./preference-sync";
import { playbarViewButtons } from "./playbar-fullscreen";
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
  const estimateTiming = settings.experimental_word_sync || gravity || (!lyrics?.synced && settings.lyrics_highlighter);
  const [analysis, setAnalysis] = useState<AudioAnalysisData>();
  const analyse = !!lyrics && estimateTiming && needsWordSync(lyrics, duration);
  useEffect(() => {
    if (!analyse) return;
    let active = true;
    void host.analysis(track.id)?.then((data) => {
      if (active && data) setAnalysis({ track: data.track, segments: data.segments ?? [], beats: data.beats ?? [] });
    });
    return () => { active = false; };
  }, [host, track.id, analyse]);
  const rendered = useMemo(() => filterWords(displayLyrics(lyrics, estimateTiming,
    settings.romanized && { below: settings.romanization_below && !gravity }, duration, analysis), settings.lyrics_word_filter),
  [lyrics, duration, estimateTiming, settings.romanized, settings.romanization_below, gravity, settings.lyrics_word_filter, analysis]);
  const defaultFont = useDefaultLyricsFont(settings.lyric_font, rendered, view.document);
  const fontClass = defaultFont ? "lyssna-default-lyrics-font" : undefined;
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
    return <div className={fontClass} style={{ display: "contents" }}><SpaceGravityLyrics lyrics={rendered} time={time} reduceMotion={settings.reduce_motion}
      tuning={settings.lyrics_animator} onSeek={(ms) => host.seek(Math.max(0, ms - (settings.lyrics_seek_compensation ? 300 : 0)))}
      highlighter={settings.lyrics_highlighter ? markerColour(settings.lyrics_highlighter_color) : undefined}
      linkWidth={settings.gravity_links ? settings.gravity_link_width / 100 : 0}
      credits={<div className={upNext ? "lyric-credits-row" : undefined}>
        <div className="gravity-credit-details">
          <WriterCredits names={rendered.songwriters ?? []} />
          <LyricCredits lyrics={rendered} expanded discord={settings.lyrics_discord_usernames} />
        </div>
        {upNext}
      </div>} /></div>;
  }
  if (rendered) return <div className={fontClass} style={{ display: "contents" }}><LyricsDisplay lyrics={rendered} positionMs={time} settings={settings}
    onSeek={host.seek} compact={compact} upNext={upNext} /></div>;
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
  return <aside className={`lyssna-now-playing-card${settings.lyrics_hide_npv_empty ? " hide-empty" : ""}`} aria-label="Lyssna Lyrics preview" style={fonts}>
    {track.cover && settings.npv_ambience && <Ambience image={track.cover} animate={playing} reduceMotion={settings.reduce_motion} />}
    <header><h2>Lyrics preview</h2><button className="icon-button" type="button" aria-label="Open lyrics" onClick={open}><MicVocal size={18} /></button></header>
    <div className="lyssna-now-playing-lines" data-scroll-size-contained=""><LyricsForTrack key={track.id} track={track} host={host} playing={playing} settings={settings} compact /></div>
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
  const audible = useRef(volume || 0.5);
  function changeVolume(level: number) {
    if (level > 0) audible.current = level;
    setVolume(level);
    host.setVolume(level);
  }
  const volumeSlider = settings.fullscreen_volume !== "off" && (
    <div className={`lyrics-volume-pill lyssna-volume ${settings.fullscreen_volume}`}
      data-level={volume <= 0 ? "muted" : volume < 0.5 ? "low" : "high"}
      style={{ "--range": `${volume * 100}%` } as CSSProperties}>
      <span className="lyrics-volume-fill" aria-hidden="true" />
      <input aria-label="Volume" type="range" min={0} max={1} step={0.01}
        value={volume} onChange={(event) => changeVolume(event.target.valueAsNumber)} />
      <button className="lyrics-volume-icon" type="button" aria-label={volume ? "Mute" : "Unmute"}
        onClick={() => changeVolume(volume ? 0 : audible.current)}><FullscreenVolumeIcon /></button>
    </div>
  );
  const always = settings.fullscreen_always_show;
  const elapsed = Math.min(position, duration);
  const total = clock(duration);
  return <div className="lyssna-playback" data-always={always}>
    <div className="lyssna-seek" style={{ "--time-chars": total.length } as CSSProperties}>
      <time>{clock(elapsed)}</time>
      <div className="lyrics-glass-seek" style={{ "--range": `${elapsed / Math.max(1, duration) * 100}%` } as CSSProperties}>
        <span className="lyrics-glass-fill" aria-hidden="true" />
        <input aria-label="Seek position" type="range" min={0} max={duration || 1}
          value={elapsed} onChange={(event) => host.seek(event.target.valueAsNumber)} />
      </div>
      <time>{total}</time>
    </div>
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

type FullscreenMode = "display" | "cinema";
const activeViewKey = "lyssna-lyrics.v1.active-view";

function requestDisplayFullscreen(parent: HTMLElement) {
  if (!parent.ownerDocument.fullscreenEnabled || parent.matches(":fullscreen")) return;
  parent.tabIndex = -1;
  // The immersive layout also works when the client rejects the request.
  void parent.requestFullscreen().then(() => parent.focus({ preventScroll: true })).catch(() => {});
}

function LyricsView({ host, options, close, parent, openPopout, fullscreenRequest, onSidebarCover }: {
  host: Host; options: BuildOptions; close: () => void; parent: HTMLElement; openPopout: () => Promise<void>;
  fullscreenRequest: number;
  onSidebarCover(cover?: string): void;
}) {
  const { track, playing } = usePlayback(host);
  const settings = useLiveSettings();
  const [showSettings, setShowSettings] = useState(false);
  const [fullscreen, setFullscreen] = useState(fullscreenRequest > 0);
  const [leaving, setLeaving] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [popoutError, setPopoutError] = useState(false);
  const [notice, setNotice] = useState("");
  const [artistHeader, setArtistHeader] = useState<{ uri: string; url: string }>();
  const [albumYear, setAlbumYear] = useState<{ uri: string; year: string }>();
  const timer = useRef<number>(0);
  const exitingDisplay = useRef(false);
  const toolsTimer = useRef<number>(0);
  const lyricsPage = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const importTrack = useRef<Track | null>(null);
  const fonts = useAppFonts(settings);
  const coverColour = useArtworkColor(track?.cover);
  const canvasEnabled = settings.canvas_lyrics && !settings.lyrics_hide_artwork;
  const canvasInfo = useCanvas(host, track?.id, canvasEnabled);
  const [unavailableCanvas, setUnavailableCanvas] = useState<CanvasInfo>();
  const canvas = canvasInfo === unavailableCanvas ? undefined : canvasInfo;
  useEffect(() => setUnavailableCanvas(undefined), [track?.id, canvasEnabled]);
  useLayoutEffect(() => { onSidebarCover(canvas ? track?.cover : undefined); }, [canvas, track?.cover, onSidebarCover]);
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
    saveSettings({ ...readSettings(), ...patch });
  }

  function toggleFullscreen(cinema = false) {
    if (!fullscreen) {
      setFullscreen(true);
      if (!cinema) requestDisplayFullscreen(parent);
      return;
    }
    if (leaving) return;
    const finish = () => {
      setLeaving(false);
      setFullscreen(false);
      if (parent.matches(":fullscreen")) {
        exitingDisplay.current = true;
        void parent.ownerDocument.exitFullscreen().catch(() => {
          exitingDisplay.current = false;
          setFullscreen(parent.matches(":fullscreen"));
        });
      }
    };
    if (settings.fullscreen_animate_close && !settings.reduce_motion) {
      setLeaving(true);
      timer.current = window.setTimeout(finish, 180);
    } else finish();
  }

  useLayoutEffect(() => {
    if (!fullscreenRequest) return;
    window.clearTimeout(timer.current);
    setLeaving(false);
    setFullscreen(true);
  }, [fullscreenRequest]);
  useLayoutEffect(() => {
    const page = parent.ownerDocument;
    let wasFullscreen = parent.matches(":fullscreen");
    const sync = () => {
      const active = parent.matches(":fullscreen");
      if (wasFullscreen && !active) {
        const exitedByView = exitingDisplay.current;
        exitingDisplay.current = false;
        window.clearTimeout(timer.current);
        setLeaving(false);
        setFullscreen(false);
        if (!exitedByView && readSettings().lyrics_escape_exits) close();
      }
      wasFullscreen = active;
    };
    page.addEventListener("fullscreenchange", sync);
    return () => page.removeEventListener("fullscreenchange", sync);
  }, [parent, close]);
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
      else if (event.key === "F11" || (fullscreen && !settings.lyrics_escape_exits)) toggleFullscreen(event.shiftKey);
      else close();
    };
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  });

  const hasAmbience = track?.cover && (background === "animated" || background === "static");
  const banner = background === "artist" && artistHeader?.uri === artistUri ? artistHeader?.url : undefined;
  const backgroundImage = background === "cover" || background === "artist" ? banner || track?.cover : undefined;
  const className = `lyrics-page ${canvas ? "canvas-lyrics" : ""} ${narrow || settings.lyrics_compact ? "narrow" : ""}
    ${settings.lyrics_hide_artwork ? "no-artwork" : ""} ${settings.lyrics_artwork_right ? "artwork-right" : ""}
    ${background === "color" ? "colour-background" : ""} ${settings.lyrics_toolbar_bottom ? "toolbar-bottom" : ""}
    ${settings.reduce_motion ? "reduce-motion" : ""} ${settings.glass_seek ? "" : "flat-seek"}`;
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
          {canvas ? <CanvasArtwork key={`${track.id}:${canvas.fileId ?? canvas.url}`} info={canvas} cover={track.cover}
            playing={playing && !settings.reduce_motion} onUnavailable={setUnavailableCanvas} />
            : track.cover && <div className="lyrics-media"><img className={`cover${settings.cover_animation && !settings.reduce_motion ? " crossfade" : ""}`}
              key={track.cover} src={track.cover} alt="" /></div>}
          <TrackMetadata host={host} track={track} year={year} yearPosition={settings.lyrics_year_position} reduceMotion={settings.reduce_motion} />
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
        <button type="button" className="icon-button" data-icon="fullscreen" title={fullscreen ? "Exit full screen" : "Full screen (Shift for cinema)"}
          aria-label={fullscreen ? "Exit full screen" : "Full screen"}
          aria-pressed={fullscreen} onClick={(event) => toggleFullscreen(event.shiftKey)}><FullScreenIcon /></button>
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
  const stopPreferenceSync = startPreferenceSync();
  const stylesheet = document.createElement("style");
  stylesheet.textContent = `${fontCss}\n${desktopCss}\n${settingsCss}\n${viewCss}`;
  document.head.append(stylesheet);
  let stopProvider: (() => void) | undefined;
  let playbarButtons: ReturnType<typeof playbarViewButtons> | undefined;
  let showPlaybarPopout = false;
  function applyRuntimeSettings() {
    const settings = readSettings();
    showPlaybarPopout = settings.cinema_lyrics;
    playbarButtons?.sync(showPlaybarPopout);
    setFrameCap(settings.animation_fps_cap_enabled ? settings.animation_fps_cap : 0);
    const disabled = settings.lyrics_sources_disabled;
    if (!disabled.includes("spicy") || !disabled.includes("apple")) {
      stopProvider ??= startSpicyProvider();
    } else {
      stopProvider?.();
      stopProvider = undefined;
    }
  }
  applyRuntimeSettings();
  window.addEventListener(settingsEvent, applyRuntimeSettings);
  function disposeProvider() {
    window.removeEventListener(settingsEvent, applyRuntimeSettings);
    stopProvider?.();
  }
  let close: ((forget?: boolean) => void) | undefined;
  let enterFullscreen: ((mode: FullscreenMode) => void) | undefined;
  let mainContainer: HTMLElement | undefined;
  let button: ReturnType<Host["button"]> | undefined;
  let removeCard: (() => void) | undefined;
  let card: HTMLElement | undefined;
  let cardPanel: HTMLElement | undefined;
  let sidebarCover: string | undefined;
  let closePopout: (() => void) | undefined;
  let opening = false;
  let switchingLyricsView = false;
  let disposed = false;
  let restorePending = sessionStorage.getItem(activeViewKey) === "open";
  const sidebarArtwork = nowPlayingArtwork(host.playing);

  function setSidebarCover(cover?: string) {
    if (sidebarCover === cover) return;
    sidebarCover = cover;
    sidebarArtwork.sync(findNowPlaying(), cover);
  }

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
          playbarButtons?.setPopoutActive(false);
          root.unmount();
        }
        const dismiss = () => { release(); view.close(); };
        view.addEventListener("pagehide", release);
        closePopout = dismiss;
        playbarButtons?.setPopoutActive(true);
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

  async function open(mode?: FullscreenMode) {
    restorePending = false;
    if (close) {
      if (mode) enterFullscreen?.(mode);
      else close();
      return;
    }
    if (switchingLyricsView || disposed) return;
    switchingLyricsView = true;
    try { await host.leaveOtherLyricsView(); }
    catch (error) {
      console.warn("[Lyssna Lyrics] Could not leave the other lyrics view:", error);
      return;
    } finally { switchingLyricsView = false; }
    if (disposed) return;
    const parent = document.createElement("div");
    parent.className = "lyssna-lyrics-view";
    const main = host.mainView();
    if (!main) parent.classList.add("lyssna-full-window");
    const shadowHost = document.createElement("div");
    shadowHost.className = "lyssna-lyrics-view lyssna-lyrics-host";
    // Spotify's scrollbar observer excludes mutations inside shadow roots.
    const shadow = shadowHost.attachShadow({ mode: "open" });
    shadow.append(stylesheet.cloneNode(true), parent);
    (main ?? document.body).append(shadowHost);
    const root = host.mount(parent);
    const dismiss = (forget = true) => {
      close = undefined;
      enterFullscreen = undefined;
      mainContainer = undefined;
      button?.setActive(false);
      root.unmount();
      shadowHost.remove();
      setSidebarCover();
      if (forget) sessionStorage.removeItem(activeViewKey);
    };
    close = dismiss;
    mainContainer = shadowHost;
    button?.setActive(true);
    sessionStorage.setItem(activeViewKey, "open");
    let fullscreenRequest = 0;
    const closeView = () => dismiss();
    const render = () => root.render(<LyricsView host={host} options={options} close={closeView} parent={parent}
      openPopout={openPopout} fullscreenRequest={fullscreenRequest} onSidebarCover={setSidebarCover} />);
    enterFullscreen = (next) => {
      fullscreenRequest++;
      render();
      if (next === "display") requestDisplayFullscreen(parent);
    };
    if (mode) enterFullscreen(mode);
    else render();
  }

  let stopViewSwitch: () => void;
  try {
    button = host.button(`Lyssna Lyrics (${channelLabels[options.channel]})`, () => void open());
    stopViewSwitch = host.watchViewSwitch(() => close?.());
  } catch (error) {
    button?.remove();
    disposeProvider();
    stopPreferenceSync();
    stylesheet.remove();
    throw error;
  }
  const viewButtons = playbarButtons = playbarViewButtons(host,
    (event) => void open(event.shiftKey ? "cinema" : "display"),
    pictureInPicture ? () => void openPopout().catch((error) => console.warn("[Lyssna Lyrics] Could not open pop-out", error)) : undefined,
  );
  const stopEnhancementStartup = startEnhancements();

  function attachCard(panel: HTMLElement | null) {
    if (panel?.querySelector("#LyssnaLyricsNPVCard, #SpicyLyricsNPVCard")) panel = null;
    if (panel !== cardPanel) {
      removeCard?.();
      removeCard = undefined;
      card = undefined;
      cardPanel = panel ?? undefined;
    }
    if (!panel) return;
    if (!card) {
      const container = document.createElement("div");
      container.className = "lyssna-lyrics-view lyssna-npv";
      card = container;
      placeNowPlayingPreview(panel, container);
      const root = host.mount(container);
      root.render(<NowPlayingCard host={host} open={() => { if (!close) void open(); }} />);
      removeCard = () => { root.unmount(); container.remove(); };
    } else placeNowPlayingPreview(panel, card);
  }
  function syncHost() {
    viewButtons.sync(showPlaybarPopout);
    if (restorePending && host.mainView()) void open();
    if (mainContainer && !mainContainer.isConnected) close?.();
    const panel = findNowPlaying();
    attachCard(panel);
    sidebarArtwork.sync(panel, sidebarCover);
  }
  const observer = new MutationObserver(syncHost);
  observer.observe(document.body, { childList: true, subtree: true });
  syncHost();
  return {
    dispose() {
      disposed = true;
      observer.disconnect();
      stopViewSwitch();
      removeCard?.();
      closePopout?.();
      close?.(false);
      button?.remove();
      viewButtons.dispose();
      sidebarArtwork.dispose();
      disposeProvider();
      stopPreferenceSync();
      stopEnhancementStartup();
      stylesheet.remove();
    },
    open: () => { if (!close) void open(); },
  };
}
