import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronUp, Disc3, FoldVertical, MicVocal, Music2, PanelLeftOpen, Settings as GearIcon, UnfoldVertical, X } from "lucide-react";
import { getHost, type CanvasInfo, type Host, type Track } from "./host";
import { useArtworkColor } from "./lyssna/artwork-color";
import { Ambience } from "./lyssna/ambience";
import { setFrameCap } from "./lyssna/frame-cap";
import { FullscreenHeartIcon, FullscreenPauseIcon, FullscreenPlayIcon, FullscreenRepeatIcon, FullscreenShuffleIcon, FullscreenVolumeIcon, SkipNextIcon, SkipPreviousIcon } from "./lyssna/fullscreen-icons";
import { LyricsDisplay, LyricsSkeleton, WriterCredits } from "./lyssna/renderer";
import { markerColour } from "./lyssna/highlighter";
import { SpaceGravityLyrics } from "./lyssna/space-gravity-lyrics";
import { CompactIcon, FullScreenIcon, HideArtworkIcon, RetryIcon, SwapSidesIcon, TranslateIcon, UploadIcon, WordSyncIcon } from "./lyssna/toolbar-icons";
import type { Lyrics } from "./lyssna/types";
import { setWindowActivity, setWindowPosition } from "./lyssna/window-activity";
import { filterWords } from "./lyssna/word-filter";
import { displayLyrics, needsWordSync } from "./word-sync";
import type { AudioAnalysisData } from "./experimental-word-sync";
import { readSettings, saveSettings, settingsEvent, type Settings } from "./settings";
import { channelLabels, SettingsPanel, type BuildOptions } from "./settings-panel";
import { startSpicyProvider } from "./spicy";
import { useAppFonts } from "./lyssna/custom-fonts";
import { downloadTtml, keepTemporaryLyricsFor, listLocalLyrics, lyricsChanged, removeLocalLyrics } from "./local-lyrics";
import { LoadTtml } from "./lyssna/load-ttml";
import { attachBulkLyrics, importLyricFile, loadBulkLyrics } from "./ttml-import";
import { enabledSources, readLyrics, refreshLyrics, sourceIds } from "./lyric-sources";
import { LyricCredits } from "./credits";
import { CanvasArtwork, SpotifyVisualiser, useCanvas } from "./spotify-artwork";
import { findNowPlaying, nowPlayingArtwork, nowPlayingCanvas, placeNowPlayingPreview } from "./now-playing";
import { TrackMetadata } from "./track-metadata";
import { useDefaultLyricsFont } from "./lyrics-font-fallback";
import { clock, usePlayback, usePlaybackControls, usePosition } from "./playback";
import { LyricsPopout, pictureInPicture } from "./popout";
import { startEnhancements } from "./enhancements";
import { startPreferenceSync } from "./preference-sync";
import { playbarViewButtons } from "./playbar-fullscreen";
import { quickEffects } from "./quick-effects";
import { DJ_COVER, DJInterlude } from "./dj-interlude";
import { readViewSession, saveViewSession } from "./view-session";
import { lyssnaApiNotice, lyssnaInstallReady } from "./lyssna-api";
import { invalidateLyssnaSong, resumeLyssnaRequests } from "./lyssna-provider";
import { submitLyssnaTtml } from "./lyssna-submission";
import { trackLyssnaListens, useLyssnaPlay } from "./lyssna-plays";
import { MotionArtwork, useMotionArtwork } from "./motion-artwork";
import fontCss from "./fonts/fonts.css?inline";
import desktopCss from "./lyssna/lyrics.css?inline";
import settingsCss from "./lyssna/settings.css?inline";
import ttmlCss from "./lyssna/load-ttml.css?inline";
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
    const revalidate = enabled.includes("lyssna");
    let generation = 0;
    let timer = 0;
    let deadline = 0;
    async function read() {
      view.clearTimeout(timer);
      const current = ++generation;
      if (enabled.length === 0) return;
      const lyrics = await readLyrics(track, duration, enabled);
      if (generation !== current) return;
      setLyrics(lyrics);
      const pendingSpicy = enabled.includes("spicy") || enabled.includes("apple");
      const pending = !lyrics && pendingSpicy && Date.now() < deadline;
      setWaiting(pending);
      if (!view.document.hidden && navigator.onLine && (revalidate || (!lyrics && pendingSpicy))) {
        timer = view.setTimeout(read, lyrics ? 60_000 : pending ? 500 : pendingSpicy ? 3_000 : 60_000);
      }
    }
    function restart(event?: Event) {
      if (event instanceof CustomEvent && Array.isArray(event.detail) && !event.detail.includes(track.id)) return;
      setLyrics(undefined);
      setWaiting(enabled.length > 0);
      deadline = Date.now() + 15_000;
      void read();
    }
    const resume = () => { if (!view.document.hidden) void read(); };
    const reconnect = () => {
      if (revalidate) resumeLyssnaRequests();
      resume();
    };
    window.addEventListener(lyricsChanged, restart);
    window.addEventListener("online", reconnect);
    if (revalidate) window.addEventListener(lyssnaInstallReady, reconnect);
    view.document.addEventListener("visibilitychange", resume);
    restart();
    return () => {
      generation++;
      view.clearTimeout(timer);
      window.removeEventListener(lyricsChanged, restart);
      window.removeEventListener("online", reconnect);
      window.removeEventListener(lyssnaInstallReady, reconnect);
      view.document.removeEventListener("visibilitychange", resume);
    };
  }, [track, duration, view, sourceKey]);
  return { lyrics, waiting };
}

function LyricsForTrack({ track, host, playing, settings, view = window, fullView = view === window }: {
  track: Track; host: Host; playing: boolean; settings: Settings; view?: Window; fullView?: boolean;
}) {
  const duration = host.duration();
  const data = useTrackLyrics(track, duration, view, settings);
  return <TrackLyrics track={track} host={host} playing={playing} settings={settings} view={view} fullView={fullView}
    duration={duration} {...data} />;
}

function TrackLyrics({ track, host, playing, settings, compact = false, view = window, fullView = !compact, duration, lyrics, waiting }: {
  track: Track; host: Host; playing: boolean; settings: Settings; compact?: boolean; view?: Window; fullView?: boolean;
  duration: number; lyrics?: Lyrics; waiting: boolean;
}) {
  const playMarker = useLyssnaPlay(host, track.id, lyrics?.lyssna?.songId, playing, view);
  const position = usePosition(host, playing, view);
  const time = position + settings.lyric_offset_ms + (settings.lyric_song_offsets[track.id] ?? 0);
  const gravity = fullView && settings.space_gravity && !!lyrics &&
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
  const upcoming = fullView && settings.lyrics_up_next && duration > 0 && position >= duration - 30_000 ? host.upcoming() : undefined;
  const upNext = upcoming && <div className="lyrics-up-next">
    <button type="button" className="lyrics-up-next-body first" onClick={host.next}>
      {upcoming.image && <img className="cover" src={upcoming.image} alt="" />}
      <span className="lyrics-up-next-text"><small>Up next</small>
        <strong className="lyrics-up-next-title">{upcoming.title}</strong>
        <span className="lyrics-up-next-artist">{upcoming.artist}</span></span>
    </button>
  </div>;

  if (gravity && rendered?.synced && rendered.lines.some((line) => line.words.length)) {
    return <div className={fontClass} style={{ display: "contents" }}><span ref={playMarker} hidden /><SpaceGravityLyrics lyrics={rendered} time={time} reduceMotion={settings.reduce_motion}
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
  if (rendered) return <div className={fontClass} style={{ display: "contents" }}><span ref={playMarker} hidden /><LyricsDisplay lyrics={rendered} positionMs={time} settings={settings}
    onSeek={host.seek} compact={compact} upNext={upNext} /></div>;
  if (waiting && settings.lyrics_skeleton) return <LyricsSkeleton />;
  if (!waiting && !settings.lyrics_no_lyrics_notice) return null;
  return <div className="lyrics-message" role="status"><MicVocal />
    <h2>{waiting ? "Finding lyrics…" : "Lyrics unavailable"}</h2>
  </div>;
}

type NowPlayingMode = "preview" | "expanded" | "collapsed";
const nowPlayingModeKey = "lyssna-lyrics.v1.now-playing-mode";

function NowPlayingCard({ host, open, expand }: { host: Host; open: () => void; expand: (expanded: boolean) => void }) {
  const { track, playing } = usePlayback(host);
  const settings = useLiveSettings();
  if (!track || settings.lyrics_hide_npv) return null;
  return <NowPlayingLyrics key={track.id} track={track} playing={playing} settings={settings} host={host} open={open} expand={expand} />;
}

function NowPlayingLyrics({ track, playing, settings, host, open, expand }: {
  track: Track; playing: boolean; settings: Settings; host: Host; open: () => void; expand: (expanded: boolean) => void;
}) {
  const fonts = useAppFonts(settings);
  const duration = host.duration();
  const data = useTrackLyrics(track, duration, window, settings);
  const hasLyrics = !!data.lyrics?.lines.length;
  const [mode, setMode] = useState<NowPlayingMode>(() => {
    const saved = localStorage.getItem(nowPlayingModeKey);
    return saved === "expanded" || saved === "collapsed" ? saved : "preview";
  });
  const expanded = mode === "expanded" && hasLyrics;
  const collapsed = mode === "collapsed";

  useLayoutEffect(() => {
    if (!expanded) return;
    expand(true);
    return () => expand(false);
  }, [expand, expanded]);

  function change(next: NowPlayingMode) {
    localStorage.setItem(nowPlayingModeKey, next);
    setMode(next);
  }

  if (!hasLyrics && settings.lyrics_hide_npv_empty) return null;
  const expandLabel = expanded ? "Exit expanded lyrics" : "Expand lyrics";
  const collapseLabel = collapsed ? "Show lyrics" : "Collapse lyrics";
  return <aside className={`lyssna-now-playing-card lyric-preview${expanded ? " expanded" : ""}${collapsed ? " collapsed" : ""}${settings.reduce_motion ? " reduce-motion" : ""}`}
    aria-label="Lyssna Lyrics preview" data-has-lyrics={hasLyrics || undefined}
    style={{ ...fonts, "--lyric-size": `${settings.lyric_size}px` } as CSSProperties}>
    <header>
      <h2>Lyrics</h2>
      <div className="lyssna-now-playing-actions">
        <button type="button" className="lyric-card-control" aria-label="Open lyrics" title="Open lyrics" onClick={open}><PanelLeftOpen size={18} /></button>
        <button type="button" className="lyric-card-control" aria-label={expandLabel} title={expandLabel} aria-pressed={expanded}
          disabled={!hasLyrics} onClick={() => change(expanded ? "preview" : "expanded")}>
          {expanded ? <FoldVertical size={18} /> : <UnfoldVertical size={18} />}
        </button>
        <button type="button" className="lyric-card-control lyric-card-toggle" aria-label={collapseLabel} title={collapseLabel}
          aria-expanded={!collapsed} onClick={() => change(collapsed ? "preview" : "collapsed")}><ChevronUp size={18} /></button>
      </div>
    </header>
    {!collapsed && <div className="lyssna-now-playing-lines" data-scroll-size-contained=""><TrackLyrics track={track} host={host}
      playing={playing} settings={settings} compact duration={duration} {...data} /></div>}
  </aside>;
}

function NowPlayingBackdrop({ host, panel }: { host: Host; panel: HTMLElement }) {
  const { track, playing } = usePlayback(host);
  const settings = useLiveSettings();
  const enabled = !!track?.cover && settings.npv_ambience;
  const canvas = useMemo(() => () => nowPlayingCanvas(panel), [panel]);

  useLayoutEffect(() => {
    if (!enabled) return;
    panel.classList.add("lyssna-npv-ambient-panel");
    return () => panel.classList.remove("lyssna-npv-ambient-panel");
  }, [enabled, panel]);

  return enabled && <Ambience image={track?.cover} animate={playing} reduceMotion={settings.reduce_motion} followCanvas={canvas} />;
}

function PopoutView({ host, view, close }: { host: Host; view: Window; close: () => void }) {
  const { track, playing, narrating } = usePlayback(host, true);
  const settings = useLiveSettings();
  return <LyricsPopout host={host} view={view} close={close} track={track} playing={playing} settings={settings} narrating={narrating}>
    {track && <LyricsForTrack key={track.id} track={track} host={host} playing={playing} settings={settings} view={view} />}
  </LyricsPopout>;
}

function clearPointerFocus({ currentTarget }: { currentTarget: HTMLInputElement }) {
  delete currentTarget.dataset.pointerFocus;
}

const rangeFocus = {
  onPointerDown({ currentTarget }: { currentTarget: HTMLInputElement }) { currentTarget.dataset.pointerFocus = ""; },
  onKeyDown: clearPointerFocus,
  onBlur: clearPointerFocus,
};

function FullscreenControls({ host, playing, settings, view, trackId, narrating }: {
  host: Host; playing: boolean; settings: Settings; view: Window; trackId?: string; narrating: boolean;
}) {
  const position = usePosition(host, playing, view);
  const { liked, shuffle, repeat, canJumpDJ, activate, cycleRepeat } = usePlaybackControls(host, trackId, true);
  const likeLabel = liked ? "Remove from Liked Songs" : "Save to Liked Songs";
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
      <input aria-label="Volume" type="range" min={0} max={1} step={0.01} {...rangeFocus}
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
        <input aria-label="Seek position" type="range" min={0} max={duration || 1} {...rangeFocus}
          disabled={narrating || !duration} value={elapsed} onChange={(event) => host.seek(event.target.valueAsNumber)} />
      </div>
      <time>{total}</time>
    </div>
    <div className="lyssna-transport">
      <button type="button" className={`icon-button lyrics-fullscreen-like${liked ? " is-saved" : ""}`}
        title={likeLabel} aria-label={likeLabel} aria-pressed={liked} disabled={!trackId}
        onClick={activate(host.toggleLiked)}><FullscreenHeartIcon /></button>
      {settings.fullscreen_volume === "left" && volumeSlider}
      <button type="button" className="icon-button" title="Shuffle" aria-label="Shuffle" aria-pressed={shuffle}
        onClick={activate(host.toggleShuffle)}><FullscreenShuffleIcon /></button>
      <button type="button" className="icon-button" aria-label="Previous" onClick={host.previous}><SkipPreviousIcon /></button>
      <button type="button" className="icon-button" aria-label={playing ? "Pause" : "Play"} onClick={host.toggle}>
        {playing ? <FullscreenPauseIcon /> : <FullscreenPlayIcon />}
      </button>
      <button type="button" className="icon-button" aria-label="Next" onClick={host.next}><SkipNextIcon /></button>
      <button type="button" className="icon-button" title={`Repeat (${repeat})`} aria-label={`Repeat (${repeat})`}
        aria-pressed={repeat !== "off"} onClick={activate(cycleRepeat)}><FullscreenRepeatIcon one={repeat === "track"} /></button>
      {canJumpDJ && <button type="button" className="icon-button lyssna-dj" title="Change the DJ mix"
        aria-label="Change the DJ mix" onClick={activate(host.jumpDJ)}><Disc3 /></button>}
      {settings.fullscreen_volume === "right" && volumeSlider}
    </div>
    {settings.fullscreen_volume === "below" && volumeSlider}
  </div>;
}

type FullscreenMode = "display" | "cinema";

function requestDisplayFullscreen(parent: HTMLElement) {
  if (!parent.ownerDocument.fullscreenEnabled || parent.matches(":fullscreen")) return;
  parent.tabIndex = -1;
  // The immersive layout also works when the client rejects the request.
  void parent.requestFullscreen().then(() => parent.focus({ preventScroll: true })).catch(() => {});
}

function LyricsView({ host, options, close, parent, view = window, fullscreenRequest = 0, onSidebarCover }: {
  host: Host; options: BuildOptions; close: () => void; parent: HTMLElement; view?: Window;
  fullscreenRequest?: number;
  onSidebarCover?(cover?: string): void;
}) {
  const externalCinema = view !== window;
  const { track, playing, narrating } = usePlayback(host, true);
  const settings = useLiveSettings();
  const [showSettings, setShowSettings] = useState(false);
  const [showTtml, setShowTtml] = useState(false);
  const [fullscreen, setFullscreen] = useState(fullscreenRequest > 0);
  const [leaving, setLeaving] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [notice, setNotice] = useState("");
  const [artistHeader, setArtistHeader] = useState<{ uri: string; url: string }>();
  const [albumYear, setAlbumYear] = useState<{ uri: string; year: string }>();
  const timer = useRef<number>(0);
  const exitingDisplay = useRef(false);
  const toolsTimer = useRef<number>(0);
  const lyricsPage = useRef<HTMLElement>(null);
  const ttmlButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { if (lyricsPage.current) lyricsPage.current.inert = showTtml; }, [showTtml]);
  const fonts = useAppFonts(settings, view.document);
  const artwork = narrating ? DJ_COVER : track?.cover;
  const coverColour = useArtworkColor(artwork);
  const canvasEnabled = settings.canvas_lyrics && !settings.lyrics_hide_artwork;
  const canvasInfo = useCanvas(host, track?.id, canvasEnabled);
  const [unavailableCanvas, setUnavailableCanvas] = useState<CanvasInfo>();
  const canvas = canvasInfo === unavailableCanvas ? undefined : canvasInfo;
  useEffect(() => setUnavailableCanvas(undefined), [track?.id, canvasEnabled]);
  useLayoutEffect(() => { onSidebarCover?.(canvas ? track?.cover : undefined); }, [canvas, track?.cover, onSidebarCover]);
  const background = settings.lyrics_background;
  const artistUri = track?.artistUri;
  const trackId = track?.id;
  const albumUri = track?.albumUri;
  const motionUrl = useMotionArtwork(albumUri, track?.albumUpc,
    settings.animated_covers && !settings.reduce_motion && !settings.lyrics_hide_artwork && !canvas);
  const [unavailableMotion, setUnavailableMotion] = useState<string>();
  const motion = motionUrl !== unavailableMotion ? motionUrl : undefined;
  const year = track?.year ?? (albumYear?.uri === albumUri ? albumYear?.year : undefined);
  useEffect(() => {
    if (settings.lyrics_year_position === "off" || track?.year || !albumUri || !/^spotify:album:[A-Za-z0-9]{22}$/.test(albumUri)) return;
    let live = true;
    void host.releaseYear(albumUri)?.then((year) => {
      if (live && year) setAlbumYear({ uri: albumUri, year });
    });
    return () => { live = false; };
  }, [host, albumUri, track?.year, settings.lyrics_year_position]);
  function closeTtml() {
    setShowTtml(false);
    view.requestAnimationFrame(() => ttmlButton.current?.focus({ preventScroll: true }));
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
    if (externalCinema) {
      if (parent.matches(":fullscreen")) void view.document.exitFullscreen().catch(() => {});
      else requestDisplayFullscreen(parent);
      return;
    }
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

  const returnToLyrics = fullscreen && !settings.lyrics_escape_exits;
  function closeLyrics() {
    if (returnToLyrics) toggleFullscreen();
    else close();
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
      if (externalCinema) {
        setFullscreen(active);
        return;
      }
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
  }, [parent, close, externalCinema]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 650));
    observer.observe(parent);
    return () => observer.disconnect();
  }, [parent]);
  useEffect(() => {
    parent.classList.toggle("immersive", fullscreen || externalCinema);
    parent.classList.toggle("lyssna-slide-away", leaving);
  }, [parent, fullscreen, externalCinema, leaving]);
  useEffect(() => {
    if (externalCinema) return;
    const update = () => setWindowPosition(window.screenX, window.screenY);
    update();
    if (!settings.space_gravity || settings.reduce_motion) return;
    const id = window.setInterval(update, 100);
    return () => clearInterval(id);
  }, [externalCinema, settings.space_gravity, settings.reduce_motion]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "F11") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (showTtml) closeTtml();
      else if (showSettings) setShowSettings(false);
      else if (event.key === "F11") toggleFullscreen(event.shiftKey);
      else closeLyrics();
    };
    view.document.addEventListener("keydown", keyboard);
    return () => view.document.removeEventListener("keydown", keyboard);
  });

  const hasAmbience = artwork && (background === "animated" || background === "static");
  const banner = background === "artist" && artistHeader?.uri === artistUri ? artistHeader?.url : undefined;
  const backgroundImage = background === "cover" || background === "artist" ? banner || artwork : undefined;
  const compact = narrow || settings.lyrics_compact;
  const className = `lyrics-page ${narrating ? "dj-narration" : ""} ${canvas ? "canvas-lyrics" : ""} ${compact ? "narrow" : ""}
    ${settings.lyrics_hide_artwork ? "no-artwork" : ""} ${settings.lyrics_artwork_right ? "artwork-right" : ""}
    ${background === "color" ? "colour-background" : ""} ${settings.lyrics_toolbar_bottom ? "toolbar-bottom" : ""}
    ${settings.reduce_motion ? "reduce-motion" : ""} ${settings.glass_seek ? "" : "flat-seek"}`;
  const pageStyle = { ...fonts, "--lyric-size": `${Math.round(settings.lyric_size * 1.6)}px`,
    "--lyrics-cover-color": coverColour, "--hero": coverColour } as CSSProperties;
  const artworkDock = !!track && !canvas && !compact && !settings.lyrics_hide_artwork;
  const playback = (fullscreen || externalCinema) && <FullscreenControls host={host} playing={playing} settings={settings}
    view={view} trackId={track?.id} narrating={narrating} />;
  return <>
    {hasAmbience && <Ambience image={artwork} animate={playing && background === "animated"}
      reduceMotion={settings.reduce_motion} followCanvas={canvas ? "window" : false} />}
    {backgroundImage && <img className="lyrics-background" src={backgroundImage}
      style={{ "--artwork-blur": `${settings.lyrics_background_blur}px` } as CSSProperties}
      onError={banner ? () => setArtistHeader((current) => current?.url === banner && current.uri === artistUri ? undefined : current) : undefined} alt="" />}
    <section ref={lyricsPage} className={className} aria-label="Lyssna Lyrics" style={pageStyle}
      onPointerMove={wakeTools} onPointerLeave={sleepTools} onKeyDownCapture={wakeTools}>
      {narrating && <DJInterlude playing={playing} reduceMotion={settings.reduce_motion} />}
      {!narrating && (track ? <>
        <div className="lyrics-album">
          {canvas ? <CanvasArtwork key={`${track.id}:${canvas.fileId ?? canvas.url}`} info={canvas} cover={track.cover}
            playing={playing && !settings.reduce_motion} onUnavailable={setUnavailableCanvas} />
            : (motion || track.cover) && <div className="lyrics-media">{motion
              ? <MotionArtwork key={motion} url={motion} cover={track.cover} playing={playing} onUnavailable={setUnavailableMotion} />
              : <img className={`cover${settings.cover_animation && !settings.reduce_motion ? " crossfade" : ""}`}
                key={track.cover} src={track.cover} alt="" />}
            </div>}
          <TrackMetadata host={host} track={track} year={year} yearPosition={settings.lyrics_year_position}
            reduceMotion={settings.reduce_motion} orderByWidth={!!canvas} />
          {artworkDock && playback}
        </div>
        <div className="lyrics-body"><LyricsForTrack key={track.id} track={track} host={host} playing={playing} settings={settings} view={view} fullView /></div>
      </> : <div className="lyrics-message"><Music2 /><h2>Play something you love</h2><p>Your lyrics will appear here.</p></div>)}
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
        {quickEffects.filter(({ id }) => settings.pinned_lyric_effects.includes(id)).map(({ id, label, Icon }) => (
          <button type="button" key={id} data-icon={id} title={label} aria-label={label} aria-pressed={settings[id]}
            className={`icon-button${settings[id] ? " active" : ""}`}
            onClick={() => change({ [id]: !settings[id] })}><Icon /></button>
        ))}
        <span className="toolbar-divider" aria-hidden="true" />
        <button ref={ttmlButton} type="button" className="icon-button" data-icon="upload" title="Load TTML" aria-label="Load TTML"
          aria-haspopup="dialog" onClick={() => { setNotice(""); setShowTtml(true); }}><UploadIcon /></button>
        {settings.lyrics_cache_button && <button type="button" className="icon-button" data-icon="retry" title="Refresh lyrics" aria-label="Refresh lyrics"
          disabled={!track} onClick={() => { refreshLyrics(track?.id, settings.lyrics_cache_action); setNotice("Refreshing lyrics…"); }}><RetryIcon /></button>}
        <button type="button" className="icon-button" data-icon="fullscreen" title={fullscreen ? "Exit full screen" : externalCinema ? "Full screen" : "Full screen (Shift for cinema)"}
          aria-label={fullscreen ? "Exit full screen" : "Full screen"}
          aria-pressed={fullscreen} onClick={(event) => toggleFullscreen(event.shiftKey)}><FullScreenIcon /></button>
        <button type="button" className="icon-button" data-icon="settings" title="Lyssna settings" aria-label="Lyssna settings"
          onClick={() => { setNotice(""); setShowSettings(true); }}><GearIcon size={18} /></button>
        <button type="button" className="icon-button" title={returnToLyrics ? "Leave full screen" : "Close lyrics"}
          aria-label={returnToLyrics ? "Leave full screen" : "Close lyrics"} onClick={closeLyrics}><X size={18} /></button>
      </div>
      {!showSettings && notice && <div className="lyssna-popout-error" role="status">{notice}</div>}
      {!artworkDock && playback}
    </section>
    {showTtml && <LoadTtml song={track ? track.title || "Unknown song" : undefined} glass={settings.liquid_glass} theme={settings.theme} style={fonts}
      onSubmit={async (file) => {
        if (!track) throw new Error("Play the song you want to submit lyrics for.");
        const result = await submitLyssnaTtml(file, track, host);
        if (result.approved) {
          invalidateLyssnaSong(track.id, result.isrc);
          window.dispatchEvent(new CustomEvent(lyricsChanged, { detail: [track.id] }));
        }
        closeTtml();
        setNotice(result.message);
      }}
      onLoad={async (file, mode) => {
        if (!track) throw new Error("Play a song first.");
        await importLyricFile(file, track, mode, () => host.track()?.id);
        closeTtml();
        setNotice("Imported lyrics.");
      }}
      onReset={async () => {
        if (!track) return;
        await removeLocalLyrics(`spotify:track:${track.id}`, true);
        closeTtml();
        setNotice("Imported lyrics cleared for this song.");
      }}
      onGuide={() => view.open("https://lyrprep.spicylyrics.org/guide", "_blank", "noopener,noreferrer")}
      listSaved={listLocalLyrics} deleteSaved={removeLocalLyrics} onPlay={host.playTrack} onDownload={downloadTtml}
      onBulk={(files, signal) => loadBulkLyrics(files, host, signal)} searchSongs={host.searchTracks}
      attachSong={attachBulkLyrics} onClose={closeTtml} />}
    {showSettings && <SettingsPanel settings={settings} change={change} close={() => { setNotice(""); setShowSettings(false); }}
      options={options} trackId={track?.id} notice={notice} setNotice={setNotice} view={view} developerMode={host.developerMode} />}
  </>;
}

export default function start(options: BuildOptions) {
  const host = getHost();
  const stopPreferenceSync = startPreferenceSync();
  const stylesheet = document.createElement("style");
  stylesheet.textContent = `${fontCss}\n${desktopCss}\n${settingsCss}\n${ttmlCss}\n${viewCss}`;
  document.head.append(stylesheet);
  let stopProvider: (() => void) | undefined;
  let playbarButtons: ReturnType<typeof playbarViewButtons> | undefined;
  let showPlaybarPopout = false;
  let showPlaybarCinema = false;
  function syncPlaybar() {
    playbarButtons?.sync(showPlaybarPopout, showPlaybarCinema && host.developerMode !== false);
  }
  function applyRuntimeSettings() {
    const settings = readSettings();
    showPlaybarPopout = settings.cinema_lyrics;
    showPlaybarCinema = settings.cinema_window;
    syncPlaybar();
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
  let mutedPreviewPanel: HTMLElement | undefined;
  let backdrop: { panel: HTMLElement; container: HTMLElement; dispose(): void } | undefined;
  let sidebarCover: string | undefined;
  type DetachedMode = "popout" | "cinema";
  let detached: { mode: DetachedMode; view: Window; dismiss(): void } | undefined;
  let opening = false;
  let switchingLyricsView = false;
  let disposed = false;
  let rememberedView = readViewSession();
  let pendingView = rememberedView;
  let restoringRoute = false;
  let unloading = false;
  const sidebarArtwork = nowPlayingArtwork(host.playing);

  function rememberView(lyrics: boolean) {
    const route = host.viewLocation() ?? rememberedView?.route;
    if (rememberedView && route === rememberedView.route && lyrics === rememberedView.lyrics) return;
    rememberedView = { route, lyrics };
    saveViewSession(rememberedView);
  }

  function restoreView() {
    const saved = pendingView;
    const route = host.viewLocation();
    if (!saved || !route || !host.mainView()) return;
    pendingView = undefined;
    if (saved.route && route !== saved.route) {
      if (route !== "/") {
        rememberView(false);
        return;
      }
      restoringRoute = true;
      try {
        host.restoreView(saved.route);
      } catch (error) {
        console.warn("[Lyssna Lyrics] Could not restore the last Spotify page", error);
      } finally {
        restoringRoute = false;
      }
    }
    if (saved.lyrics) void open();
    else rememberView(false);
  }

  function setSidebarCover(cover?: string) {
    if (sidebarCover === cover) return;
    sidebarCover = cover;
    sidebarArtwork.sync(findNowPlaying(), cover);
  }

  async function openDetached(mode: DetachedMode) {
    if (opening || disposed) return;
    const cinema = mode === "cinema";
    if (detached?.mode === mode) {
      if (cinema) detached.view.focus();
      else detached.dismiss();
      return;
    }
    if (cinema ? host.developerMode === false : !pictureInPicture) return;
    opening = true;
    try {
      const view = cinema ? window.open("", "_blank", "popup=yes,width=1280,height=720")
        : await pictureInPicture?.requestWindow({ width: 900, height: 640, disallowReturnToOpener: true });
      if (!view) throw new Error("Spotify did not create the requested lyrics window.");
      if (disposed) { view.close(); return; }
      detached?.dismiss();
      try {
        view.document.head.append(stylesheet.cloneNode(true));
        const parent = view.document.createElement("div");
        parent.className = cinema ? "lyssna-lyrics-view lyssna-cinema-window immersive" : "lyssna-lyrics-view lyssna-popout-view";
        if (cinema) view.document.title = "Cinema Lyrics · Lyssna";
        view.document.body.append(parent);
        const root = host.mount(parent);
        const release = () => {
          if (detached?.view !== view) return;
          view.removeEventListener("pagehide", release);
          window.removeEventListener("pagehide", dismiss);
          detached = undefined;
          playbarButtons?.setPopoutActive(false);
          playbarButtons?.setCinemaActive(false);
          root.unmount();
          syncNowPlaying();
        };
        const dismiss = () => { release(); view.close(); };
        view.addEventListener("pagehide", release, { once: true });
        window.addEventListener("pagehide", dismiss, { once: true });
        detached = { mode, view, dismiss };
        playbarButtons?.setPopoutActive(!cinema);
        playbarButtons?.setCinemaActive(cinema);
        if (cinema) close?.();
        syncNowPlaying();
        root.render(cinema
          ? <LyricsView host={host} options={options} close={dismiss} parent={parent} view={view} />
          : <PopoutView host={host} view={view} close={dismiss} />);
      } catch (error) {
        if (detached?.view === view) detached.dismiss();
        else view.close();
        throw error;
      }
    } finally {
      opening = false;
    }
  }

  async function open(mode?: FullscreenMode) {
    pendingView = undefined;
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
      if (forget && !unloading) rememberView(false);
      close = undefined;
      enterFullscreen = undefined;
      mainContainer = undefined;
      button?.setActive(false);
      root.unmount();
      shadowHost.remove();
      setSidebarCover();
      syncNowPlaying();
    };
    close = dismiss;
    mainContainer = shadowHost;
    syncNowPlaying();
    button?.setActive(true);
    rememberView(true);
    let fullscreenRequest = 0;
    const closeView = () => dismiss();
    const render = () => root.render(<LyricsView host={host} options={options} close={closeView} parent={parent}
      fullscreenRequest={fullscreenRequest} onSidebarCover={setSidebarCover} />);
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
    stopViewSwitch = host.watchViewSwitch((source) => {
      if (unloading || restoringRoute || switchingLyricsView) return;
      const route = host.viewLocation();
      if (pendingView && source === "route" && (route === "/" || route === pendingView.route)) return;
      pendingView = undefined;
      if (close) close();
      else rememberView(false);
    });
  } catch (error) {
    button?.remove();
    disposeProvider();
    stopPreferenceSync();
    stylesheet.remove();
    throw error;
  }
  const viewButtons = playbarButtons = playbarViewButtons(host,
    (event) => void open(event.shiftKey ? "cinema" : "display"),
    pictureInPicture ? () => void openDetached("popout").catch((error) => {
      console.warn("[Lyssna Lyrics] Could not open pop-out", error);
      host.notifyError("Spotify couldn’t open the lyrics pop-out.");
    }) : undefined,
    () => void openDetached("cinema").catch((error) => {
      console.warn("[Lyssna Lyrics] Could not open Cinema Lyrics", error);
      host.notifyError("Spotify couldn’t open the Cinema Lyrics window. Check that Spotify DevTools is enabled.");
    }),
  );
  const stopEnhancementStartup = startEnhancements();
  keepTemporaryLyricsFor(host.track()?.id);
  const stopTemporaryTrack = host.watch(() => keepTemporaryLyricsFor(host.track()?.id));
  const stopLyssnaListens = trackLyssnaListens(host);
  const reportApiNotice = (event: Event) => host.notifyError((event as CustomEvent<string>).detail);
  window.addEventListener(lyssnaApiNotice, reportApiNotice);
  const beginUnload = () => { unloading = true; };
  const resumePage = (event: PageTransitionEvent) => {
    if (event.persisted) {
      unloading = false;
      syncHost();
    }
  };
  window.addEventListener("pagehide", beginUnload);
  window.addEventListener("pageshow", resumePage);
  const updateActivity = () => setWindowActivity({ minimized: document.hidden, focused: document.hasFocus() });
  document.addEventListener("visibilitychange", updateActivity);
  window.addEventListener("focus", updateActivity);
  window.addEventListener("blur", updateActivity);
  updateActivity();

  function syncBackdrop(panel: HTMLElement | null) {
    if (panel?.querySelector(":scope > :is(.lyssna-dynamic-bg, .spicy-dynamic-bg)")) panel = null;
    if (backdrop && backdrop.panel === panel && backdrop.container.parentElement === panel) return;
    backdrop?.dispose();
    backdrop = undefined;
    if (!panel) return;
    const container = document.createElement("div");
    container.className = "lyssna-lyrics-view lyssna-npv-backdrop";
    container.setAttribute("aria-hidden", "true");
    panel.prepend(container);
    const root = host.mount(container);
    root.render(<NowPlayingBackdrop host={host} panel={panel} />);
    backdrop = { panel, container, dispose() { root.unmount(); container.remove(); } };
  }

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
      let mounted = true;
      const expand = (expanded: boolean) => {
        if (!mounted || container.classList.contains("lyssna-npv-expanded") === expanded) return;
        container.classList.toggle("lyssna-npv-expanded", expanded);
        panel.classList.toggle("lyssna-npv-expanded-panel", expanded);
        if (expanded) panel.append(container);
        else placeNowPlayingPreview(panel, container);
      };
      root.render(<NowPlayingCard host={host} open={() => { if (!close) void open(); }} expand={expand} />);
      removeCard = () => {
        mounted = false;
        panel.classList.remove("lyssna-npv-expanded-panel");
        root.unmount();
        container.remove();
      };
    } else if (card.classList.contains("lyssna-npv-expanded")) {
      if (card.parentElement !== panel) panel.append(card);
    } else placeNowPlayingPreview(panel, card);
  }
  function syncNowPlaying(panel = findNowPlaying()) {
    if (disposed) return;
    const lyricsOpen = !!(mainContainer || detached);
    const mute = lyricsOpen ? panel ?? undefined : undefined;
    if (mute !== mutedPreviewPanel) {
      mutedPreviewPanel?.classList.remove("lyssna-npv-hide-lyrics");
      mute?.classList.add("lyssna-npv-hide-lyrics");
      mutedPreviewPanel = mute;
    }
    attachCard(lyricsOpen ? null : panel);
  }
  function syncHost() {
    if (unloading) return;
    syncPlaybar();
    if (pendingView) restoreView();
    else if (!rememberedView && !switchingLyricsView && host.viewLocation()) rememberView(false);
    const main = mainContainer && host.mainView();
    if (mainContainer && main && mainContainer.parentElement !== main) {
      main.append(mainContainer);
      mainContainer.shadowRoot?.querySelector(".lyssna-full-window")?.classList.remove("lyssna-full-window");
    }
    const panel = findNowPlaying();
    syncBackdrop(panel);
    syncNowPlaying(panel);
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
      backdrop?.dispose();
      mutedPreviewPanel?.classList.remove("lyssna-npv-hide-lyrics");
      detached?.dismiss();
      close?.(false);
      button?.remove();
      viewButtons.dispose();
      sidebarArtwork.dispose();
      disposeProvider();
      stopPreferenceSync();
      stopEnhancementStartup();
      stopTemporaryTrack();
      stopLyssnaListens();
      window.removeEventListener(lyssnaApiNotice, reportApiNotice);
      window.removeEventListener("pagehide", beginUnload);
      window.removeEventListener("pageshow", resumePage);
      document.removeEventListener("visibilitychange", updateActivity);
      window.removeEventListener("focus", updateActivity);
      window.removeEventListener("blur", updateActivity);
      stylesheet.remove();
    },
    open: () => { if (!close) void open(); },
  };
}
