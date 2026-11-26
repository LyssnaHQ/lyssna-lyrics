import { cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type CSSProperties, type ReactElement, type ReactNode, type RefObject, type UIEventHandler } from "react";
import { AlignLeft, AppWindow, ChevronLeft, ChevronUp, FileText, FlaskConical, Palette, Pin, Search, Settings2, SlidersHorizontal, WandSparkles, Wrench, X } from "lucide-react";
import discordOutline from "../assets/discord-outline.svg";
import discordSymbol from "../assets/discord-symbol.svg";
import kofiCup from "../assets/kofi-cup.png";
import kofiOutline from "../assets/kofi-outline.svg";
import EnhancementsSection from "./enhancements/section";
import { AnimatorPanel } from "./lyssna/animator-settings";
import { appFontStyles, FontControl } from "./font-settings";
import { HiddenSettings, SettingRow, SettingsQuery, SettingsSection, Toggle } from "./lyssna/setting-row";
import { visualRows } from "./lyssna/visual-settings";
import { lyricSources, refreshLyrics } from "./lyric-sources";
import { defaults, maxBackgroundBrightness, type Settings } from "./settings";
import { LyricsLibrary, SourcesManager } from "./settings-library";
import { exportSettings, importSettings } from "./settings-transfer";
import { pictureInPicture } from "./popout";
import { quickEffects } from "./quick-effects";
import { AccountSettings, useSettingsAccount } from "./account-settings";
import { StoredDataSettings } from "./creator/stored-data-settings";
import { activeHiddenBuildKey, forgetHiddenBuild, readSavedHiddenBuilds, rememberHiddenBuild } from "./hidden-builds";
import { OverlayScrollbar } from "./overlay-scrollbar";
import { discordInvite } from "./release-notices";
import type { Host, Track } from "./host";

export type Channel = "stable" | "beta" | "canary";
export const channelLabels: Record<Channel, string> = { stable: "Stable", beta: "Beta", canary: "Canary" };
export type BuildOptions = {
  channel: Channel;
  channels: Record<Channel, string | null>;
  selectChannel: (channel: Channel) => Promise<void>;
  hiddenVersion?: string;
  selectHiddenBuild?: (key: string) => Promise<void>;
  clearHiddenBuild?: () => void;
  lyssnaSignIn?: boolean;
  patchNotesUrl?: string;
  latestVersion?: (signal: AbortSignal) => Promise<string | null>;
  showLoading?: () => () => void;
};

const tabs = [
  ["Appearance", Palette], ["Lyrics", AlignLeft], ["Effects", FlaskConical], ["Views", AppWindow],
  ["Spotify Tweaks", WandSparkles], ["Sources", FileText], ["Tools", Wrench], ["Advanced", SlidersHorizontal],
] as const;
type Tab = (typeof tabs)[number][0];
const tabId = (label: Tab) => `lyssna-settings-tab-${label.toLowerCase().replaceAll(" ", "-")}`;
type Section = [Tab, string, ReactNode[], columns?: boolean];
const placeKey = "lyssna-lyrics.settings-place";
const footerLinks = [
  { label: "Discord", href: discordInvite, logo: discordSymbol, outline: discordOutline },
  { label: "Support us on Ko-fi", href: "https://ko-fi.com/lyssna", logo: kofiCup, outline: kofiOutline },
];
const submenus = {
  sources: "Manage Sources",
  library: "TTML Database",
  storage: "Manage Stored Data",
  hidden: "Hidden Settings",
  credits: "Credits and licences",
};
type Submenu = keyof typeof submenus;
type Place = { tab: Tab; scroll: number; submenu?: Submenu; submenuScroll?: number };
const oldTabs: Record<string, Tab> = {
  General: "Appearance", Library: "Sources", Layout: "Views", About: "Advanced", Credits: "Advanced",
};

function readPlace(remember: boolean): Place {
  try {
    const place = remember && JSON.parse(localStorage.getItem(placeKey) ?? "null");
    if (place && typeof place.tab === "string") {
      const oldTab = Object.hasOwn(oldTabs, place.tab) ? oldTabs[place.tab] : undefined;
      const tab = place.submenu === "storage" ? "Tools" : place.submenu === "hidden" || place.submenu === "credits" ? "Advanced"
        : oldTab ?? tabs.find(([label]) => label === place.tab)?.[0];
      if (tab) return {
        tab, scroll: !oldTab && Number.isFinite(place.scroll) ? place.scroll : 0,
        submenu: place.tab === "Credits" || place.tab === "About" ? "credits"
          : Object.hasOwn(submenus, place.submenu) ? place.submenu : undefined,
        submenuScroll: Number.isFinite(place.submenuScroll) ? place.submenuScroll : undefined,
      };
    }
  } catch { /* Start at Appearance if settings storage is unavailable. */ }
  return { tab: "Appearance", scroll: 0 };
}

function writePlace(place: Place) {
  try { localStorage.setItem(placeKey, JSON.stringify(place)); } catch { /* Navigation still works. */ }
}

const sourceSearch = Object.values(lyricSources).flatMap(({ name, help }) => [name, help]).join(" ");
function visualRowKey(row: ReactNode) {
  return isValidElement(row) && row.key !== null ? String(row.key) : "";
}

function SettingsScrollArea({ scroll, label, contentKey, onScroll, children }: {
  scroll: RefObject<HTMLDivElement | null>;
  label: string;
  contentKey?: string;
  onScroll?: UIEventHandler<HTMLDivElement>;
  children: ReactNode;
}) {
  return <div className="settings-scroll-frame">
    <div className="lyrics-settings-scroll overlay-scroll-content" ref={scroll} onScroll={onScroll}>{children}</div>
    <OverlayScrollbar scroll={scroll} label={label} contentKey={contentKey}
      alignTo=".lyrics-settings-group, .settings-source-card" observeContent />
  </div>;
}

export function SettingsPanel({ host, settings, change, close, options, track, notice, setNotice, view = window, developerMode, initialSubmenu, onEnableAutoRecord, canvasFrame }: {
  host: Host;
  settings: Settings;
  change: (patch: Partial<Settings>) => void;
  close: () => void;
  options: BuildOptions;
  track?: Track;
  notice: string;
  setNotice: (message: string) => void;
  view?: Window;
  developerMode?: boolean;
  initialSubmenu?: "storage";
  onEnableAutoRecord?: () => void;
  canvasFrame?: CanvasFrameControl;
}) {
  const trackId = track?.id;
  const [initial] = useState<Place>(() => initialSubmenu
    ? { tab: "Tools", scroll: 0, submenu: initialSubmenu } : readPlace(settings.settings_remember_place));
  const [tab, setTab] = useState(initial.tab);
  const [submenu, setSubmenu] = useState(initial.submenu);
  const [query, setQuery] = useState("");
  const [tuning, setTuning] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [buildKey, setBuildKey] = useState("");
  const [buildError, setBuildError] = useState("");
  const [savedBuilds, setSavedBuilds] = useState(readSavedHiddenBuilds);
  const [showChannels, setShowChannels] = useState(false);
  const [channelError, setChannelError] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [marker, setMarker] = useState<{ left: number; width: number }>();
  const modal = useRef<HTMLDialogElement>(null);
  const channelsDialog = useRef<HTMLDialogElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const channelScroll = useRef<HTMLDivElement>(null);
  const mainScroll = useRef(initial.scroll);
  const submenuScroll = useRef(initial.submenuScroll ?? 0);
  const parentSubmenu = useRef<{ key: Submenu; scroll: number }>(undefined);
  const backButton = useRef<HTMLButtonElement>(null);
  const openedFrom = useRef<Submenu>(initialSubmenu);
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const transferInput = useRef<HTMLInputElement>(null);
  const searching = !!query.trim();
  const account = useSettingsAccount(!tuning && !submenu && (tab === "Tools" || searching));
  const includeDependentRows = searching || submenu === "hidden";
  const visuals = visualRows(settings, change, () => setTuning(true), includeDependentRows);
  const fonts = appFontStyles(settings);
  const { flag, range } = visuals;
  const version = options.hiddenVersion ?? options.channels[options.channel];
  const activeBuild = options.hiddenVersion ? "Hidden build" : channelLabels[options.channel];
  const { selectHiddenBuild, clearHiddenBuild } = options;
  const activeHiddenKey = activeHiddenBuildKey();
  const hidden = new Set(settings.hidden_settings);
  const hiding = {
    allow: settings.settings_allow_hiding,
    buttons: settings.settings_hide_buttons,
    hidden,
    hide: (id: string) => change({ hidden_settings: [...new Set([...hidden, id])] }),
  };

  useLayoutEffect(() => {
    const dialog = modal.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, [tuning]);
  useLayoutEffect(() => {
    const dialog = channelsDialog.current;
    if (!showChannels || !dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, [showChannels]);

  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollTop = submenu ? submenuScroll.current : mainScroll.current;
    if (submenu) backButton.current?.focus({ preventScroll: true });
    else if (openedFrom.current) {
      const root = scroll.current?.getRootNode() as Document | ShadowRoot | undefined;
      root?.getElementById(`lyssna-open-${openedFrom.current}`)?.focus({ preventScroll: true });
      openedFrom.current = undefined;
    }
  }, [submenu, tuning, view]);
  useLayoutEffect(() => {
    const button = tabButtons.current[tabs.findIndex(([label]) => label === tab)];
    const list = button?.parentElement;
    if (!button || !list || tuning || submenu) return;
    const measure = () => setMarker({ left: button.offsetLeft, width: button.offsetWidth });
    measure();
    if (button.offsetLeft < list.scrollLeft) list.scrollLeft = button.offsetLeft;
    else if (button.offsetLeft + button.offsetWidth > list.scrollLeft + list.clientWidth) {
      list.scrollLeft = button.offsetLeft + button.offsetWidth - list.clientWidth;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    observer.observe(button);
    return () => observer.disconnect();
  }, [tab, tuning, submenu]);

  function select(next: Tab) {
    setTab(next);
    setQuery("");
    setNotice("");
    mainScroll.current = 0;
    scroll.current?.scrollTo({ top: 0 });
    if (settings.settings_remember_place) writePlace({ tab: next, scroll: 0 });
  }

  function openSubmenu(next: Submenu) {
    const top = scroll.current?.scrollTop ?? 0;
    if (submenu) parentSubmenu.current = { key: submenu, scroll: top };
    else mainScroll.current = top;
    submenuScroll.current = 0;
    openedFrom.current = next;
    setNotice("");
    setSubmenu(next);
    if (settings.settings_remember_place) writePlace({ tab, scroll: mainScroll.current, submenu: next, submenuScroll: 0 });
  }

  function back() {
    setNotice("");
    const parent = parentSubmenu.current;
    parentSubmenu.current = undefined;
    if (parent) submenuScroll.current = parent.scroll;
    setSubmenu(parent?.key);
    if (settings.settings_remember_place) writePlace({ tab, scroll: mainScroll.current, submenu: parent?.key, submenuScroll: parent?.scroll });
  }

  useEffect(() => {
    if (!submenu) return;
    function onEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      back();
    }
    view.addEventListener("keydown", onEscape, true);
    return () => view.removeEventListener("keydown", onEscape, true);
  }, [submenu, tab, settings.settings_remember_place, view]);

  function submenuButton(menu: Submenu, title: string) {
    return <button type="button" className="pill outline" id={`lyssna-open-${menu}`} onClick={() => openSubmenu(menu)}>{title}</button>;
  }

  function openChannels() {
    setChannelError("");
    setBuildError("");
    try {
      setSavedBuilds(activeHiddenKey ? rememberHiddenBuild(activeHiddenKey, options.hiddenVersion) : readSavedHiddenBuilds());
    } catch (error) {
      setBuildError(error instanceof Error ? error.message : "Couldn’t load saved build keys.");
    }
    setShowChannels(true);
  }

  function addHiddenBuild() {
    const key = buildKey.trim();
    if (switching || !key || !selectHiddenBuild) return;
    void runBuildAction(async () => {
      const saved = readSavedHiddenBuilds().some(build => build.key === key);
      // Save before switching because the launcher reloads after validating the key.
      setSavedBuilds(rememberHiddenBuild(key));
      try { await selectHiddenBuild(key); }
      catch (error) {
        if (!saved) setSavedBuilds(forgetHiddenBuild(key));
        throw error;
      }
      setBuildKey("");
    }, setBuildError);
  }

  function removeHiddenBuild(key: string) {
    void runBuildAction(() => {
      setSavedBuilds(forgetHiddenBuild(key));
      if (key === activeHiddenKey) clearHiddenBuild?.();
    }, setBuildError);
  }

  async function runBuildAction(action: () => void | Promise<void>, reportError: (message: string) => void) {
    setSwitching(true);
    reportError("");
    try {
      await action();
    } catch (error) {
      reportError(error instanceof Error ? error.message : "Couldn’t load that build.");
    } finally {
      setSwitching(false);
    }
  }

  async function transfer(file?: File) {
    setTransferring(true);
    try {
      if (file) {
        const { patch, skipped } = await importSettings(file);
        change(patch);
        setNotice(skipped ? `Settings imported. Skipped ${skipped} unsupported lyric files.` : "Settings and TTML imported.");
      } else await exportSettings(settings);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn’t transfer settings.");
    } finally {
      setTransferring(false);
    }
  }

  const emptyTrack = trackId ? undefined : "Play a song first.";
  const offset = trackId ? settings.lyric_song_offsets[trackId] ?? 0 : 0;
  const visualRowsByKey = new Map([...visuals.Look, ...visuals.Display, ...visuals.Effects, ...visuals.Layout]
    .map((row) => [visualRowKey(row), row]));
  const rowsFor = (...keys: string[]) => keys.map((key) => visualRowsByKey.get(key));
  const sections: Section[] = [
    ["Appearance", "Fonts", [
      <SettingRow key="lyric-font" label="Lyrics font" help="Choose a font or type an installed family name."
        keywords="font typeface spotify mix installed">
        <FontControl field="lyric_font" settings={settings} change={change} view={view} />
      </SettingRow>,
      <SettingRow key="custom_fonts_enabled" label="App font" help="Used in Lyssna menus and controls."
        keywords="font typeface spotify mix installed">
        <FontControl field="ui_font" settings={settings} change={change} view={view} />
      </SettingRow>,
      ...rowsFor("size"),
    ]],
    ["Appearance", "Background", [
      ...rowsFor("background"),
      range("lyrics_background_brightness", "Dynamic background brightness", "Adjust the brightness of animated and still artwork backgrounds.",
        "background brightness ambience dynamic animated artwork dim", [0, maxBackgroundBrightness, 1], defaults.lyrics_background_brightness, "%",
        !["animated", "static"].includes(settings.lyrics_background)),
      ...rowsFor("lyrics_background_blur"),
    ]],
    ["Appearance", "Artwork", rowsFor("animated_covers", "cover_animation"), true],
    ["Appearance", "Spotify Canvas", [
      ...rowsFor("canvas_lyrics"),
      <CanvasFrameSlider key="canvas-frame" control={canvasFrame} />,
    ]],
    ["Appearance", "Interface", [
      flag("liquid_glass", "Liquid Glass", "Use translucent glass for the lyrics toolbar and dialogs.", "theme glass blur translucent"),
      flag("reduce_motion", "Reduce motion", "Turn off animated backgrounds and word animations.", "animation accessibility"),
    ], true],
    ["Appearance", "Animation performance", [
      flag("animation_fps_cap_enabled", "Limit animation frame rate", "Cap how often lyrics, scrolling and the moving background redraw, to save power.", "fps frame rate"),
      range("animation_fps_cap", "Animation frame rate", "The most frames per second animations draw while the limit is on.",
        "fps frame rate", [15, 240, 5], 60, " fps", !settings.animation_fps_cap_enabled),
    ]],
    ["Lyrics", "Language", rowsFor("romanized", "lyrics_translations", "romanization_below", "romaji_as_written"), true],
    ["Lyrics", "Credits", [
      ...rowsFor("pinned-footer", "lyrics_credits_follow"),
      <SettingRow key="lyrics_discord_usernames" label="Discord display name in credits"
        help="Show display names. Turn off to look up Discord usernames through the same public service as Legacy."
        keywords="discord username user names contributor credits">
        <Toggle label="Discord display name in credits" checked={!settings.lyrics_discord_usernames}
          onChange={(displayNames) => change({ lyrics_discord_usernames: !displayNames })} />
      </SettingRow>,
    ]],
    ["Lyrics", "Timing and scrolling", [
      <SettingRow key="global-offset" label="Lyric timing offset" help="Positive values show lyrics earlier." keywords="delay timing offset">
        <TimingOffsetSlider label="Lyric timing offset" value={settings.lyric_offset_ms}
          onChange={(lyric_offset_ms) => change({ lyric_offset_ms })} />
      </SettingRow>,
      <SettingRow key="song-offset" label="This song's offset" help="Added to the global lyric timing offset." unavailable={emptyTrack}>
        <TimingOffsetSlider label="This song's offset" value={offset} disabled={!trackId}
          onChange={(value) => {
            if (trackId) change({ lyric_song_offsets: { ...settings.lyric_song_offsets, [trackId]: value } });
          }} />
      </SettingRow>,
      ...rowsFor("experimental_word_sync", "lyrics_early_scroll", "lyrics_early_scroll_ms", "lyrics_smooth_scroll", "lyrics_follow_button"),
    ]],
    ["Lyrics", "Line layout", rowsFor("lyrics_right_align", "lyrics_flip_duet", "lyrics_wide_duet", "lyrics_line_hover"), true],
    ["Lyrics", "Loading and missing lyrics", rowsFor("lyrics_skeleton", "lyrics_no_lyrics_notice"), true],
    ["Effects", "Animation and text effects", rowsFor("animator", "word-filter")],
    ["Effects", "Lyric modes", rowsFor("lyrics_simple", "lyrics_minimal", "lyrics_keep_overlaps"), true],
    ["Effects", "Space Gravity", [
      ...rowsFor("space_gravity", "gravity_word_density"),
      (settings.space_gravity || includeDependentRows) && visualRowsByKey.get("lyrics_seek_compensation"),
    ]],
    ["Effects", "Highlighter", rowsFor("lyrics_highlighter", "highlighter-colour", "gravity_links", "gravity_link_width")],
    ["Effects", "Visualiser", rowsFor("lyrics_visualiser", "lyrics_visualiser_opacity")],
    ["Views", "Artwork and layout", rowsFor("lyrics_compact", "lyrics_hide_artwork", "lyrics_artwork_right", "lyrics_up_next"), true],
    ["Views", "Controls and details", rowsFor("toolbar-position", "year")],
    ["Views", "Full screen", rowsFor("always-show", "fullscreen-volume", "escape", "fullscreen_animate_close", "glass_seek")],
    ["Views", "Separate windows", [
      flag("cinema_lyrics", "Enable lyrics pop-out", "Show the Picture-in-Picture button in the playbar.",
        "cinema window external popup", pictureInPicture ? undefined : "This Spotify client does not support Picture-in-Picture windows."),
      flag("cinema_window", "Enable Cinema Lyrics Window", developerMode === true
        ? "Add a playbar button that opens the full lyrics view in a separate window."
        : "The separate lyrics window requires Spotify DevTools. Enable it with spicetify enable-devtools.",
      "cinema window external popup devtools"),
    ]],
    ["Views", "Now Playing sidebar", rowsFor("lyrics_hide_npv", "lyrics_hide_npv_empty", "npv_ambience"), true],
    ["Sources", "Providers and imports", [
      <SettingRow key="source-order" label="Manage Sources" help="Set lyric source priority and availability."
        keywords={`sources order ${sourceSearch}`}>
        {submenuButton("sources", "Manage")}
      </SettingRow>,
      <SettingRow key="ttml-library" label="Browse TTML Database" help="Open your saved lyrics." keywords="local lyrics download remove">
        {submenuButton("library", "Browse")}
      </SettingRow>,
    ]],
    ["Sources", "Refresh and cache", [
      <SettingRow key="lyrics_cache_button" label="Lyrics View Cache Button" help="Choose what the refresh button does in the lyrics toolbar."
        keywords="cache-action refresh clear reload">
        <div className="settings-actions">
          <select className="settings-select" aria-label="Lyrics cache button action" value={settings.lyrics_cache_action}
            onChange={(event) => change({ lyrics_cache_action: event.target.value as Settings["lyrics_cache_action"] })}>
            <option value="song">Clear current song</option><option value="reload">Reload current song</option><option value="all">Clear Lyssna cache</option>
          </select>
          <Toggle label="Show lyrics cache button" checked={settings.lyrics_cache_button}
            onChange={(lyrics_cache_button) => change({ lyrics_cache_button })} />
        </div>
      </SettingRow>,
      <SettingRow key="lyrics-cache" label="Cache Actions" help="Clear Cache also resets per-song source choices. Saved imports are kept." keywords="storage cache clear refresh">
        <div className="settings-actions">
          <button type="button" className="pill outline" disabled={!trackId} onClick={() => {
            refreshLyrics(track, "song");
            setNotice("Cleared the current song’s cache.");
          }}>Clear Current Song</button>
          <button type="button" className="pill outline" onClick={() => {
            refreshLyrics(track, "all");
            setNotice("Lyric cache and per-song source choices cleared.");
          }}>Clear Cache</button>
        </div>
      </SettingRow>,
    ]],
    ["Tools", "Account", [
      <AccountSettings key="lyssna-account" ready={options.lyssnaSignIn === true} host={host} {...account} />,
    ]],
    ["Tools", "Creator and recording", [
      flag("ttml_creator", "TTML Creator", "Add an editor button beside fullscreen in the playbar to write and time lyrics for the playing song.",
        "ttml creator maker editor sync timing word by word karaoke amll make lyrics"),
      (settings.ttml_creator || searching) && <SettingRow key="auto_record" label="Auto Record"
        help="Ask to share Spotify audio when Lyssna Lyrics loads. Save songs and spectrograms on this device while sharing is active."
        keywords="automatic recording capture audio spectrogram startup"
        unavailable={settings.ttml_creator ? undefined : "Turn on TTML Creator first."}>
        <Toggle label="Auto Record" checked={settings.auto_record} onChange={(auto_record) => {
          change({ auto_record });
          if (auto_record) onEnableAutoRecord?.();
        }} />
      </SettingRow>,
    ]],
    ["Tools", "Storage", [
      <SettingRow key="manage-storage" label="Manage Stored Data" help="Manage recordings, spectrograms, and cached animated cover art."
        keywords="clear cache storage disk audio cover art delete export spectral waveform">
        {submenuButton("storage", "Manage")}
      </SettingRow>,
    ]],
    ["Advanced", "Backups", [
      <SettingRow key="settings-transfer" label="Import and export settings" help="Transfer Lyssna preferences, animator presets, per-song offsets and imported TTML." keywords="backup restore transfer">
        <div className="settings-actions">
          <input ref={transferInput} hidden type="file" accept=".json" aria-label="Import settings file" onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void transfer(file);
          }} />
          <button type="button" className="pill outline" disabled={transferring} onClick={() => transferInput.current?.click()}>Import</button>
          <button type="button" className="pill outline" disabled={transferring} onClick={() => void transfer()}>Export</button>
        </div>
      </SettingRow>,
    ]],
    ["Advanced", "Preferences", [
      flag("settings_remember_place", "Remember settings location", "Reopen Settings on the tab and at the place it was closed.", "tab location remember reopen"),
      flag("settings_allow_hiding", "Allow hiding settings", "Hide settings you never change. Restore them from Hidden settings."),
      (settings.settings_allow_hiding || searching) && flag("settings_hide_buttons", "Show hide buttons", "Put a hide button beside each setting's name.",
        "hide hidden settings buttons eye", settings.settings_allow_hiding ? undefined : "Turn on Allow hiding settings first."),
      flag("sync_other_plugin_preferences", "Sync preferences with other plugins", "Apply changes to compatible preferences from Legacy, Spicy Lyrics or Spotify+."),
    ], true],
    ["Advanced", "Settings and build information", [
      settings.settings_allow_hiding && <SettingRow key="manage-hidden" label="Manage Hidden Settings" help="Restore settings hidden from the main window.">
        {submenuButton("hidden", "Manage")}
      </SettingRow>,
      <SettingRow key="credits" label={submenus.credits} keywords="Inter Metropolis Adobe Blank Kawarp Lucide about credits licenses">
        {submenuButton("credits", "View")}
      </SettingRow>,
      searching && <SettingRow key="channel" label="Build Channels" help={`${activeBuild}${version ? ` · v${version}` : ""}`}
        keywords="current build version canary stable beta access key private test release hidden build channel">
        <button type="button" className="pill outline" aria-haspopup="dialog" onClick={openChannels}>Manage</button>
      </SettingRow>,
    ]],
  ];
  const hiddenRows = new Map<string, ReactElement<ComponentProps<typeof SettingRow>>>();
  for (const section of sections) {
    if (section[0] === "Tools" || section[0] === "Advanced") continue;
    section[2] = section[2].map((row) => {
      if (!isValidElement(row) || row.type !== SettingRow || row.key === null) return row;
      const setting = row as ReactElement<ComponentProps<typeof SettingRow>>;
      const id = String(row.key);
      const effect = quickEffects.find((option) => option.id === id);
      if (!effect) {
        if (hidden.has(id)) hiddenRows.set(id, setting);
        return cloneElement(setting, { hideId: id });
      }
      const pins = settings.pinned_lyric_effects;
      const pinned = pins.includes(id);
      const title = `${pinned ? "Unpin" : "Pin"} ${effect.label} ${pinned ? "from" : "to"} the lyrics toolbar`;
      const withPin = cloneElement(setting, {}, <>
        <button className="icon-button setting-pin" type="button" title={title}
          aria-label={`Pin ${effect.label} to the lyrics toolbar`} aria-pressed={pinned}
          onClick={() => change({ pinned_lyric_effects: pinned ? pins.filter((pin) => pin !== id) : [...pins, id] })}>
          <Pin size={14} />
        </button>
        {setting.props.children}
      </>);
      if (hidden.has(id)) hiddenRows.set(id, withPin);
      return cloneElement(withPin, { hideId: id });
    });
  }
  const hiddenSettings = settings.hidden_settings.map((id) => {
    const row = hiddenRows.get(id) ?? <SettingRow key={id} label={id.replaceAll("_", " ")} />;
    const label = typeof row.props.label === "string" ? row.props.label : id;
    return cloneElement(row, { labelAction: <button type="button" className="pill outline setting-restore"
      aria-label={`Show ${label} in Settings`} onClick={() => change({ hidden_settings: settings.hidden_settings.filter((item) => item !== id) })}>Show</button> });
  });

  const backdropClass = `modal-backdrop lyrics-settings-backdrop${settings.liquid_glass ? " liquid-glass" : ""}${settings.reduce_motion ? " reduce-motion" : ""}${tuning ? " lyssna-animator-backdrop" : ""}`;
  const content = <div className={backdropClass} style={fonts}
    onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    {tuning ? <AnimatorPanel view={view} animator={settings.lyrics_animator} onChange={(lyrics_animator) => change({ lyrics_animator })}
      onBack={() => setTuning(false)} onClose={close} /> : <section className={`lyrics-settings plugin-settings${submenu ? " plugin-settings-submenu" : ""}`}>
      <header className="lyrics-settings-head">
        {submenu && <button type="button" ref={backButton} className="pill outline settings-submenu-back" onClick={back}>
          <ChevronLeft size={16} />Back
        </button>}
        <h2 id="lyssna-settings-title">{submenu ? submenus[submenu] : <><Settings2 size={20} />Lyssna Lyrics settings</>}</h2>
        {!submenu && <label className="lyrics-settings-search"><Search size={15} /><input aria-label="Search settings" placeholder="Search settings…" value={query}
          onChange={(event) => { setQuery(event.target.value); scroll.current?.scrollTo({ top: 0 }); }} /></label>}
        <button type="button" className="icon-button" aria-label="Close settings" onClick={close}><X size={18} /></button>
      </header>
      {!submenu && <div className="lyrics-settings-tabs" role="tablist" aria-label="Settings categories">
        <span className="lyrics-settings-marker" aria-hidden="true" style={marker && !searching
          ? { opacity: 1, transform: `translateX(${marker.left}px)`, width: marker.width } : { opacity: 0 }} />
        {tabs.map(([label, Icon], index) => <button type="button" key={label} ref={(element) => { tabButtons.current[index] = element; }}
          role="tab" aria-selected={tab === label && !searching} className={tab === label && !searching ? "active" : ""}
          id={tabId(label)} aria-controls="lyssna-settings-content"
          tabIndex={(!searching && tab === label) || (searching && index === 0) ? 0 : -1}
          onClick={() => select(label)} onKeyDown={(event) => {
            let next: number;
            if (event.key === "Home") next = 0;
            else if (event.key === "End") next = tabs.length - 1;
            else if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
            else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
            else return;
            event.preventDefault();
            select(tabs[next][0]);
            tabButtons.current[next]?.focus();
          }}><Icon size={16} />{label}</button>)}
      </div>}
      <SettingsScrollArea scroll={scroll} label="Scroll settings" contentKey={`${submenu ?? tab}:${query}`} onScroll={(event) => {
        const top = event.currentTarget.scrollTop;
        if (submenu) submenuScroll.current = top;
        else if (!searching) mainScroll.current = top;
        if (settings.settings_remember_place && (submenu || !searching)) {
          writePlace({ tab, scroll: mainScroll.current, submenu, submenuScroll: submenu ? top : undefined });
        }
      }}>
        {submenu === "sources" && <SourcesManager settings={settings} change={change} />}
        {submenu === "library" && <LyricsLibrary notice={setNotice} />}
        {submenu === "storage" && <StoredDataSettings host={host} notice={setNotice} />}
        {submenu === "hidden" && (hiddenSettings.length ? <div className="lyrics-settings-group">{hiddenSettings}</div>
          : <p className="settings-submenu-empty">No hidden settings.</p>)}
        {submenu === "credits" && <div className="lyrics-settings-group">
          <SettingRow label="Inter" help="Lyrics typeface by the Inter Project Authors. SIL Open Font License." />
          <SettingRow label="Metropolis" help="Interface typeface by Chris Simpson. Unlicense." />
          <SettingRow label="Adobe Blank 2" help="Detects missing characters in custom lyric fonts. SIL Open Font License." />
          <SettingRow label="Kawarp" help="Artwork ambience by Better Lyrics. MIT." />
          <SettingRow label="Lucide" help="Interface icons by the Lucide contributors. ISC and MIT." />
        </div>}
        {!submenu && <HiddenSettings.Provider value={hiding}><SettingsQuery.Provider value={query}>
          <div id="lyssna-settings-content" role={searching ? "region" : "tabpanel"}
            aria-label={searching ? "Search results" : undefined} aria-labelledby={searching ? undefined : tabId(tab)}>
            {sections.filter(([key]) => searching || key === tab).map(([key, title, rows, columns]) => (
              <SettingsSection key={`${key}-${title}`} category={key} title={title} columns={columns}>{rows}</SettingsSection>
            ))}
            {(searching || tab === "Spotify Tweaks") && <EnhancementsSection notice={setNotice} />}
            <p className="lyrics-settings-empty">No settings match.</p>
          </div>
        </SettingsQuery.Provider></HiddenSettings.Provider>}
        {notice && <p className="settings-alert" role="status">{notice}</p>}
      </SettingsScrollArea>
      {!submenu && <footer className="lyrics-settings-footer">
        <nav className="settings-footer-links" aria-label="Lyssna links">
          {footerLinks.map(({ label, href, logo, outline }) => <a key={href} className="settings-footer-action"
            href={href} target="_blank" rel="noopener noreferrer">
            <span className="settings-footer-logo" style={{ "--footer-logo-outline": `url("${outline}")` } as CSSProperties}>
              <img src={logo} alt="" width={20} height={20} />
            </span>
            {label}
          </a>)}
        </nav>
        <button type="button" id="lyssna-open-builds" className="settings-footer-action settings-build-trigger"
          aria-haspopup="dialog" aria-expanded={showChannels}
          aria-label={`Build Channels, ${activeBuild}${version ? ` v${version}` : ""}`}
          title={`Build Channels · ${activeBuild}${version ? ` · v${version}` : ""}`} onClick={openChannels}>
          <span>{activeBuild}{version ? ` · v${version}` : ""}</span><ChevronUp size={13} aria-hidden="true" />
        </button>
      </footer>}
    </section>}
  </div>;
  return tuning ? content : <>
    <dialog ref={modal} className="lyssna-settings-dialog" aria-labelledby="lyssna-settings-title"
      onCancel={(event) => {
        event.preventDefault();
        if (submenu) back();
        else close();
      }}>{content}</dialog>
    <dialog ref={channelsDialog} className={`lyrics-settings lyssna-build-channels${settings.liquid_glass ? " liquid-glass" : ""}`}
      style={fonts} aria-labelledby="lyssna-build-channels-title"
      onCancel={(event) => { event.preventDefault(); setShowChannels(false); }}
      onKeyDown={(event) => { if (event.key === "Escape" || event.key === "F11") event.stopPropagation(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) setShowChannels(false);
      }}>
      <header className="lyrics-settings-head">
        <h2 id="lyssna-build-channels-title">Build Channels</h2>
        <button type="button" className="icon-button" aria-label="Close build channels" onClick={() => setShowChannels(false)}><X size={18} /></button>
      </header>
      <SettingsScrollArea scroll={channelScroll} label="Scroll build channels">
        <div className="lyrics-settings-group">
          {(Object.keys(options.channels) as Channel[]).map((channel) => {
            const current = channel === options.channel && !clearHiddenBuild;
            return <SettingRow key={channel} label={channelLabels[channel]}
              help={options.channels[channel] ? `v${options.channels[channel]}` : "No build published."}>
              <button type="button" className="pill outline" disabled={switching || current || !options.channels[channel]}
                onClick={() => void runBuildAction(() => options.selectChannel(channel), setChannelError)}>
                {current ? "Current" : clearHiddenBuild ? "Switch and reload" : "Switch"}
              </button>
            </SettingRow>;
          })}
          {selectHiddenBuild && savedBuilds.map(build => {
            const selected = build.key === activeHiddenKey;
            const current = selected && !!options.hiddenVersion;
            const ending = build.key.slice(-4);
            return <SettingRow key={build.key} label={build.version ? `v${build.version}` : "Hidden build"}
              help={`${selected && !current ? "Unavailable · " : ""}Key ending in ${ending}`}>
              <div className="settings-actions">
                <button type="button" className="pill outline" disabled={switching || current}
                  aria-label={current ? "Current hidden build" : `Switch to hidden build ending in ${ending}`}
                  onClick={() => void runBuildAction(() => selectHiddenBuild(build.key), setBuildError)}>
                  {current ? "Current" : selected ? "Retry" : "Switch"}
                </button>
                <button type="button" className="pill outline" disabled={switching}
                  aria-label={`Remove hidden build ending in ${ending}`} onClick={() => removeHiddenBuild(build.key)}>Remove</button>
              </div>
            </SettingRow>;
          })}
        </div>
        {selectHiddenBuild && showChannels && (
          <form className="lyssna-build-key-form" aria-label="Add hidden build key" onSubmit={(event) => {
            event.preventDefault();
            addHiddenBuild();
          }}>
            <input type="password" autoComplete="off" aria-label="Hidden build key" placeholder="Paste hidden build key"
              value={buildKey} disabled={switching} maxLength={64} onChange={(event) => {
                setBuildKey(event.target.value);
                setBuildError("");
              }} />
            <button type="submit" className="pill outline" disabled={switching || !buildKey.trim()}>Apply and reload</button>
            {clearHiddenBuild && !savedBuilds.some(build => build.key === activeHiddenKey) && <button type="button" className="pill outline" disabled={switching}
              onClick={() => void runBuildAction(clearHiddenBuild, setBuildError)}>Remove key</button>}
          </form>
        )}
        {buildError && <p className="settings-alert" role="alert">{buildError}</p>}
        {channelError && <p className="settings-alert" role="alert">{channelError}</p>}
      </SettingsScrollArea>
    </dialog>
  </>;
}

function TimingOffsetSlider({ label, value, disabled, onChange }: {
  label: string; value: number; disabled?: boolean; onChange(value: number): void;
}) {
  const limit = 10_000;
  const text = `${value > 0 ? "+" : ""}${value} ms`;
  const fill = (Math.max(-limit, Math.min(limit, value)) + limit) / (limit * 2) * 100;
  return <span className="settings-range">
    <input type="range" aria-label={label} aria-valuetext={text} min={-limit} max={limit} step={1}
      value={value} disabled={disabled} style={{ "--fill": `${fill}%` } as CSSProperties}
      onChange={(event) => onChange(event.currentTarget.valueAsNumber)} />
    <output>{text}</output>
  </span>;
}

type CanvasFrameControl = {
  video: HTMLVideoElement | null; heldFrame?: number;
  hold(seconds: number): void; release(): void;
};

function CanvasFrameSlider({ control }: { control?: CanvasFrameControl }) {
  const video = control?.video;
  const heldFrame = control?.heldFrame;
  const [timeline, setTimeline] = useState<{ video: HTMLVideoElement; max: number; seconds: number }>();
  useEffect(() => {
    if (!video) return;
    const sync = () => {
      const max = Number.isFinite(video.duration) ? Math.max(0, Math.ceil(video.duration * 100) - 1) : 0;
      setTimeline({ video, max, seconds: video.currentTime });
    };
    const events = ["loadedmetadata", "durationchange", "timeupdate", "emptied"];
    for (const event of events) video.addEventListener(event, sync);
    sync();
    return () => { for (const event of events) video.removeEventListener(event, sync); };
  }, [video]);
  const current = timeline && timeline.video === video ? timeline : undefined;
  const max = current?.max ?? 0;
  const value = Math.min(max, Math.round((heldFrame ?? current?.seconds ?? 0) * 100));
  const time = `${(value / 100).toFixed(2)} s`;
  return <SettingRow label="Canvas frame" help="Drag to freeze the frame. Resume returns to normal Canvas playback."
    unavailable={max ? undefined : "Open lyrics with an active Spotify Canvas."}>
    <div className="settings-actions">
      <span className="settings-range">
        <input type="range" aria-label="Canvas frame" aria-valuetext={time} min={0} max={max || 1} value={value}
          disabled={!max} style={{ "--fill": `${max ? (value / max) * 100 : 0}%` } as CSSProperties}
          onChange={(event) => control?.hold(event.currentTarget.valueAsNumber / 100)} />
        <output>{time}</output>
      </span>
      <button type="button" className="pill outline" disabled={heldFrame === undefined} onClick={control?.release}>Resume</button>
    </div>
  </SettingRow>;
}
