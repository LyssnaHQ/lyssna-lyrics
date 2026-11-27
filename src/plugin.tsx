import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode, type RefObject } from "react";
import { ChevronUp, Disc3, FilePenLine, FoldVertical, ListMusic, MessagesSquare, MicVocal, Music2, PanelLeftOpen, Settings as GearIcon, UnfoldVertical, X } from "lucide-react";
import { getHost, type CanvasInfo, type Host, type Root, type Track } from "./host";
import { spotifySongUri } from "./spotify-song";
import { useArtworkColor } from "./lyssna/artwork-color";
import { Ambience } from "./lyssna/ambience";
import { setFrameCap } from "./lyssna/frame-cap";
import { FullscreenHeartIcon, FullscreenPauseIcon, FullscreenPlayIcon, FullscreenRepeatIcon, FullscreenShuffleIcon, FullscreenVolumeIcon, SkipNextIcon, SkipPreviousIcon } from "./lyssna/fullscreen-icons";
import { LyricsDisplay, LyricsSkeleton, WriterCredits } from "./lyssna/renderer";
import { markerColour } from "./lyssna/highlighter";
import { SpaceGravityLyrics } from "./lyssna/space-gravity-lyrics";
import type { VisualiserFrame } from "./lyssna/visualiser-frame";
import { CompactIcon, FullScreenIcon, HideArtworkIcon, RetryIcon, SwapSidesIcon, TranslateIcon, UploadIcon, WordSyncIcon } from "./lyssna/toolbar-icons";
import type { Lyrics } from "./lyssna/types";
import { useRomanizedLyrics } from "./lyssna/romanization";
import { useTranslatedLyrics } from "./lyssna/translated-lyrics";
import { setWindowActivity, setWindowPosition } from "./lyssna/window-activity";
import { filterWords } from "./lyssna/word-filter";
import { displayLyrics, needsWordSync } from "./word-sync";
import type { AudioAnalysisData } from "./experimental-word-sync";
import { readSettings, saveSettings, settingsEvent, type Settings } from "./settings";
import { channelLabels, SettingsPanel, type BuildOptions } from "./settings-panel";
import { appFontStyles, copySpotifyFonts, selectedFont } from "./font-settings";
import { downloadTtml, keepTemporaryLyricsFor, listLocalLyrics, lyricsChanged, removeLocalLyrics } from "./local-lyrics";
import { LoadTtml } from "./lyssna/load-ttml";
import { useReviewerSettings } from "./ttml-reviewer";
import { attachBulkLyrics, importLyricFile, loadBulkLyrics } from "./ttml-import";
import { enabledSources, readLyrics, readMissingSongwriters, refreshLyrics, refreshPublishedLyrics, sourceIds, songLyricSource } from "./lyric-sources";
import { LyricCredits } from "./credits";
import { SongSheetScope } from "./song-sheet";
import { CanvasArtwork, placeholderArtwork, SpotifyVisualiser, TrackArtwork, useCanvas } from "./spotify-artwork";
import { findNowPlaying, findNowPlayingCover, findPlaybarCover, nowPlayingArtistCard, nowPlayingArtwork, nowPlayingCanvas, placeNowPlayingPreview } from "./now-playing";
import { TrackMetadata } from "./track-metadata";
import { useDefaultLyricsFont } from "./lyrics-font-fallback";
import { clock, usePlayback, usePlaybackControls, usePosition } from "./playback";
import { LyricsPopout, pictureInPicture } from "./popout";
import { startEnhancements } from "./enhancements";
import { startLocalPlaylistPlayback } from "./enhancements/features/localPlaylistPlayback";
import { closeNowPlayingView } from "./enhancements/features/disablePeek";
import { getSetting, subscribeSettings } from "./enhancements/config";
import { startVolumeDragController } from "./enhancements/features/volumeDrag";
import { startPreferenceSync } from "./preference-sync";
import { uploadAsTopbar } from "./upload-as-topbar";
import { playbarViewButtons } from "./playbar-fullscreen";
import { findPlaybarControls } from "./playbar-controls";
import { quickEffects, QuickEffectPicker, SongSourcePicker, type QuickEffectChoice } from "./quick-effects";
import { DJ_COVER, DJInterlude } from "./dj-interlude";
import { readViewSession, saveViewSession } from "./view-session";
import { lyssnaApiNotice, lyssnaInstallReady } from "./lyssna-api";
import { requestLyssnaLyrics, resumeLyssnaRequests } from "./lyssna-provider";
import { InstrumentalAction } from "./instrumental-actions";
import { submitLyssnaTtml, type SubmissionFeedback } from "./lyssna-submission";
import { SubmissionNotice } from "./submission-notice";
import { useLocalTrackIsrc } from "./local-track-isrc";
import { useFirstUploadNotice } from "./first-upload-notice";
import { CreatorSurface, type CreatorPlayback } from "./creator/surface";
import { createReviewEditor, type ReviewEditor, type ReviewOpen } from "./creator/review-editor";
import { ReviewPanel } from "./creator/review-panel";
import { resizeReviewSidebar, watchNativeSidebar } from "./creator/review-sidebar";
import { reviewTopbar } from "./creator/review-topbar";
import { startCreatorRepeatRecovery } from "./creator/repeat";
import { restoreCreatorPlaybackTransitions } from "./creator/playback-transitions";
import { createSpotifyCapture, type SpotifyCapture } from "./creator/spotify-capture";
import { PlaybarRecorder } from "./creator/auto-record";
import { fromLyrics, joinHyphenated, toLyrics } from "./creator/ttml-creator-model";
import { dismissDraft, publishDraftPreview, useDraftPreview } from "./creator/ttml-working";
import { trackLyssnaListens, useLyssnaPlay } from "./lyssna-plays";
import { MotionArtwork, useAlbumMotionArtwork } from "./motion-artwork";
import { discordInvite, startReleaseNotices } from "./release-notices";
import fontCss from "./fonts/fonts.css?inline";
import desktopCss from "./lyssna/lyrics.css?inline";
import settingsCss from "./lyssna/settings.css?inline";
import ttmlCss from "./lyssna/load-ttml.css?inline";
import reviewCss from "./creator/review.css?inline";
import viewCss from "./view.css?inline";
import meterCss from "./creator/recording-meter.css?inline";
import scrollbars from "./scrollbars.css?inline";

const popupGlassAttribute = "data-lyssna-liquid-glass";
const reviewSidebarKey = "lyssna-lyrics.review-sidebar-open";

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

function useTrackLyrics(track: Track | null, duration: number, view: Window, settings: Settings, host: Host) {
  const [result, setResult] = useState<{ track: Track; sourceKey: string; lyrics?: Lyrics; waiting: boolean }>();
  const sourceKey = enabledSources(settings).join(",");
  useEffect(() => {
    if (!track) {
      setResult(undefined);
      return;
    }
    const currentTrack = track;
    const enabled = sourceKey.split(",").filter((id): id is (typeof sourceIds)[number] => sourceIds.some((source) => source === id));
    let generation = 0;
    let timer = 0;
    let appleRetries = 0;
    let preference = songLyricSource(currentTrack);
    async function read() {
      view.clearTimeout(timer);
      const current = ++generation;
      const preferred = preference;
      let appleUnavailable = false;
      const lyrics = await readLyrics(currentTrack, duration, enabled, host, {
        preferred, onAppleUnavailable: () => { appleUnavailable = true; },
      }).catch(() => undefined);
      if (generation !== current) return;
      setResult((previous) => previous?.track === currentTrack && previous.sourceKey === sourceKey &&
        previous.lyrics === lyrics && !previous.waiting
        ? previous : { track: currentTrack, sourceKey, lyrics, waiting: false });
      if (!view.document.hidden && navigator.onLine) {
        if (appleUnavailable && appleRetries < 2) {
          appleRetries++;
          timer = view.setTimeout(read, 45_000);
        } else if (enabled.includes("lyssna") || enabled.includes("apple") || preferred === "lyssna" || preferred === "apple") {
          if (!appleUnavailable) appleRetries = 0;
          timer = view.setTimeout(read, 60_000);
        }
      }
    }
    function restart(event?: Event) {
      if (event instanceof CustomEvent && Array.isArray(event.detail) && !event.detail.includes(currentTrack.id)) return;
      const nextPreference = songLyricSource(currentTrack);
      const sourceChanged = preference !== nextPreference;
      preference = nextPreference;
      if (sourceChanged) appleRetries = 0;
      setResult((previous) => ({
        track: currentTrack, sourceKey, waiting: enabled.length > 0 || !!preference,
        lyrics: event && !sourceChanged && previous?.track === currentTrack ? previous.lyrics : undefined,
      }));
      void read();
    }
    const resume = () => { if (!view.document.hidden) void read(); };
    const reconnect = () => {
      resumeLyssnaRequests();
      resume();
    };
    window.addEventListener(lyricsChanged, restart);
    window.addEventListener("online", reconnect);
    window.addEventListener(lyssnaInstallReady, reconnect);
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
  return result && result.track === track && result.sourceKey === sourceKey
    ? { lyrics: result.lyrics, waiting: result.waiting } : { lyrics: undefined, waiting: !!track && !!sourceKey };
}

function MissingLyrics({ track, host, openCreator, searchAgain, openTtml }: {
  track: Track; host: Host; openCreator?: () => void;
  searchAgain: () => void; openTtml: (trigger: HTMLButtonElement) => void;
}) {
  const [requesting, setRequesting] = useState(false);
  const [requested, setRequested] = useState(false);
  const [markNotice, setMarkNotice] = useState<{ message: string; error?: true }>();
  async function request() {
    setRequesting(true);
    setMarkNotice(undefined);
    try {
      const count = await requestLyssnaLyrics(track);
      setRequested(true);
      setMarkNotice({ message: count === 1 ? "Requested. You’re the first to ask for lyrics." : `Requested. ${count} people want lyrics for this song.` });
    } catch (error) {
      setMarkNotice({ message: error instanceof Error ? error.message : "Couldn’t request lyrics.", error: true });
    } finally {
      setRequesting(false);
    }
  }

  return <div className="lyrics-message lyssna-missing-lyrics">
    <MicVocal aria-hidden="true" />
    <h2 role="status">No lyrics yet</h2>
    <p>Nobody has synced this song yet. Sync it in the TTML Creator, or ask the community on Discord.</p>
    <div className="lyssna-missing-actions">
      {openCreator && <button className="lyssna-missing-action" type="button" onClick={openCreator}>
        <FilePenLine size={18} aria-hidden="true" />
        Open TTML Creator
      </button>}
      <a className="lyssna-missing-action" href={discordInvite} target="_blank" rel="noopener noreferrer">
        <MessagesSquare size={18} aria-hidden="true" />
        Join our Discord
      </a>
    </div>
    <div className="lyssna-missing-links">
      <button type="button" onClick={searchAgain}>Search again</button>
      <span aria-hidden="true">·</span>
      <button type="button" aria-haspopup="dialog" onClick={(event) => openTtml(event.currentTarget)}>Import a lyric file</button>
      {!track.local && <>
        <span aria-hidden="true">·</span>
        <button type="button" onClick={() => void request()} disabled={requesting || requested}>
          {requested ? "Requested" : requesting ? "Requesting…" : "Request lyrics"}</button>
        <InstrumentalAction track={track} host={host}
          notify={(message, error) => setMarkNotice({ message, error: error ? true : undefined })} />
      </>}
    </div>
    {markNotice && <small role={markNotice.error ? "alert" : "status"}>{markNotice.message}</small>}
  </div>;
}

function TrackLyrics({ track, host, playing, settings, compact = false, view = window, fullView = !compact, duration, lyrics, waiting, localPlayback, visualiser }: {
  track: Track; host: Host; playing: boolean; settings: Settings; compact?: boolean; view?: Window; fullView?: boolean;
  duration: number; lyrics?: Lyrics; waiting: boolean; localPlayback?: CreatorPlayback;
  visualiser?: RefObject<VisualiserFrame | null>;
}) {
  const playMarker = useLyssnaPlay(host, track.id, lyrics?.lyssna?.songId, lyrics?.external, playing, view);
  const position = usePosition(host, playing, view, localPlayback?.read);
  const offset = settings.lyric_offset_ms + (settings.lyric_song_offsets[track.id] ?? 0);
  const time = position + offset;
  function seek(ms: number) {
    const target = Math.max(0, Math.min(duration || Infinity, Math.round(ms - offset)));
    (localPlayback?.seek ?? host.seek)(target);
    return target + offset;
  }
  const gravity = fullView && settings.space_gravity && !!lyrics &&
    !lyrics.instrumental && (lyrics.synced || duration > 0);
  const estimateTiming = settings.experimental_word_sync || gravity || (!lyrics?.synced && settings.lyrics_highlighter);
  const [analysis, setAnalysis] = useState<AudioAnalysisData>();
  const [extraWriters, setExtraWriters] = useState<{ trackId: string; lyrics: Lyrics; appleEnabled: boolean; names: string[] }>();
  const appleEnabled = !settings.lyrics_sources_disabled.includes("apple");
  useEffect(() => {
    if (!lyrics?.lines.length || lyrics.songwriters?.length) return;
    let active = true;
    void readMissingSongwriters(track, duration, lyrics, host, appleEnabled).then((names) => {
      if (active && names?.length) setExtraWriters({ trackId: track.id, lyrics, appleEnabled, names });
    }).catch(() => {});
    return () => { active = false; };
  }, [track, duration, host, lyrics, appleEnabled]);
  const analyse = !!lyrics && estimateTiming && needsWordSync(lyrics, duration);
  useEffect(() => {
    if (!analyse) return;
    let active = true;
    void host.analysis(track.id)?.then((data) => {
      if (active && data) setAnalysis({ track: data.track, segments: data.segments ?? [], beats: data.beats ?? [] });
    });
    return () => { active = false; };
  }, [host, track.id, analyse]);
  const translated = useTranslatedLyrics(lyrics, settings.lyrics_translations);
  const timedLyrics = useMemo(() => displayLyrics(translated, estimateTiming, duration, analysis),
    [translated, estimateTiming, duration, analysis]);
  const romanized = useRomanizedLyrics(timedLyrics, settings.romanized,
    settings.romanization_below && !gravity, settings.romaji_as_written);
  const rendered = filterWords(romanized, settings.lyrics_word_filter);
  const fallbackWriters = extraWriters?.trackId === track.id && extraWriters.lyrics === lyrics &&
    extraWriters.appleEnabled === appleEnabled ? extraWriters.names : undefined;
  const defaultFont = useDefaultLyricsFont(selectedFont(settings, "lyric_font"), rendered, view.document);
  const fontClass = defaultFont ? "lyssna-default-lyrics-font" : undefined;
  const upcoming = fullView && settings.lyrics_up_next && duration > 0 && position >= duration - 30_000 ? host.upcoming() : undefined;
  const upNext = upcoming && <div className="lyrics-up-next">
    <button type="button" className="lyrics-up-next-body first" onClick={host.next}>
      <TrackArtwork key={upcoming.image || `${upcoming.title}:${upcoming.artist}`} src={upcoming.image} alternate={upcoming.alternate} />
      <span className="lyrics-up-next-text"><small>Up next</small>
        <strong className="lyrics-up-next-title">{upcoming.title}</strong>
        <span className="lyrics-up-next-artist">{upcoming.artist}</span></span>
    </button>
  </div>;

  if (gravity && rendered?.synced && rendered.lines.some((line) => line.words.length)) {
    return <div className={fontClass} style={{ display: "contents" }}><span ref={playMarker} hidden /><SpaceGravityLyrics lyrics={rendered} time={time} reduceMotion={settings.reduce_motion}
      tuning={settings.lyrics_animator} visualiser={visualiser} onSeek={(ms) => seek(ms - (playing && settings.lyrics_seek_compensation ? 300 : 0))}
      wordDensity={settings.gravity_word_density}
      showTranslations={settings.lyrics_translations}
      highlighter={settings.lyrics_highlighter ? markerColour(settings.lyrics_highlighter_color) : undefined}
      linkWidth={settings.gravity_links ? settings.gravity_link_width / 100 : 0}
      credits={<div className={upNext ? "lyric-credits-row" : undefined}>
        <div className="gravity-credit-details">
          <WriterCredits names={rendered.songwriters?.length ? rendered.songwriters : fallbackWriters ?? []} />
          <LyricCredits lyrics={rendered} expanded discord={settings.lyrics_discord_usernames} />
        </div>
        {upNext}
      </div>} /></div>;
  }
  if (rendered) return <div className={fontClass} style={{ display: "contents" }}><span ref={playMarker} hidden /><LyricsDisplay lyrics={rendered} positionMs={time} playing={playing} settings={settings}
    onSeek={seek} compact={compact} writers={fallbackWriters} upNext={upNext} /></div>;
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
  const settings = useReviewerSettings(useLiveSettings(), track?.id);
  if (!track || settings.lyrics_hide_npv) return null;
  return <NowPlayingLyrics key={track.id} track={track} playing={playing} settings={settings} host={host} open={open} expand={expand} />;
}

function NowPlayingLyrics({ track, playing, settings, host, open, expand }: {
  track: Track; playing: boolean; settings: Settings; host: Host; open: () => void; expand: (expanded: boolean) => void;
}) {
  const fonts = appFontStyles(settings);
  const duration = host.duration();
  const data = useTrackLyrics(track, duration, window, settings, host);
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
  const settings = useReviewerSettings(useLiveSettings(), track?.id);
  const enabled = !!track?.cover && settings.npv_ambience;
  const canvas = useMemo(() => () => nowPlayingCanvas(panel), [panel]);

  useLayoutEffect(() => {
    if (!enabled) return;
    panel.classList.add("lyssna-npv-ambient-panel");
    return () => panel.classList.remove("lyssna-npv-ambient-panel");
  }, [enabled, panel]);

  return enabled && <Ambience image={track?.cover} animate={playing} reduceMotion={settings.reduce_motion}
    brightness={settings.lyrics_background_brightness} followCanvas={canvas} followMotion={settings.animated_covers && !settings.reduce_motion} />;
}

function SpotifyMotionCover({ host }: { host: Host }) {
  const { track, playing } = usePlayback(host, true);
  const settings = useReviewerSettings(useLiveSettings(), track?.id);
  const cover = useAlbumMotionArtwork(track?.albumUri, track?.albumUpc, settings.animated_covers && !settings.reduce_motion);
  return <MotionArtwork cover={cover} playing={playing} />;
}

function spotifyMotionCover(host: Host) {
  let artwork: { cover: HTMLElement; container: HTMLElement; dispose(): void } | undefined;
  return {
    sync(cover: HTMLElement | null) {
      if (artwork && artwork.cover === cover && artwork.container.parentElement === cover) return;
      artwork?.dispose();
      artwork = undefined;
      if (!cover) return;
      const container = document.createElement("div");
      container.className = "lyssna-spotify-motion-cover";
      container.setAttribute("aria-hidden", "true");
      cover.append(container);
      const root = host.mount(container);
      root.render(<SpotifyMotionCover host={host} />);
      artwork = { cover, container, dispose() { root.unmount(); container.remove(); } };
    },
    dispose() { artwork?.dispose(); artwork = undefined; },
  };
}

type DetachedPreview = { playback?: CreatorPlayback };

function PopoutView({ host, view, close, preview }: { host: Host; view: Window; close: () => void; preview?: DetachedPreview }) {
  const { track, playing: spotifyPlaying, narrating } = usePlayback(host, true);
  const draft = useDraftPreview(preview && track ? spotifySongUri(track.id) : undefined, true);
  const localPlayback = preview?.playback?.trackId === track?.id ? preview?.playback : undefined;
  const playing = localPlayback?.playing ?? spotifyPlaying;
  const preferences = useLiveSettings();
  const settings = useReviewerSettings(preferences, track?.id, draft ? preferences.ttml_reviewer !== "off" : undefined);
  const duration = host.duration();
  const data = useTrackLyrics(track, duration, view, settings, host);
  return <LyricsPopout host={host} view={view} close={close} track={track} playing={playing} settings={settings}
    narrating={narrating} localPlayback={localPlayback} draft={!!draft}>
    {track && <TrackLyrics key={track.id} track={track} host={host} playing={playing} settings={settings} view={view}
      fullView={false} duration={duration} lyrics={draft ?? data.lyrics} waiting={!draft && data.waiting} localPlayback={localPlayback} />}
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

function FullscreenControls({ host, playing, settings, view, trackId, narrating, localPlayback, renderCover, details, coverOnly }: {
  host: Host; playing: boolean; settings: Settings; view: Window; trackId?: string; narrating: boolean; localPlayback?: CreatorPlayback;
  renderCover?: (controls: ReactNode) => ReactElement; details?: ReactNode; coverOnly: boolean;
}) {
  const position = usePosition(host, playing, view, localPlayback?.read);
  const seek = localPlayback?.seek ?? host.seek;
  const { liked, shuffle, repeat, canJumpDJ, activate, cycleRepeat } = usePlaybackControls(host, trackId, true);
  const likeLabel = liked ? "Remove from Liked Songs" : "Save to Liked Songs";
  const duration = host.duration();
  const [seeking, setSeeking] = useState<number>();
  const pendingSeek = useRef<number | undefined>(undefined);
  const seekInput = useRef<HTMLInputElement>(null);
  function finishSeek(commit = true) {
    const target = pendingSeek.current;
    pendingSeek.current = undefined;
    setSeeking(undefined);
    if (commit && target !== undefined) seek(target);
  }
  useLayoutEffect(() => {
    pendingSeek.current = undefined;
    setSeeking(undefined);
  }, [trackId]);
  useLayoutEffect(() => {
    const page = seekInput.current?.closest<HTMLElement>(".lyrics-page");
    if (seeking === undefined || !page) return;
    page.dataset.seeking = "true";
    return () => { delete page.dataset.seeking; };
  }, [seeking !== undefined]);
  const [volume, setVolume] = useState(host.volume);
  const audible = useRef(volume || 0.5);
  const volumeWrite = useRef<{ timer?: number; level?: number; lastWrite: number }>({ lastWrite: -Infinity });
  function flushVolume() {
    const pending = volumeWrite.current;
    view.clearTimeout(pending.timer);
    pending.timer = undefined;
    if (pending.level === undefined) return;
    const level = pending.level;
    pending.level = undefined;
    pending.lastWrite = view.performance.now();
    host.setVolume(level);
  }
  useEffect(() => {
    const unwatch = host.watchControls(() => {
      const pending = volumeWrite.current;
      if (pending.level !== undefined || view.performance.now() - pending.lastWrite < 150) return;
      const level = host.volume();
      if (level > 0) audible.current = level;
      setVolume(level);
    });
    return () => { unwatch(); flushVolume(); };
  }, [host, view]);
  function changeVolume(level: number) {
    if (level > 0) audible.current = level;
    setVolume(level);
    const pending = volumeWrite.current;
    pending.level = level;
    const delay = 100 - (view.performance.now() - pending.lastWrite);
    if (delay <= 0) flushVolume();
    else pending.timer ??= view.setTimeout(flushVolume, delay);
  }
  const volumeSlider = settings.fullscreen_volume !== "off" && (
    <div className={`lyrics-fullscreen-volume ${renderCover ? settings.fullscreen_volume : "below"}`}>
      <div className="lyrics-volume-pill" data-level={volume <= 0 ? "muted" : volume < 0.5 ? "low" : "high"}
        style={{ "--range": `${volume * 100}%` } as CSSProperties}>
        <span className="lyrics-volume-fill" aria-hidden="true" />
        <input aria-label="Volume" type="range" min={0} max={1} step={0.01} {...rangeFocus}
          value={volume} onChange={(event) => changeVolume(event.target.valueAsNumber)}
          onPointerUp={(event) => event.currentTarget.blur()} onPointerCancel={flushVolume} onKeyUp={flushVolume}
          onBlur={(event) => { clearPointerFocus(event); flushVolume(); }} />
        <button className="lyrics-volume-icon" type="button" aria-label={volume ? "Mute" : "Unmute"}
          onClick={() => { changeVolume(volume ? 0 : audible.current); flushVolume(); }}><FullscreenVolumeIcon /></button>
      </div>
    </div>
  );
  const always = settings.fullscreen_always_show;
  const elapsed = Math.min(seeking ?? position, duration);
  const total = clock(duration);
  const timeChars = { "--time-chars": total.length } as CSSProperties;
  const seekPart = <>
    <div className="lyrics-glass-seek" style={{ "--range": `${elapsed / Math.max(1, duration) * 100}%` } as CSSProperties}>
      <span className="lyrics-glass-fill" aria-hidden="true" />
      <input ref={seekInput} aria-label="Seek position" type="range" min={0} max={duration || 1} {...rangeFocus}
        disabled={narrating || !duration} value={elapsed}
        onChange={(event) => {
          pendingSeek.current = event.target.valueAsNumber;
          setSeeking(pendingSeek.current);
        }}
        onPointerDown={(event) => {
          rangeFocus.onPointerDown(event);
          event.currentTarget.setPointerCapture(event.pointerId);
          setSeeking(position);
        }}
        onPointerUp={(event) => { finishSeek(); event.currentTarget.blur(); }}
        onPointerCancel={() => finishSeek(false)}
        onKeyUp={() => finishSeek()}
        onBlur={(event) => { clearPointerFocus(event); finishSeek(); }} />
    </div>
    <div className="lyrics-fullscreen-times"><time>{clock(elapsed)}</time><time>{total}</time></div>
  </>;
  const heart = trackId && <button type="button" className={`icon-button lyrics-fullscreen-like${liked ? " is-saved" : ""}`}
    title={likeLabel} aria-label={likeLabel} aria-pressed={liked}
    onClick={activate(host.toggleLiked)}><FullscreenHeartIcon /></button>;
  const transport = <>
    <button type="button" className={`icon-button lyrics-fullscreen-shuffle${shuffle ? " active" : ""}`}
      title="Shuffle" aria-label="Shuffle" aria-pressed={shuffle} onClick={activate(host.toggleShuffle)}><FullscreenShuffleIcon /></button>
    <button type="button" className="icon-button lyrics-fullscreen-skip" aria-label="Previous" onClick={host.previous}><SkipPreviousIcon /></button>
    <button type="button" className="icon-button lyrics-fullscreen-play" aria-label={playing ? "Pause" : "Play"} onClick={localPlayback?.toggle ?? host.toggle}>
      {playing ? <FullscreenPauseIcon /> : <FullscreenPlayIcon />}
    </button>
    <button type="button" className="icon-button lyrics-fullscreen-skip" aria-label="Next" onClick={host.next}><SkipNextIcon /></button>
    <button type="button" className={`icon-button lyrics-fullscreen-repeat${repeat !== "off" ? " active" : ""}`}
      title={`Repeat (${repeat})`} aria-label={`Repeat (${repeat})`} aria-pressed={repeat !== "off"}
      onClick={activate(cycleRepeat)}><FullscreenRepeatIcon one={repeat === "track"} /></button>
    {canJumpDJ && <button type="button" className="icon-button lyssna-dj" title="Change the DJ mix"
      aria-label="Change the DJ mix" onClick={activate(host.jumpDJ)}><Disc3 /></button>}
  </>;
  const seekOutside = renderCover && (coverOnly || always === "time" || always === "both");
  const transportOutside = renderCover && (coverOnly || always === "controls" || always === "both");
  const controls = <div className="lyrics-fullscreen-controls" style={timeChars}>
    {!seekOutside && seekPart}
    <div className="lyrics-fullscreen-buttons">{heart}{!transportOutside && transport}</div>
    {volumeSlider}
  </div>;
  return renderCover ? <>
    {renderCover(controls)}
    {seekOutside && <div className="lyrics-fullscreen-controls lyrics-outside-controls outside-seek" style={timeChars}>{seekPart}</div>}
    {details}
    {transportOutside && <div className="lyrics-fullscreen-controls lyrics-outside-controls outside-transport">
      <div className="lyrics-fullscreen-buttons">{transport}</div>
    </div>}
  </> : controls;
}

type FullscreenMode = "display" | "cinema";
type ReviewPreview = { uri: string; lyrics: Lyrics };
type SettingsRequest = { page: "settings" | "storage"; trigger?: HTMLElement | null };

function requestDisplayFullscreen(parent: HTMLElement) {
  if (!parent.ownerDocument.fullscreenEnabled || parent.matches(":fullscreen")) return;
  parent.tabIndex = -1;
  // The immersive layout also works when the client rejects the request.
  void parent.requestFullscreen().then(() => parent.focus({ preventScroll: true })).catch(() => {});
}

function LyricsView({ host, options, close, parent, view = window, fullscreenRequest = 0, settingsRequest,
  openCreator, closeCreator, reviewEditor, reviewPreview, onDismissReviewPreview, onSidebarCover, onRecordingPlayback, capture, detachedPreview }: {
  host: Host; options: BuildOptions; close: () => void; parent: HTMLElement; view?: Window;
  capture: SpotifyCapture;
  fullscreenRequest?: number;
  settingsRequest?: SettingsRequest;
  openCreator?(): void;
  closeCreator?(): void;
  reviewEditor?: ReviewEditor;
  reviewPreview?: ReviewPreview;
  onDismissReviewPreview?(): void;
  onSidebarCover?(cover?: string): void;
  onRecordingPlayback?(playback?: CreatorPlayback): void;
  detachedPreview?: DetachedPreview;
}) {
  const externalCinema = view !== window;
  const { track, playing: spotifyPlaying, narrating } = usePlayback(host, true);
  const preferences = useLiveSettings();
  const [settingsPage, setSettingsPage] = useState<"settings" | "storage">();
  const showSettings = !!settingsPage;
  const [showTtml, setShowTtml] = useState(false);
  const showCreator = !!closeCreator;
  const trackId = track?.id;
  const [creatorTrackId, setCreatorTrackId] = useState<string>();
  const [creatorPlayback, setCreatorPlayback] = useState<CreatorPlayback>();
  const [originalDraftUri, setOriginalDraftUri] = useState<string>();
  const draftUri = trackId && !showCreator ? spotifySongUri(trackId) : undefined;
  const savedDraft = useDraftPreview(detachedPreview && originalDraftUri === draftUri ? undefined : draftUri, !!detachedPreview);
  const duration = host.duration();
  const foundLyrics = useTrackLyrics(track, duration, view, preferences, host);
  const pendingDraft = !!savedDraft && !detachedPreview && foundLyrics.waiting && !foundLyrics.lyrics;
  const draftMatchesSource = useMemo(() => {
    if (!savedDraft || detachedPreview || !foundLyrics.lyrics?.lines.length) return false;
    const source = toLyrics(joinHyphenated(fromLyrics(foundLyrics.lyrics)));
    return JSON.stringify(source.lines) === JSON.stringify(savedDraft.lines);
  }, [savedDraft, detachedPreview, foundLyrics.lyrics]);
  useEffect(() => {
    if (draftUri && draftMatchesSource) dismissDraft(draftUri);
  }, [draftUri, draftMatchesSource]);
  const savedPreview = pendingDraft || draftMatchesSource ? undefined : savedDraft;
  const reviewLyrics = reviewPreview && reviewPreview.uri === draftUri ? reviewPreview.lyrics : undefined;
  const draft = reviewLyrics ?? savedPreview;
  const [reviewerOverride, setReviewerOverride] = useState<boolean>();
  const draftReviewer = draft ? reviewerOverride ?? (preferences.ttml_reviewer !== "off") : undefined;
  const settings = useReviewerSettings(preferences, trackId, draftReviewer);
  const keepCreator = (!!draft || pendingDraft) && (preferences.ttml_creator || !!reviewLyrics) && !!trackId && creatorTrackId === trackId;
  const attachedPlayback = (showCreator || keepCreator) && creatorPlayback?.trackId === trackId ? creatorPlayback : undefined;
  const detachedPlayback = detachedPreview?.playback?.trackId === trackId ? detachedPreview?.playback : undefined;
  const localPlayback = attachedPlayback ?? detachedPlayback;
  useEffect(() => {
    if (!onRecordingPlayback || !attachedPlayback) return;
    onRecordingPlayback(attachedPlayback);
    return () => onRecordingPlayback(undefined);
  }, [attachedPlayback, onRecordingPlayback]);
  const playing = localPlayback?.playing ?? spotifyPlaying;
  const visualiser = useRef<VisualiserFrame | null>(null);
  const showVisualiser = settings.lyrics_visualiser && settings.lyrics_visualiser_opacity > 0 && !settings.reduce_motion && !narrating;
  useLayoutEffect(() => setReviewerOverride(undefined), [draftUri, preferences.ttml_reviewer]);
  useLayoutEffect(() => {
    if (showCreator) setCreatorTrackId(trackId);
    else if (!keepCreator) setCreatorTrackId(undefined);
  }, [keepCreator, showCreator, trackId]);
  const [fullscreen, setFullscreen] = useState(fullscreenRequest > 0);
  const immersive = fullscreen || externalCinema;
  const lyrics = draft ?? foundLyrics.lyrics;
  const waiting = !draft && foundLyrics.waiting;
  const missing = !lyrics && !waiting;
  const coverOnly = !!track && (lyrics?.instrumental || (immersive && missing));
  const localIsrc = useLocalTrackIsrc(track, duration, host, showTtml);
  const [leaving, setLeaving] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [notice, setNotice] = useState("");
  const [submission, setSubmission] = useState<{ feedback: SubmissionFeedback; id: number }>();
  const [artistHeader, setArtistHeader] = useState<{ uri: string; url: string }>();
  const [albumYear, setAlbumYear] = useState<{ uri: string; year: string }>();
  const timer = useRef<number>(0);
  const exitingDisplay = useRef(false);
  const toolsTimer = useRef<number>(0);
  const lyricsPage = useRef<HTMLElement>(null);
  const swapStart = useRef<Map<HTMLElement, DOMRect> | null>(null);
  const swapAnimations = useRef<Animation[]>([]);
  useLayoutEffect(() => {
    const before = swapStart.current;
    swapStart.current = null;
    if (!before) return;
    for (const animation of swapAnimations.current) animation.cancel();
    const distances = Array.from(before, ([element, previous]) => {
      const next = element.getBoundingClientRect();
      return { element, x: previous.left - next.left, y: previous.top - next.top };
    });
    swapAnimations.current = distances.filter(({ element, x, y }) => element.isConnected && (x || y))
      .map(({ element, x, y }) => element.animate([
        { translate: `${x}px ${y}px`, composite: "add" },
        { translate: "0px 0px", composite: "add" },
      ], { duration: 320, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }));
  }, [settings.lyrics_artwork_right]);
  useEffect(() => () => swapAnimations.current.forEach((animation) => animation.cancel()), []);
  const quickToolbar = useRef<HTMLDivElement>(null);
  const quickPickerTrigger = useRef<HTMLButtonElement>(null);
  const sourcePickerId = useId();
  const [quickPicker, setQuickPicker] = useState<QuickEffectChoice | { id: "lyrics-source"; trackId: string }>();
  const shownQuickPicker = !showSettings && !showCreator && !showTtml && quickPicker &&
    (quickPicker.id === "lyrics-source" ? quickPicker.trackId === trackId : settings.pinned_lyric_effects.includes(quickPicker.id))
    ? quickPicker : undefined;
  const showSourcePicker = shownQuickPicker?.id === "lyrics-source";
  const creatorPage = useRef<HTMLDivElement>(null);
  const ttmlTrigger = useRef<HTMLButtonElement>(null);
  const settingsTrigger = useRef<HTMLElement | undefined>(undefined);

  function closeSettings() {
    setNotice("");
    setSettingsPage(undefined);
    const trigger = settingsTrigger.current;
    settingsTrigger.current = undefined;
    if (trigger) view.requestAnimationFrame(() => trigger.focus({ preventScroll: true }));
  }
  function closeQuickPicker() {
    const trigger = quickPickerTrigger.current;
    setQuickPicker(undefined);
    view.requestAnimationFrame(() => {
      if (quickPickerTrigger.current === trigger && trigger?.getAttribute("aria-expanded") === "false") {
        trigger.focus({ preventScroll: true });
      }
    });
  }
  useEffect(() => {
    if (!quickPicker) return;
    if (!shownQuickPicker) {
      setQuickPicker(undefined);
      return;
    }
    const dismiss = (event: PointerEvent) => {
      if (quickToolbar.current && !event.composedPath().includes(quickToolbar.current)) setQuickPicker(undefined);
    };
    view.document.addEventListener("pointerdown", dismiss, true);
    return () => view.document.removeEventListener("pointerdown", dismiss, true);
  }, [quickPicker, shownQuickPicker, view]);
  useLayoutEffect(() => { if (lyricsPage.current) lyricsPage.current.inert = showTtml; }, [showTtml, showCreator]);
  useLayoutEffect(() => { if (creatorPage.current) creatorPage.current.inert = showSettings || showTtml; }, [showSettings, showTtml, showCreator, keepCreator]);
  useLayoutEffect(() => {
    if (!settingsRequest) return;
    setNotice("");
    setShowTtml(false);
    settingsTrigger.current = settingsRequest.trigger ?? undefined;
    setSettingsPage(settingsRequest.page);
  }, [settingsRequest]);
  useEffect(() => {
    if (!showCreator) return;
    setSettingsPage(undefined);
    setShowTtml(false);
  }, [showCreator]);
  const fonts = appFontStyles(settings);
  const [failedCover, setFailedCover] = useState<{ trackId: string; url: string }>();
  const trackCover = track?.cover;
  const cover = failedCover?.trackId === trackId && failedCover?.url === trackCover ? undefined : trackCover;
  const placeholder = useMemo(() => trackId && !cover ? placeholderArtwork(view.document) : undefined, [trackId, cover, view]);
  const artwork = narrating ? DJ_COVER : cover || placeholder;
  const { confirmFirstUpload, firstUploadNotice } = useFirstUploadNotice(fonts, settings.liquid_glass);
  const coverColour = useArtworkColor(artwork);
  const hideArtwork = settings.lyrics_hide_artwork && !coverOnly;
  const canvasEnabled = settings.canvas_lyrics && !hideArtwork && !coverOnly;
  const canvasInfo = useCanvas(host, track?.id, canvasEnabled);
  const [unavailableCanvas, setUnavailableCanvas] = useState<CanvasInfo>();
  const canvas = canvasInfo === unavailableCanvas ? undefined : canvasInfo;
  const [canvasVideo, setCanvasVideo] = useState<HTMLVideoElement | null>(null);
  const [canvasFrame, setCanvasFrame] = useState<{ video: HTMLVideoElement; seconds: number }>();
  const heldFrame = canvasFrame && canvasFrame.video === canvasVideo ? canvasFrame.seconds : undefined;
  useEffect(() => { setCanvasFrame((frame) => frame?.video === canvasVideo ? frame : undefined); }, [canvasVideo]);
  useEffect(() => setUnavailableCanvas(undefined), [track?.id, canvasEnabled]);
  useLayoutEffect(() => { onSidebarCover?.(canvas ? track?.cover : undefined); }, [canvas, track?.cover, onSidebarCover]);
  const background = settings.lyrics_background;
  const artistUri = track?.artistUri;
  const albumUri = track?.albumUri;
  const motion = useAlbumMotionArtwork(albumUri, track?.albumUpc,
    !showCreator && settings.animated_covers && !settings.reduce_motion && !hideArtwork && !canvas, view);
  const year = track?.year ?? (albumYear?.uri === albumUri ? albumYear?.year : undefined);
  useEffect(() => {
    if (settings.lyrics_year_position === "off" || track?.year || !albumUri || !/^spotify:album:[A-Za-z0-9]{22}$/.test(albumUri)) return;
    let live = true;
    void host.releaseYear(albumUri)?.then((year) => {
      if (live && year) setAlbumYear({ uri: albumUri, year });
    });
    return () => { live = false; };
  }, [host, albumUri, track?.year, settings.lyrics_year_position]);
  function openTtml(trigger: HTMLButtonElement) {
    ttmlTrigger.current = trigger;
    setNotice("");
    setShowTtml(true);
  }

  function closeTtml() {
    setShowTtml(false);
    view.requestAnimationFrame(() => ttmlTrigger.current?.focus({ preventScroll: true }));
  }

  function searchAgain(action: Settings["lyrics_cache_action"]) {
    refreshLyrics(track ?? undefined, action);
  }

  function showOriginalLyrics() {
    if (reviewLyrics) {
      if (draftUri && savedPreview) dismissDraft(draftUri);
      onDismissReviewPreview?.();
    } else if (detachedPreview) setOriginalDraftUri(draftUri);
    else if (draftUri) dismissDraft(draftUri);
  }

  function sleepTools() {
    window.clearTimeout(toolsTimer.current);
    if (lyricsPage.current) delete lyricsPage.current.dataset.tools;
  }

  function wakeTools() {
    if (!lyricsPage.current) return;
    lyricsPage.current.dataset.tools = "awake";
    window.clearTimeout(toolsTimer.current);
    toolsTimer.current = window.setTimeout(() => {
      if (lyricsPage.current?.querySelector(
        ".lyrics-fullscreen-controls :is(button, .lyrics-glass-seek, .lyrics-volume-pill):hover, .lyrics-toolbar:is(:hover, [data-effect-picker])",
      )) return;
      sleepTools();
    }, 750);
  }

  useEffect(() => {
    if (!showCreator) wakeTools();
    return () => window.clearTimeout(toolsTimer.current);
  }, [showCreator, immersive]);
  useEffect(() => {
    if (!notice || showSettings) return;
    const id = window.setTimeout(() => setNotice(""), 3_000);
    return () => window.clearTimeout(id);
  }, [notice, showSettings]);
  useEffect(() => {
    if (!submission) return;
    const timer = view.setTimeout(() => setSubmission(undefined), 4_000);
    return () => view.clearTimeout(timer);
  }, [submission, view]);

  function showSubmission(feedback: SubmissionFeedback, closeEditor = false) {
    if (closeEditor && !feedback.error) closeCreator?.();
    setSubmission({ feedback, id: performance.now() });
  }
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
  useLayoutEffect(() => {
    parent.classList.toggle("immersive", immersive);
    parent.classList.toggle("lyssna-slide-away", leaving);
  }, [parent, immersive, leaving]);
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
      if (showCreator && !showSettings) return;
      if (event.key !== "Escape" && event.key !== "F11") return;
      if (parent.querySelector(".lyssna-song-sheet[open]")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (shownQuickPicker && event.key === "Escape") closeQuickPicker();
      else if (showTtml) closeTtml();
      else if (showSettings) closeSettings();
      else if (event.key === "F11") toggleFullscreen(event.shiftKey);
      else closeLyrics();
    };
    view.document.addEventListener("keydown", keyboard);
    return () => view.document.removeEventListener("keydown", keyboard);
  });

  const hasAmbience = artwork && (background === "animated" || background === "static");
  const banner = background === "artist" && artistHeader?.uri === artistUri ? artistHeader?.url : undefined;
  const backgroundImage = background === "cover" || background === "artist" ? banner || artwork : undefined;
  const compact = !coverOnly && (narrow || settings.lyrics_compact);
  const className = `lyrics-page ${narrating ? "dj-narration" : ""} ${canvas ? "canvas-lyrics" : ""} ${compact ? "narrow" : ""}
    ${hideArtwork ? "no-artwork" : ""} ${settings.lyrics_artwork_right && !coverOnly ? "artwork-right" : ""} ${coverOnly ? "no-lyrics" : ""}
    ${background === "color" ? "colour-background" : ""} ${settings.lyrics_toolbar_bottom ? "toolbar-bottom" : ""}
    ${settings.reduce_motion ? "reduce-motion" : ""} ${settings.glass_seek ? "" : "flat-seek"}`;
  const pageStyle = { ...fonts, "--lyric-size": `${Math.round(settings.lyric_size * 1.6)}px`,
    "--lyrics-cover-color": coverColour, "--hero": coverColour } as CSSProperties;
  const artworkDock = immersive && !!track?.cover && !canvas && !compact && !hideArtwork && !narrating;
  const toolbarOnCover = coverOnly && artworkDock;
  const details = track && <TrackMetadata host={host} track={track} year={year} yearPosition={settings.lyrics_year_position}
    reduceMotion={settings.reduce_motion} orderByWidth={!!canvas} />;
  const toolbar = <div className={`lyrics-toolbar${settings.liquid_glass ? " liquid-glass" : ""}`} ref={quickToolbar} data-effect-picker={shownQuickPicker?.id}
    data-vertical={compact && !narrow || undefined} role="toolbar" aria-label="View controls">
    <div className="lyrics-toolbar-actions">
      {([
        ["romanized", "Romanization", TranslateIcon],
        ["experimental_word_sync", "Experimental word sync", WordSyncIcon],
        ["lyrics_compact", "Compact lyrics", CompactIcon],
        ["lyrics_hide_artwork", "Hide artwork", HideArtworkIcon],
        ["lyrics_artwork_right", "Artwork on the right", SwapSidesIcon],
      ] as const).map(([key, label, Icon]) => <button type="button" key={key} data-icon={key} title={label}
        className={`icon-button${settings[key] ? " active" : ""}`} aria-label={label} aria-pressed={settings[key]}
        onClick={() => {
          if (key === "lyrics_artwork_right") prepareArtworkSwap();
          change({ [key]: !settings[key] });
        }}><Icon /></button>)}
      {quickEffects.filter(({ id }) => settings.pinned_lyric_effects.includes(id)).map((effect) => {
        const { id, label, Icon } = effect;
        if (effect.kind === "picker") return <Fragment key={id}>
          <button className="icon-button" type="button" data-icon={id}
            title={label} aria-label={label} aria-expanded={shownQuickPicker?.id === id}
            onClick={(event) => {
              quickPickerTrigger.current = event.currentTarget;
              if (shownQuickPicker === effect) closeQuickPicker();
              else setQuickPicker(effect);
            }}><Icon /></button>
          {shownQuickPicker === effect && <div className="lyssna-quick-expansion">
            <QuickEffectPicker effect={effect} settings={preferences} change={change} close={closeQuickPicker}
              view={view} vertical={compact && !narrow} />
          </div>}
        </Fragment>;
        const active = settings[effect.id];
        return <button type="button" key={id} data-icon={id} title={label} aria-label={label} aria-pressed={active}
          className={`icon-button${active ? " active" : ""}`}
          onClick={() => change({ [id]: !active })}><Icon /></button>;
      })}
      <span className="toolbar-divider" aria-hidden="true" />
      <button type="button" className="icon-button" data-icon="lyrics-source" title="Lyrics source for this song"
        aria-label="Lyrics source for this song" aria-expanded={showSourcePicker} aria-controls={showSourcePicker ? sourcePickerId : undefined}
        disabled={!track} onClick={(event) => {
          if (!track) return;
          quickPickerTrigger.current = event.currentTarget;
          if (showSourcePicker) closeQuickPicker();
          else setQuickPicker({ id: "lyrics-source", trackId: track.id });
        }}><ListMusic size={18} aria-hidden="true" /></button>
      {showSourcePicker && track && <SongSourcePicker id={sourcePickerId} track={track} trigger={quickPickerTrigger} view={view}
        close={closeQuickPicker} onApplied={draft ? showOriginalLyrics : undefined}
        onError={() => host.notifyError("Couldn’t save this song’s lyrics source.")} />}
      <button type="button" className="icon-button" data-icon="upload" title="Load TTML" aria-label="Load TTML"
        aria-haspopup="dialog" onClick={(event) => openTtml(event.currentTarget)}><UploadIcon /></button>
      {settings.lyrics_cache_button && <button type="button" className="icon-button" data-icon="retry" title="Refresh lyrics" aria-label="Refresh lyrics"
        aria-busy={foundLyrics.waiting} disabled={!track || foundLyrics.waiting}
        onClick={() => searchAgain(settings.lyrics_cache_action)}><RetryIcon /></button>}
      <button type="button" className="icon-button" data-icon="fullscreen" title={fullscreen ? "Exit full screen" : externalCinema ? "Full screen" : "Full screen (Shift for cinema)"}
        aria-label={fullscreen ? "Exit full screen" : "Full screen"}
        aria-pressed={fullscreen} onClick={(event) => toggleFullscreen(event.shiftKey)}><FullScreenIcon /></button>
      <button type="button" className="icon-button" data-icon="settings" title="Lyssna settings" aria-label="Lyssna settings"
        onClick={() => { setNotice(""); setSettingsPage("settings"); }}><GearIcon size={18} /></button>
      <button type="button" className="icon-button" title={returnToLyrics ? "Leave full screen" : "Close lyrics"}
        aria-label={returnToLyrics ? "Leave full screen" : "Close lyrics"} onClick={closeLyrics}><X size={18} /></button>
    </div>
  </div>;
  const renderCover = (controls?: ReactNode) => <div className="lyrics-media lyrics-motion-stage">
    <TrackArtwork className={`cover${settings.cover_animation && !settings.reduce_motion ? " crossfade" : ""}`}
      key={trackCover || trackId} src={cover} placeholder={placeholder}
      onUnavailable={() => { if (trackId && trackCover) setFailedCover({ trackId, url: trackCover }); }} />
    <MotionArtwork cover={motion} playing={playing} />
    {controls}
    {toolbarOnCover && toolbar}
  </div>;
  const playback = immersive && (track || narrating) && <FullscreenControls host={host} playing={playing} settings={settings}
    view={view} trackId={trackId} narrating={narrating} localPlayback={localPlayback} coverOnly={coverOnly}
    renderCover={artworkDock ? renderCover : undefined} details={artworkDock ? details : undefined} />;
  function prepareArtworkSwap() {
    const page = lyricsPage.current;
    if (!page || compact || hideArtwork || coverOnly || settings.reduce_motion || view.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const artwork = canvas ? ".lyrics-canvas-cover, .lyrics-details" : ".lyrics-album";
    const lyricsColumn = page.querySelector(".gravity-stage") ? ".gravity-credits" : ".lyrics-body";
    const elements = page.querySelectorAll<HTMLElement>(`${artwork}, ${lyricsColumn}, :scope > .lyrics-fullscreen-controls`);
    swapStart.current = new Map(Array.from(elements, (element) => [element, element.getBoundingClientRect()]));
  }
  return <>
    {!showCreator && hasAmbience && <Ambience image={artwork} animate={playing && background === "animated"}
      reduceMotion={settings.reduce_motion} brightness={settings.lyrics_background_brightness} followCanvas={canvas ? "window" : false}
      followMotion={background === "animated" && motion.state === "ready"} />}
    {!showCreator && backgroundImage && <img className="lyrics-background" src={backgroundImage}
      style={{ "--artwork-blur": `${settings.lyrics_background_blur}px` } as CSSProperties}
      onError={banner ? () => setArtistHeader((current) => current?.url === banner && current.uri === artistUri ? undefined : current) : undefined} alt="" />}
    {reviewEditor && (showCreator || keepCreator) && <div className="lyssna-creator-container" ref={creatorPage} style={pageStyle} data-draft-preview={keepCreator || undefined}>
      <CreatorSurface host={host} view={view} settings={preferences} close={closeCreator ?? close}
        reviewEditor={reviewEditor} previewing={keepCreator} capture={capture} confirmFirstUpload={confirmFirstUpload}
        onSubmitted={showSubmission}
        onLocalPlayback={setCreatorPlayback} manageStoredData={(trigger) => {
        settingsTrigger.current = trigger ?? undefined;
        setNotice("");
        setSettingsPage("storage");
      }} />
    </div>}
    {!showCreator && <section ref={lyricsPage} className={className} aria-label="Lyssna Lyrics" style={pageStyle}
      data-always-show={immersive && settings.fullscreen_always_show !== "none" ? settings.fullscreen_always_show : undefined}
      onPointerMove={wakeTools} onPointerLeave={sleepTools} onKeyDownCapture={wakeTools}>
      {narrating && <DJInterlude playing={playing} reduceMotion={settings.reduce_motion} />}
      {!narrating && (track ? <>
        <div className="lyrics-album">
          {artworkDock ? playback : <>{canvas ? <CanvasArtwork key={`${track.id}:${canvas.fileId ?? canvas.url}`} info={canvas} cover={artwork ?? ""}
            playing={playing && !settings.reduce_motion} onUnavailable={setUnavailableCanvas} onVideo={setCanvasVideo} heldFrame={heldFrame} />
            : renderCover()}
          {details}</>}
        </div>
        {!coverOnly && <div className="lyrics-body">
          {missing ? settings.lyrics_no_lyrics_notice && <MissingLyrics key={track.id} track={track} host={host}
            searchAgain={() => searchAgain("song")} openTtml={openTtml}
            openCreator={openCreator && (() => {
              if (!preferences.ttml_creator) change({ ttml_creator: true });
              openCreator();
            })} />
            : <TrackLyrics key={track.id} track={track} host={host} playing={playing} settings={settings} view={view}
              duration={duration} lyrics={lyrics} waiting={waiting} localPlayback={localPlayback}
              visualiser={showVisualiser ? visualiser : undefined} />}
        </div>}
        {draft && <div className="ttml-draft-banner">
          <span role="status">{reviewLyrics ? "Showing the review preview" : "Showing your TTML draft"}</span>
          {(reviewLyrics ? keepCreator && !!reviewEditor?.draft() : preferences.ttml_creator) && openCreator && <button type="button" onClick={() => {
            if (fullscreen && !externalCinema) toggleFullscreen();
            openCreator();
          }}>Back to Creator</button>}
          <button type="button" onClick={showOriginalLyrics}>Original lyrics</button>
          <button type="button" aria-pressed={draftReviewer} onClick={() => setReviewerOverride(!draftReviewer)}>Reviewer mode</button>
        </div>}
      </> : <div className="lyrics-message"><Music2 /><h2>Play something you love</h2><p>Your lyrics will appear here.</p></div>)}
      {track && showVisualiser && <SpotifyVisualiser key={track.id} host={host} trackId={track.id}
        opacity={settings.lyrics_visualiser_opacity} playing={playing} capture={capture} motion={visualiser} read={localPlayback?.read} />}
      {!toolbarOnCover && toolbar}
      {!showSettings && notice && <div className="lyssna-popout-error" role="status">{notice}</div>}
      {!artworkDock && playback}
      {!narrating && track && lyrics?.instrumental && <p className="lyrics-instrumental-note">
        🎵 This track is instrumental, enjoy the vibes!
      </p>}
    </section>}
    {!showCreator && showTtml && <LoadTtml song={track ? track.title || "Unknown song" : undefined} track={track ?? undefined}
      localRecording={track?.local ? { track, duration, host, isrc: localIsrc } : undefined}
      glass={settings.liquid_glass} style={fonts}
      reviewer={preferences.ttml_reviewer} onReviewer={(ttml_reviewer) => change({ ttml_reviewer })}
      onSubmit={async (file) => {
        if (!track) throw new Error("Play the song you want to submit lyrics for.");
        const target = track.local ? { ...track, isrc: localIsrc } : track;
        const result = await submitLyssnaTtml(file, target, host, confirmFirstUpload);
        if (!result) return;
        if (result.approved) refreshPublishedLyrics(target, result.isrc, result.published);
        dismissDraft(spotifySongUri(track.id), true);
        closeTtml();
        showSubmission(result);
      }}
      onLoad={async (file, mode) => {
        if (!track) throw new Error("Play a song first.");
        await importLyricFile(file, track, mode, () => host.track()?.id);
        closeTtml();
        setNotice("Imported lyrics.");
      }}
      onReset={async () => {
        if (!track) return;
        await removeLocalLyrics(spotifySongUri(track.id), true);
        closeTtml();
        setNotice("Imported lyrics cleared for this song.");
      }}
      onGuide={() => view.open("https://lyssna.org/guides", "_blank", "noopener,noreferrer")}
      listSaved={listLocalLyrics} deleteSaved={removeLocalLyrics} onPlay={host.playTrack} onDownload={downloadTtml}
      onBulk={(files, signal) => loadBulkLyrics(files, host, signal)} searchSongs={host.searchTracks}
      attachSong={attachBulkLyrics} onClose={closeTtml} />}
    {settingsPage && <SettingsPanel key={settingsPage} host={host} settings={preferences} change={change} close={closeSettings}
      initialSubmenu={settingsPage === "storage" ? "storage" : undefined}
      canvasFrame={{ video: canvasVideo, heldFrame,
        hold: (seconds) => { if (canvasVideo) setCanvasFrame({ video: canvasVideo, seconds }); },
        release: () => setCanvasFrame(undefined) }}
      onEnableAutoRecord={externalCinema ? undefined : () => void capture.start("auto")}
      options={options} track={track ?? undefined} notice={notice} setNotice={setNotice} view={view} developerMode={host.developerMode} />}
    {firstUploadNotice}
    {submission && <SubmissionNotice key={submission.id} feedback={submission.feedback} style={fonts}
      reduceMotion={preferences.reduce_motion}
      container={parent.matches(":fullscreen") ? parent : view.document.body} />}
  </>;
}

function ProfileSettings({ host, options, close, capture, request }: {
  host: Host; options: BuildOptions; close(): void; capture: SpotifyCapture; request: SettingsRequest;
}) {
  const settings = useLiveSettings();
  const { track } = usePlayback(host);
  const [notice, setNotice] = useState("");
  return <SettingsPanel host={host} settings={settings} change={(patch) => saveSettings({ ...readSettings(), ...patch })}
    onEnableAutoRecord={() => void capture.start("auto")}
    initialSubmenu={request.page === "storage" ? "storage" : undefined}
    close={close} options={options} track={track ?? undefined} notice={notice} setNotice={setNotice} developerMode={host.developerMode} />;
}

export default function start(options: BuildOptions) {
  const host = getHost();
  const capture = createSpotifyCapture(host);
  const stopPreferenceSync = startPreferenceSync();
  const stylesheet = document.createElement("style");
  stylesheet.textContent = `${fontCss}\n${desktopCss}\n${settingsCss}\n${ttmlCss}\n${meterCss}\n${viewCss}\n${scrollbars}`;
  document.head.append(stylesheet);
  let button: ReturnType<Host["button"]> | undefined;
  let playbarButtons: ReturnType<typeof playbarViewButtons> | undefined;
  let reviewButton: ReturnType<typeof reviewTopbar> | undefined;
  let showPlaybarPopout = false;
  let showPlaybarCinema = false;
  let showSpotifyMotion = false;
  let syncSpotifyMotion: ((panel?: HTMLElement | null) => void) | undefined;
  let creatorEnabled = false;
  let creatorOpen = false;
  let mainContainer: HTMLElement | undefined;
  const reviewEditor = createReviewEditor();
  let reviewPreview: ReviewPreview | undefined;
  let reviewSidebar: {
    container: HTMLElement;
    root: Root;
    native: ReturnType<typeof watchNativeSidebar>;
    resize: ReturnType<typeof resizeReviewSidebar>;
  } | undefined;
  let disposed = false;
  let autoRecord = false;
  let recorder: { root: Root; container: HTMLElement } | undefined;
  let creatorWindowPlayback: CreatorPlayback | undefined;
  let recorderPlayback: CreatorPlayback | undefined;
  let renderMainView: (() => void) | undefined;
  function syncRecorder() {
    if (disposed || (!creatorEnabled && !(reviewSidebar && creatorOpen))) {
      if (capture.state().status !== "idle") void capture.stop();
      recorder?.root.unmount();
      recorder?.container.remove();
      recorder = undefined;
      return;
    }
    if (!recorder) {
      const container = document.createElement("div");
      container.className = "lyssna-auto-record-host";
      document.body.append(container);
      recorder = { root: host.mount(container), container };
    }
    recorder.root.render(<PlaybarRecorder host={host} capture={capture} autoRecord={autoRecord} editorOpen={creatorOpen}
      playback={recorderPlayback} manageStoredData={openStoredData} />);
  }
  function setRecordingPlayback(playback?: CreatorPlayback) {
    creatorWindowPlayback = playback;
    const recordedPlayback = playback?.returnToSpotify ? playback : undefined;
    if (!disposed && recorderPlayback !== recordedPlayback) {
      recorderPlayback = recordedPlayback;
      syncRecorder();
    }
    detached?.renderPreview();
  }
  function syncPlaybar() {
    if (!playbarButtons) return;
    const controls = findPlaybarControls();
    button?.sync?.(controls);
    playbarButtons.sync(controls, showPlaybarPopout, showPlaybarCinema && host.developerMode !== false, creatorEnabled || creatorOpen, creatorOpen);
  }
  function setCreator(open: boolean, previewDraft = true) {
    if (creatorOpen === open) return;
    if (!open) {
      reviewEditor.cancel();
      const track = host.track();
      if (previewDraft && track) publishDraftPreview(spotifySongUri(track.id));
    }
    creatorOpen = open;
    mainContainer?.toggleAttribute("data-lyssna-creator-open", open);
    renderMainView?.();
    syncPlaybar();
    syncRecorder();
    detached?.renderPreview();
  }
  type DetachedMode = "popout" | "cinema";
  let detached: { mode: DetachedMode; view: Window; dismiss(): void; renderPreview(): void } | undefined;
  function applyRuntimeSettings() {
    const settings = readSettings();
    document.documentElement.toggleAttribute(popupGlassAttribute, !!settings.liquid_glass);
    detached?.view.document.documentElement.toggleAttribute(popupGlassAttribute, !!settings.liquid_glass);
    const nextAutoRecord = settings.ttml_creator && settings.auto_record;
    if (autoRecord && !nextAutoRecord) capture.stopAuto();
    autoRecord = nextAutoRecord;
    showPlaybarPopout = settings.cinema_lyrics;
    showPlaybarCinema = settings.cinema_window;
    creatorEnabled = settings.ttml_creator;
    const motion = settings.animated_covers && !settings.reduce_motion;
    if (motion !== showSpotifyMotion) {
      showSpotifyMotion = motion;
      syncSpotifyMotion?.();
    }
    if (!creatorEnabled && !reviewSidebar) setCreator(false);
    syncPlaybar();
    syncRecorder();
    setFrameCap(settings.animation_fps_cap_enabled ? settings.animation_fps_cap : 0);
  }
  applyRuntimeSettings();
  window.addEventListener(settingsEvent, applyRuntimeSettings);
  function disposeRuntimeSettings() {
    window.removeEventListener(settingsEvent, applyRuntimeSettings);
    document.documentElement.removeAttribute(popupGlassAttribute);
    recorder?.root.unmount();
    recorder?.container.remove();
    recorder = undefined;
    void capture.stop();
  }
  let close: ((forget?: boolean) => void) | undefined;
  let enterFullscreen: ((mode: FullscreenMode) => void) | undefined;
  let showMainSettings: ((request: SettingsRequest) => void) | undefined;
  let closeProfileSettings: (() => void) | undefined;
  let removeCard: (() => void) | undefined;
  let card: HTMLElement | undefined;
  let cardPanel: HTMLElement | undefined;
  let mutedPreviewPanel: HTMLElement | undefined;
  let backdrop: { panel: HTMLElement; container: HTMLElement; dispose(): void } | undefined;
  let sidebarCover: string | undefined;
  let opening = false;
  let switchingLyricsView = false;
  let rememberedView = readViewSession();
  let pendingView = rememberedView;
  let restoringRoute = false;
  let unloading = false;
  const sidebarArtwork = nowPlayingArtwork(host.playing);

  function openProfileSettings() {
    openSettings({ page: "settings" });
  }
  function openStoredData(trigger: HTMLElement | null) {
    openSettings({ page: "storage", trigger });
  }
  function openSettings(request: SettingsRequest) {
    if (disposed || closeProfileSettings) return;
    if (showMainSettings) {
      showMainSettings(request);
      return;
    }
    const parent = document.createElement("div");
    parent.className = "lyssna-lyrics-view lyssna-profile-settings";
    document.body.append(parent);
    const root = host.mount(parent);
    const dismiss = () => {
      closeProfileSettings = undefined;
      root.unmount();
      parent.remove();
      request.trigger?.focus({ preventScroll: true });
    };
    closeProfileSettings = dismiss;
    root.render(<ProfileSettings host={host} options={options} close={dismiss} capture={capture} request={request} />);
  }

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
    let previewingCreator = creatorOpen;
    opening = true;
    try {
      const view = cinema ? window.open("", "_blank", "popup=yes,width=1280,height=720")
        : await pictureInPicture?.requestWindow({ width: 900, height: 640, disallowReturnToOpener: true });
      if (!view) throw new Error("Spotify did not create the requested lyrics window.");
      if (disposed) { view.close(); return; }
      detached?.dismiss();
      try {
        view.document.head.append(stylesheet.cloneNode(true));
        view.document.documentElement.toggleAttribute(popupGlassAttribute, !!readSettings().liquid_glass);
        copySpotifyFonts(view.document);
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
        const returnToCreator = async () => {
          if (!creatorOpen) await open("creator");
          if (creatorOpen) {
            dismiss();
            window.focus();
          }
        };
        const renderDetached = () => {
          previewingCreator ||= creatorOpen;
          const preview = previewingCreator ? { playback: creatorWindowPlayback } : undefined;
          root.render(<SongSheetScope>{cinema
            ? <LyricsView host={host} options={options} close={dismiss} parent={parent} view={view} capture={capture}
              detachedPreview={preview} openCreator={() => void returnToCreator()} />
            : <PopoutView host={host} view={view} close={dismiss} preview={preview} />}</SongSheetScope>);
        };
        detached = { mode, view, dismiss, renderPreview: renderDetached };
        playbarButtons?.setPopoutActive(!cinema);
        playbarButtons?.setCinemaActive(cinema);
        if (cinema && !previewingCreator) close?.();
        syncNowPlaying();
        renderDetached();
      } catch (error) {
        if (detached?.view === view) detached.dismiss();
        else view.close();
        throw error;
      }
    } finally {
      opening = false;
    }
  }

  function openCinemaWindow() {
    void openDetached("cinema").catch((error) => {
      console.warn("[Lyssna Lyrics] Could not open Cinema Lyrics", error);
      host.notifyError("Spotify couldn’t open the Cinema Lyrics window. Check that Spotify DevTools is enabled.");
    });
  }

  function placeReviewSidebar() {
    if (!reviewSidebar) return;
    const layout = host.mainView()?.parentElement;
    const docked = layout?.classList.contains("Root__top-container");
    const target = docked && layout ? layout : document.body;
    const { container, native, resize } = reviewSidebar;
    container.classList.toggle("floating", !docked);
    resize.place(!docked);
    if (container.parentElement !== target) target.append(container);
    native.sync(layout?.querySelector<HTMLElement>(":scope > .Root__right-sidebar") ??
      document.querySelector<HTMLElement>(".Root__right-sidebar"));
  }

  function closeReview(restoreFocus = true) {
    if (!reviewSidebar) return;
    reviewSidebar.native.dispose();
    reviewSidebar.resize.dispose();
    reviewEditor.cancel();
    reviewSidebar.root.unmount();
    reviewSidebar.container.remove();
    reviewSidebar = undefined;
    dismissReviewPreview();
    try { localStorage.removeItem(reviewSidebarKey); } catch { /* Storage may be unavailable. */ }
    if (!creatorEnabled) setCreator(false);
    reviewButton?.sync(false);
    if (restoreFocus) reviewButton?.focus();
  }

  function openReviewSidebar() {
    if (disposed || reviewSidebar) return;
    closeNowPlayingView();
    const container = document.createElement("div");
    container.className = "lyssna-review-sidebar";
    container.setAttribute("data-scroll-size-contained", "");
    const shadow = container.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `${reviewCss}\n${scrollbars}`;
    const panel = document.createElement("div");
    panel.className = "review-sidebar-content";
    panel.id = "lyssna-review-content";
    const resize = resizeReviewSidebar(container, panel.id);
    shadow.append(style, resize.handle, panel);
    reviewSidebar = { container, resize, root: host.mount(panel), native: watchNativeSidebar(() => closeReview(false)) };
    placeReviewSidebar();
    try { localStorage.setItem(reviewSidebarKey, "1"); } catch { /* Storage may be unavailable. */ }
    reviewButton?.sync(true);
    reviewSidebar.root.render(<ReviewPanel host={host} editor={reviewEditor} onClose={() => closeReview()}
      onRefresh={() => reviewButton?.refresh()} onOpen={openReviewDraft} onDismissPreview={dismissReviewPreview} onPlay={(uri, lyrics) => {
        const track = host.track();
        if (track && spotifySongUri(track.id) === uri) {
          const playback = creatorWindowPlayback?.trackId === track.id ? creatorWindowPlayback : undefined;
          if (playback ? !playback.playing : !host.playing()) (playback?.toggle ?? host.toggle)();
        } else void host.playTrack(uri).catch(error => host.notifyError(String(error)));
        if (lyrics) {
          reviewPreview = { uri, lyrics };
          void open("review-preview");
        }
      }} />);
  }

  function dismissReviewPreview() {
    if (!reviewPreview) return;
    reviewPreview = undefined;
    renderMainView?.();
  }

  function openReviewDraft(request: ReviewOpen) {
    dismissReviewPreview();
    reviewEditor.open(request);
    void open("review-edit").then(() => {
      if (creatorOpen || reviewEditor.request() !== request) return;
      reviewEditor.cancel(request);
      host.notifyError("Couldn’t open TTML Creator. Try opening the submission again.");
    });
  }

  async function open(mode?: FullscreenMode | "creator" | "review-edit" | "review-preview") {
    if (mode === "cinema" && creatorOpen) {
      openCinemaWindow();
      return;
    }
    if (mode === "creator" && !creatorEnabled && !creatorOpen) return;
    if (mode === "review-edit" && !reviewSidebar) return;
    if (mode === "review-preview" && !reviewPreview) return;
    pendingView = undefined;
    if (close) {
      if (mode === "review-edit") setCreator(true);
      else if (mode === "review-preview") {
        if (creatorOpen) setCreator(false, false);
        else renderMainView?.();
      }
      else if (mode === "creator") setCreator(!creatorOpen);
      else if (mode) {
        setCreator(false);
        enterFullscreen?.(mode);
      }
      else if (creatorOpen) setCreator(false);
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
    if (disposed || (mode === "review-edit" && !reviewEditor.request()) ||
      (mode === "review-preview" && !reviewPreview)) return;
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
      showMainSettings = undefined;
      renderMainView = undefined;
      reviewPreview = undefined;
      setCreator(false);
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
    let settingsRequest: SettingsRequest | undefined;
    const closeView = () => dismiss();
    const closeCreator = () => {
      setCreator(false);
      window.requestAnimationFrame(() => reviewSidebar ? reviewButton?.focus() : playbarButtons?.focusCreator());
    };
    renderMainView = () => root.render(<SongSheetScope><LyricsView host={host} options={options} close={closeView} parent={parent} capture={capture}
      fullscreenRequest={fullscreenRequest} settingsRequest={settingsRequest} openCreator={() => setCreator(true)}
      closeCreator={creatorOpen ? closeCreator : undefined} reviewEditor={reviewEditor}
      reviewPreview={reviewPreview} onDismissReviewPreview={dismissReviewPreview}
      onSidebarCover={setSidebarCover} onRecordingPlayback={setRecordingPlayback} /></SongSheetScope>);
    showMainSettings = (request) => {
      settingsRequest = request;
      renderMainView?.();
    };
    enterFullscreen = (next) => {
      fullscreenRequest++;
      renderMainView?.();
      if (next === "display") requestDisplayFullscreen(parent);
    };
    if (mode === "review-edit") setCreator(true);
    else if (mode === "creator" && creatorEnabled) setCreator(true);
    else if (mode === "display" || mode === "cinema") enterFullscreen(mode);
    else renderMainView();
  }

  let stopViewSwitch: () => void;
  try {
    button = host.button(`Lyssna Lyrics (${options.hiddenVersion ? "Hidden build" : channelLabels[options.channel]})`, () => void open());
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
    disposeRuntimeSettings();
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
    openCinemaWindow,
    () => void open("creator"),
  );
  const stopProfileSettings = host.profileMenuItem("Lyssna Lyrics settings", openProfileSettings);
  const uploadAs = uploadAsTopbar(host);
  reviewButton = reviewTopbar(host, () => {
    if (reviewSidebar) closeReview();
    else {
      openReviewSidebar();
      reviewButton?.refresh();
    }
  }, closeReview, () => {
    try { if (localStorage.getItem(reviewSidebarKey) === "1") openReviewSidebar(); }
    catch { /* Storage may be unavailable. */ }
  });
  const stopReleaseNotices = startReleaseNotices(host, options);
  const stopEnhancementStartup = startEnhancements(host);
  const stopLocalPlaylistPlayback = startLocalPlaylistPlayback(host);
  const stopVolumeDrag = startVolumeDragController(host);
  keepTemporaryLyricsFor(host.track()?.id);
  const stopTemporaryTrack = host.watch(() => keepTemporaryLyricsFor(host.track()?.id));
  const stopLyssnaListens = trackLyssnaListens(host);
  const reportApiNotice = (event: Event) => host.notifyError((event as CustomEvent<string>).detail);
  window.addEventListener(lyssnaApiNotice, reportApiNotice);
  const beginUnload = () => { unloading = true; void capture.stop(); };
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

  const playbarArtwork = spotifyMotionCover(host);
  const nowPlayingMotion = spotifyMotionCover(host);
  const artistCard = nowPlayingArtistCard(host);
  syncSpotifyMotion = (panel = findNowPlaying()) => {
    playbarArtwork.sync(showSpotifyMotion ? findPlaybarCover() : null);
    nowPlayingMotion.sync(showSpotifyMotion && !sidebarCover ? findNowPlayingCover(panel) : null);
  };

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
      root.render(<SongSheetScope><NowPlayingCard host={host} open={() => { if (!close) void open(); }} expand={expand} /></SongSheetScope>);
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
    uploadAs.sync();
    reviewButton?.sync(!!reviewSidebar);
    placeReviewSidebar();
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
    artistCard.sync(panel);
    sidebarArtwork.sync(panel, sidebarCover);
    syncSpotifyMotion?.(panel);
  }
  let groupHostUpdates = getSetting("enhanceSpotifyPerformance");
  let hostSyncFrame = 0;
  const stopHostUpdateSettings = subscribeSettings(() => {
    groupHostUpdates = getSetting("enhanceSpotifyPerformance");
    if (!groupHostUpdates && hostSyncFrame) {
      window.cancelAnimationFrame(hostSyncFrame);
      hostSyncFrame = 0;
      syncHost();
    }
  });
  const observer = new MutationObserver((records) => {
    if (!groupHostUpdates) return syncHost();
    if (hostSyncFrame || records.every(({ target }) =>
      target instanceof Element && target.closest(".lyssna-lyrics-view"))) return;
    hostSyncFrame = window.requestAnimationFrame(() => {
      hostSyncFrame = 0;
      syncHost();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const stopCreatorRepeatRecovery = startCreatorRepeatRecovery(host);
  restoreCreatorPlaybackTransitions(host);
  syncHost();
  return {
    dispose() {
      disposed = true;
      stopCreatorRepeatRecovery();
      stopReleaseNotices();
      observer.disconnect();
      window.cancelAnimationFrame(hostSyncFrame);
      stopHostUpdateSettings();
      stopVolumeDrag();
      stopLocalPlaylistPlayback();
      stopViewSwitch();
      removeCard?.();
      backdrop?.dispose();
      mutedPreviewPanel?.classList.remove("lyssna-npv-hide-lyrics");
      detached?.dismiss();
      close?.(false);
      closeProfileSettings?.();
      stopProfileSettings();
      uploadAs.dispose();
      button?.remove();
      reviewButton?.dispose();
      reviewSidebar?.native.dispose();
      reviewSidebar?.resize.dispose();
      reviewSidebar?.root.unmount();
      reviewSidebar?.container.remove();
      viewButtons.dispose();
      playbarArtwork.dispose();
      nowPlayingMotion.dispose();
      artistCard.dispose();
      sidebarArtwork.dispose();
      disposeRuntimeSettings();
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
