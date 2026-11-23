import { cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { AlignLeft, AppWindow, ChevronLeft, FileText, FlaskConical, Info, Palette, Pin, Search, Settings2, WandSparkles, Wrench, X } from "lucide-react";
import EnhancementsSection from "./enhancements/section";
import { AnimatorPanel } from "./lyssna/animator-settings";
import { appFontStyles, FontControl } from "./font-settings";
import { HiddenSettings, SettingRow, SettingsQuery, Toggle } from "./lyssna/setting-row";
import { visualRows } from "./lyssna/visual-settings";
import { lyricSources, refreshLyrics } from "./lyric-sources";
import { defaults, maxBackgroundBrightness, type Settings } from "./settings";
import { LyricsLibrary, SourcesManager } from "./settings-library";
import { exportSettings, importSettings } from "./settings-transfer";
import { pictureInPicture } from "./popout";
import { quickEffects } from "./quick-effects";
import { AccountSettings } from "./account-settings";
import { StoredDataSettings } from "./creator/stored-data-settings";
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
  ["Appearance", Palette], ["Lyrics", AlignLeft], ["Effects", FlaskConical], ["Layout", AppWindow], ["Spotify Tweaks", WandSparkles],
  ["Sources", FileText], ["Advanced", Wrench], ["Credits", Info],
] as const;
type Tab = (typeof tabs)[number][0];
type Section = [Tab, string, ReactNode[]];
const placeKey = "lyssna-lyrics.settings-place";
const submenus = {
  sources: "Manage Sources",
  library: "TTML Database",
  storage: "Manage Stored Data",
  builds: "Build Channels",
  hidden: "Hidden Settings",
  misc: "Extra Misc Settings That Aren’t Often Useful",
};
type Submenu = keyof typeof submenus;
type Place = { tab: Tab; scroll: number; submenu?: Submenu; submenuScroll?: number };
const oldTabs: Record<string, Tab> = { General: "Appearance", Library: "Sources", About: "Credits" };

function readPlace(remember: boolean): Place {
  try {
    const place = remember && JSON.parse(localStorage.getItem(placeKey) ?? "null");
    if (place && typeof place.tab === "string") {
      if (Object.hasOwn(oldTabs, place.tab)) return { tab: oldTabs[place.tab], scroll: 0 };
      const tab = tabs.find(([label]) => label === place.tab)?.[0];
      if (tab && Number.isFinite(place.scroll)) return {
        tab, scroll: place.scroll,
        submenu: Object.hasOwn(submenus, place.submenu) ? place.submenu : undefined,
        submenuScroll: Number.isFinite(place.submenuScroll) ? place.submenuScroll : undefined,
      };
    }
  } catch { /* Start at Appearance if settings storage is unavailable. */ }
  return { tab: "Appearance", scroll: 0 };
}

function writePlace(place: Place) {
  try { localStorage.setItem(placeKey, JSON.stringify(place)); } catch { /* Navigation still works. */ }
}

const sourceSearch = ["Prioritize Apple Music quality", ...Object.values(lyricSources).flatMap(({ name, help }) => [name, help])].join(" ");
const appearanceRows = ["background", "lyrics_background_blur", "pinned-footer", "npv_ambience", "glass_seek", "canvas_lyrics", "animated_covers", "cover_animation"];

function visualRowKey(row: ReactNode) {
  return isValidElement(row) && row.key !== null ? String(row.key) : "";
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
    ? { tab: "Advanced", scroll: 0, submenu: initialSubmenu } : readPlace(settings.settings_remember_place));
  const [tab, setTab] = useState(initial.tab);
  const [submenu, setSubmenu] = useState(initial.submenu);
  const [query, setQuery] = useState("");
  const [tuning, setTuning] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [buildKey, setBuildKey] = useState("");
  const [buildError, setBuildError] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [marker, setMarker] = useState<{ left: number; width: number }>();
  const modal = useRef<HTMLDialogElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const mainScroll = useRef(initial.scroll);
  const submenuScroll = useRef(initial.submenuScroll ?? 0);
  const backButton = useRef<HTMLButtonElement>(null);
  const openedFrom = useRef<Submenu>(initialSubmenu);
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const transferInput = useRef<HTMLInputElement>(null);
  const searching = !!query.trim();
  const visuals = visualRows(settings, change, () => setTuning(true));
  const fonts = appFontStyles(settings);
  const { flag, range } = visuals;
  const version = options.hiddenVersion ?? options.channels[options.channel];
  const activeBuild = options.hiddenVersion ? "Hidden build" : channelLabels[options.channel];
  const { selectHiddenBuild, clearHiddenBuild } = options;
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
    mainScroll.current = scroll.current?.scrollTop ?? 0;
    submenuScroll.current = 0;
    openedFrom.current = next;
    setNotice("");
    setSubmenu(next);
    if (settings.settings_remember_place) writePlace({ tab, scroll: mainScroll.current, submenu: next, submenuScroll: 0 });
  }

  function back() {
    setNotice("");
    setSubmenu(undefined);
    if (settings.settings_remember_place) writePlace({ tab, scroll: mainScroll.current });
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
  const visualRowsByKey = new Map([...visuals.Look, ...visuals.Effects].map((row) => [visualRowKey(row), row]));
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
    ]],
    ["Appearance", "Appearance", [
      flag("liquid_glass", "Liquid Glass", "Use translucent glass for settings, source management, and the TTML database.", "theme glass blur translucent"),
      visualRowsByKey.get("background"),
      range("lyrics_background_brightness", "Dynamic background brightness", "Adjust the brightness of animated and still artwork backgrounds.",
        "background brightness ambience dynamic animated artwork dim", [0, maxBackgroundBrightness, 1], defaults.lyrics_background_brightness, "%"),
      ...appearanceRows.filter((key) => key !== "background").map((key) => visualRowsByKey.get(key)),
      flag("animation_fps_cap_enabled", "Limit animation frame rate", "Cap how often lyrics, scrolling and the moving background redraw, to save power.", "fps frame rate"),
      range("animation_fps_cap", "Animation frame rate", "The most frames per second animations draw while the limit is on.",
        "fps frame rate", [15, 240, 5], 60, " fps", !settings.animation_fps_cap_enabled),
      flag("reduce_motion", "Reduce motion", "Turn off animated backgrounds and word animations.", "animation accessibility"),
      <SettingRow key="theme" label="Theme" help="Light or dark, or match the system. Lyrics and artwork stay dark." keywords="theme light dark colour">
        <select className="settings-select" aria-label="Theme" value={settings.theme} onChange={(event) => change({ theme: event.target.value as Settings["theme"] })}>
          <option value="dark">Dark</option><option value="light">Light</option><option value="system">Match system</option>
        </select>
      </SettingRow>,
    ]],
    ["Lyrics", "Lyrics display", [
      visualRowsByKey.get("size"),
      <SettingRow key="lyrics_discord_usernames" label="Discord display name in credits"
        help="Show display names. Turn off to look up Discord usernames through the same public service as Legacy."
        keywords="discord username user names contributor credits">
        <Toggle label="Discord display name in credits" checked={!settings.lyrics_discord_usernames}
          onChange={(displayNames) => change({ lyrics_discord_usernames: !displayNames })} />
      </SettingRow>,
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
      ...visuals.Display,
    ]],
    ["Layout", "Lyrics layout", [
      flag("cinema_lyrics", "Enable lyrics pop-out", "Show the Picture-in-Picture button in the playbar.",
        "cinema window external popup", pictureInPicture ? undefined : "This Spotify client does not support Picture-in-Picture windows."),
      flag("cinema_window", "Enable Cinema Lyrics Window", developerMode === true
        ? "Add a playbar button that opens the full lyrics view in a separate window."
        : "The separate lyrics window requires Spotify DevTools. Enable it with spicetify enable-devtools.",
      "cinema window external popup devtools"),
      ...visuals.Layout,
      visualRowsByKey.get("year"),
    ]],
    ["Effects", "Lyric effects", visuals.Effects.filter((row) => !appearanceRows.includes(visualRowKey(row)))],
    ["Sources", "Sources", [
      <SettingRow key="source-order" label="Manage Sources" help="Set lyric source priority, availability, and provider options."
        keywords={`sources order ${sourceSearch}`}>
        {submenuButton("sources", "Manage")}
      </SettingRow>,
      <SettingRow key="ttml-library" label="Browse TTML Database" help="Open your saved lyrics." keywords="local lyrics download remove">
        {submenuButton("library", "Browse")}
      </SettingRow>,
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
      <SettingRow key="lyrics-cache" label="Cache Actions" help="Clear lyrics cached by Lyssna. Imported lyrics are kept." keywords="storage cache clear refresh">
        <div className="settings-actions">
          <button type="button" className="pill outline" disabled={!trackId} onClick={() => {
            refreshLyrics(track, "song");
            setNotice("Cleared the current song’s cache.");
          }}>Clear Current Song</button>
          <button type="button" className="pill outline" onClick={() => {
            refreshLyrics(track, "all");
            setNotice("Lyssna lyric cache cleared.");
          }}>Clear Cache</button>
        </div>
      </SettingRow>,
    ]],
    ["Advanced", "Lyssna Account", [
      <AccountSettings key="lyssna-account" ready={options.lyssnaSignIn === true} />,
    ]],
    ["Advanced", "Build Channel", [
      <SettingRow key="channel" label="Current build" help={`${activeBuild}${version ? ` · v${version}` : ""}`} keywords="build channel version canary stable beta">
        {submenuButton("builds", "Manage")}
      </SettingRow>,
      selectHiddenBuild && <SettingRow key="hidden-build-key" label="Hidden build key" stacked
        help={options.hiddenVersion ? "Remove the key to reload your public channel."
          : clearHiddenBuild ? "Saved build unavailable. Remove the key or enter a new one."
          : "Enter a key from Lyssna to load a specific build on this Spotify client."}
        keywords="access key private test release hidden build channel">
        <form className="lyssna-build-key-form" onSubmit={(event) => {
          event.preventDefault();
          const key = buildKey.trim();
          if (!switching && key) void runBuildAction(() => selectHiddenBuild(key), setBuildError);
        }}>
          <input type="password" autoComplete="off" aria-label="Hidden build key" placeholder="Paste build key"
            value={buildKey} disabled={switching} maxLength={64} onChange={(event) => {
              setBuildKey(event.target.value);
              setBuildError("");
            }} />
          <button type="submit" className="pill outline" disabled={switching || !buildKey.trim()}>Apply and reload</button>
          {clearHiddenBuild && <button type="button" className="pill outline" disabled={switching}
            onClick={() => void runBuildAction(clearHiddenBuild, setBuildError)}>Remove key</button>}
        </form>
        {buildError && <p className="settings-alert" role="alert">{buildError}</p>}
      </SettingRow>,
    ]],
    ["Advanced", "Advanced", [
      <SettingRow key="manage-storage" label="Manage Stored Data" help="Clear recordings, spectrograms, and cached animated cover art."
        keywords="cache storage disk audio cover art">
        {submenuButton("storage", "Manage")}
      </SettingRow>,
      flag("ttml_creator", "TTML Creator", "Add an editor button beside fullscreen in the playbar to write and time lyrics for the playing song.",
        "ttml creator maker editor sync timing word by word karaoke amll make lyrics"),
      settings.ttml_creator && <SettingRow key="auto_record" label="Auto Record"
        help="Ask to share Spotify audio when Lyssna Lyrics loads. Save songs and spectrograms on this device while sharing is active."
        keywords="automatic recording capture audio spectrogram startup">
        <Toggle label="Auto Record" checked={settings.auto_record} onChange={(auto_record) => {
          change({ auto_record });
          if (auto_record) onEnableAutoRecord?.();
        }} />
      </SettingRow>,
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
      flag("settings_remember_place", "Remember settings location", "Reopen Settings on the tab and at the place it was closed.", "tab location remember reopen"),
      settings.settings_allow_hiding && flag("settings_hide_buttons", "Show hide buttons", "Put a hide button beside each setting's name.", "hide hidden settings buttons eye"),
      settings.settings_allow_hiding && <SettingRow key="manage-hidden" label="Manage Hidden Settings" help="Restore settings hidden from the main window.">
        {submenuButton("hidden", "Manage")}
      </SettingRow>,
      <SettingRow key="misc" label={submenus.misc} keywords="canvas frame scrub freeze allow hiding settings sync preferences with other plugins">
        {submenuButton("misc", "Manage")}
      </SettingRow>,
    ]],
    ["Credits", "Credits and licences", [
      <SettingRow key="inter" label="Inter" help="Lyrics typeface by the Inter Project Authors. SIL Open Font License." />,
      <SettingRow key="metropolis" label="Metropolis" help="Interface typeface by Chris Simpson. Unlicense." />,
      <SettingRow key="adobe-blank" label="Adobe Blank 2" help="Detects missing characters in custom lyric fonts. SIL Open Font License." />,
      <SettingRow key="kawarp" label="Kawarp" help="Artwork ambience by Better Lyrics. MIT." />,
      <SettingRow key="lucide" label="Lucide" help="Interface icons by the Lucide contributors. ISC and MIT." />,
    ]],
  ];
  const hiddenRows = new Map<string, string>();
  for (const section of sections) {
    if (section[0] === "Advanced" || section[0] === "Credits") continue;
    section[2] = section[2].map((row) => {
      if (!isValidElement(row) || row.type !== SettingRow || row.key === null) return row;
      const setting = row as ReactElement<{ label: ReactNode; hideId?: string; children?: ReactNode }>;
      const id = String(row.key);
      if (hidden.has(id)) hiddenRows.set(id, typeof setting.props.label === "string" ? setting.props.label : id);
      const effect = quickEffects.find((option) => option.id === id);
      if (!effect) return cloneElement(setting, { hideId: id });
      const pins = settings.pinned_lyric_effects;
      const pinned = pins.includes(id);
      const title = `${pinned ? "Unpin" : "Pin"} ${effect.label} ${pinned ? "from" : "to"} the lyrics toolbar`;
      return cloneElement(setting, { hideId: id }, <>
        <button className="icon-button setting-pin" type="button" title={title}
          aria-label={`Pin ${effect.label} to the lyrics toolbar`} aria-pressed={pinned}
          onClick={() => change({ pinned_lyric_effects: pinned ? pins.filter((pin) => pin !== id) : [...pins, id] })}>
          <Pin size={14} />
        </button>
        {setting.props.children}
      </>);
    });
  }
  const hiddenSettings = settings.hidden_settings.map((id) => <SettingRow key={id} label={hiddenRows.get(id) ?? id.replaceAll("_", " ")}>
      <button type="button" className="pill outline" onClick={() => change({ hidden_settings: settings.hidden_settings.filter((item) => item !== id) })}>Show</button>
    </SettingRow>);

  const backdropClass = `modal-backdrop lyrics-settings-backdrop${settings.liquid_glass ? " liquid-glass" : ""}${settings.reduce_motion ? " reduce-motion" : ""}${tuning ? " lyssna-animator-backdrop" : ""}`;
  const content = <div className={backdropClass} data-theme={settings.theme} style={fonts}
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
          id={`lyssna-settings-tab-${label}`} aria-controls="lyssna-settings-content"
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
      <div className="lyrics-settings-scroll" ref={scroll} onScroll={(event) => {
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
        {submenu === "builds" && <div className="lyrics-settings-group">
          {(Object.keys(options.channels) as Channel[]).map((channel) => {
            const current = channel === options.channel && !clearHiddenBuild;
            return <SettingRow key={channel} label={channelLabels[channel]}
              help={options.channels[channel] ? `v${options.channels[channel]}` : "No build published."}>
              <button type="button" className="pill outline" disabled={switching || current || !options.channels[channel]}
                onClick={() => void runBuildAction(() => options.selectChannel(channel),
                  (message) => setNotice(message ? "Couldn’t load that build." : ""))}>
                {current ? "Current" : clearHiddenBuild ? "Switch and reload" : "Switch"}
              </button>
            </SettingRow>;
          })}
        </div>}
        {submenu === "hidden" && (hiddenSettings.length ? <div className="lyrics-settings-group">{hiddenSettings}</div>
          : <p className="settings-submenu-empty">No hidden settings.</p>)}
        {submenu === "misc" && <div className="lyrics-settings-group">
          <CanvasFrameSlider control={canvasFrame} />
          {flag("settings_allow_hiding", "Allow hiding settings", "Hide settings you never change. Restore them from Hidden settings.")}
          {flag("sync_other_plugin_preferences", "Sync preferences with other plugins", "Apply changes to compatible preferences from Legacy, Spicy Lyrics or Spotify+.")}
        </div>}
        {!submenu && <HiddenSettings.Provider value={hiding}><SettingsQuery.Provider value={query}>
          <div id="lyssna-settings-content" role={searching ? "region" : "tabpanel"}
            aria-label={searching ? "Search results" : undefined} aria-labelledby={searching ? undefined : `lyssna-settings-tab-${tab}`}>
            {sections.filter(([key]) => searching || key === tab).map(([key, title, rows]) => (
              <section key={`${key}-${title}`} className="lyrics-settings-section">
                <h3>{title}</h3><div className="lyrics-settings-group">{rows}</div>
              </section>
            ))}
            {(searching || tab === "Spotify Tweaks") && <EnhancementsSection notice={setNotice} />}
            <p className="lyrics-settings-empty">No settings match.</p>
          </div>
        </SettingsQuery.Provider></HiddenSettings.Provider>}
        {notice && <p className="settings-alert" role="status">{notice}</p>}
      </div>
    </section>}
  </div>;
  return tuning ? content : <dialog ref={modal} className="lyssna-settings-dialog" aria-labelledby="lyssna-settings-title"
    onCancel={(event) => {
      event.preventDefault();
      if (submenu) back();
      else close();
    }}>{content}</dialog>;
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
