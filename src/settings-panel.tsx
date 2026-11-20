import { cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { AlignLeft, AppWindow, ChevronLeft, FileText, FlaskConical, Info, Palette, Search, Settings2, WandSparkles, Wrench, X } from "lucide-react";
import EnhancementsSection from "./enhancements/section";
import { AnimatorPanel } from "./lyssna/animator-settings";
import { FontSettings, useAppFonts } from "./lyssna/custom-fonts";
import { HiddenSettings, SettingRow, SettingsQuery, Toggle } from "./lyssna/setting-row";
import { visualRows } from "./lyssna/visual-settings";
import { lyricSources, refreshLyrics } from "./lyric-sources";
import type { Settings } from "./settings";
import { LyricsLibrary, SourcesManager } from "./settings-library";
import { exportSettings, importSettings } from "./settings-transfer";
import { pictureInPicture } from "./popout";

export type Channel = "stable" | "beta" | "canary";
export const channelLabels: Record<Channel, string> = { stable: "Stable", beta: "Beta", canary: "Canary" };
export type BuildOptions = {
  channel: Channel;
  channels: Record<Channel, string | null>;
  selectChannel: (channel: Channel) => Promise<void>;
};

const tabs = [
  ["Appearance", Palette], ["Lyrics", AlignLeft], ["Effects", FlaskConical], ["Layout", AppWindow], ["Enhancements", WandSparkles],
  ["Sources", FileText], ["Advanced", Wrench], ["Credits", Info],
] as const;
type Tab = (typeof tabs)[number][0];
type Section = [Tab, string, ReactNode[]];
const placeKey = "lyssna-lyrics.settings-place";
const submenus = {
  sources: "Manage Sources",
  library: "TTML Database",
  builds: "Build Channels",
  hidden: "Hidden Settings",
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
const appearanceRows = ["background", "lyrics_background_blur", "pinned-footer", "npv_ambience", "glass_seek", "canvas_lyrics", "animated-covers", "cover_animation"];

function visualRowKey(row: ReactNode) {
  return isValidElement(row) && row.key !== null ? String(row.key) : "";
}

export function SettingsPanel({ settings, change, close, options, trackId, importTtml, notice, setNotice, view = window, developerMode }: {
  settings: Settings;
  change: (patch: Partial<Settings>) => void;
  close: () => void;
  options: BuildOptions;
  trackId?: string;
  importTtml: () => void;
  notice: string;
  setNotice: (message: string) => void;
  view?: Window;
  developerMode?: boolean;
}) {
  const [initial] = useState(() => readPlace(settings.settings_remember_place));
  const [tab, setTab] = useState(initial.tab);
  const [submenu, setSubmenu] = useState(initial.submenu);
  const [query, setQuery] = useState("");
  const [tuning, setTuning] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [marker, setMarker] = useState<{ left: number; width: number }>();
  const scroll = useRef<HTMLDivElement>(null);
  const mainScroll = useRef(initial.scroll);
  const submenuScroll = useRef(initial.submenuScroll ?? 0);
  const backButton = useRef<HTMLButtonElement>(null);
  const openedFrom = useRef<Submenu>(undefined);
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const transferInput = useRef<HTMLInputElement>(null);
  const searching = !!query.trim();
  const visuals = visualRows(settings, change, () => setTuning(true));
  const fonts = useAppFonts(settings, view.document);
  const { flag, range } = visuals;
  const version = options.channels[options.channel];
  const hidden = new Set(settings.hidden_settings);
  const hiding = {
    allow: settings.settings_allow_hiding,
    buttons: settings.settings_hide_buttons,
    hidden,
    hide: (id: string) => change({ hidden_settings: [...new Set([...hidden, id])] }),
  };

  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollTop = submenu ? submenuScroll.current : mainScroll.current;
    if (submenu) backButton.current?.focus({ preventScroll: true });
    else if (openedFrom.current) {
      view.document.getElementById(`lyssna-open-${openedFrom.current}`)?.focus({ preventScroll: true });
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

  async function selectChannel(channel: Channel) {
    setSwitching(true);
    try {
      await options.selectChannel(channel);
    } catch {
      setNotice("Couldn’t load that build.");
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
    ["Appearance", "Appearance", [
      flag("liquid_glass", "Liquid Glass", "Use translucent glass for settings, source management, and the TTML database.", "theme glass blur translucent"),
      ...appearanceRows.map((key) => visualRowsByKey.get(key)),
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
    ["Appearance", "Fonts", [
      <FontSettings key="lyric-font" field="lyric_font" settings={settings} onSettings={change} onNotice={setNotice} />,
      <FontSettings key="app-font" field="ui_font" settings={settings} onSettings={change} onNotice={setNotice} />,
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
        <input className="number-field" aria-label="Global offset in milliseconds" type="number" min={-10000} max={10000} step={50}
          value={settings.lyric_offset_ms} onChange={(event) => change({ lyric_offset_ms: boundedOffset(event.target.valueAsNumber) })} />
      </SettingRow>,
      <SettingRow key="song-offset" label="This song's offset" help="Added to the global lyric timing offset." unavailable={emptyTrack}>
        <input className="number-field" aria-label="Song offset in milliseconds" type="number" min={-10000} max={10000} step={50} value={offset}
          onChange={(event) => {
            if (trackId) change({ lyric_song_offsets: { ...settings.lyric_song_offsets, [trackId]: boundedOffset(event.target.valueAsNumber) } });
          }} />
      </SettingRow>,
      ...visuals.Display,
    ]],
    ["Layout", "Lyrics layout", [
      flag("cinema_lyrics", "Enable lyrics pop-out", "Show the Picture-in-Picture button in the playbar.",
        "cinema window external popup", pictureInPicture ? undefined : "This Spotify client does not support Picture-in-Picture windows."),
      flag("cinema_window", "Enable Cinema Lyrics Window", developerMode === true
        ? "Add a playbar button that opens the full lyrics view in a separate window."
        : "Add a separate cinema window to the playbar. Enable Spotify DevTools with spicetify enable-devtools.",
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
      <SettingRow key="load-ttml" label="Load TTML" help="Use your own lyrics file for the playing song." keywords="import file" unavailable={emptyTrack}>
        <button type="button" className="pill outline" onClick={importTtml}>Load</button>
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
            refreshLyrics(trackId, "song");
            setNotice("Cleared the current song’s cache.");
          }}>Clear Current Song</button>
          <button type="button" className="pill outline" onClick={() => {
            refreshLyrics(undefined, "all");
            setNotice("Lyssna lyric cache cleared.");
          }}>Clear Cache</button>
        </div>
      </SettingRow>,
    ]],
    ["Advanced", "Advanced", [
      <SettingRow key="channel" label="Build Channel" help={`${channelLabels[options.channel]}${version ? ` · v${version}` : ""}`} keywords="version canary stable beta">
        {submenuButton("builds", "Manage")}
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
      flag("sync_other_plugin_preferences", "Sync preferences with other plugins", "Apply changes to compatible preferences from Legacy, Spicy Lyrics or Spotify+."),
      flag("settings_allow_hiding", "Allow hiding settings", "Hide settings you never change. Restore them from Hidden settings.", "hide manage"),
      settings.settings_allow_hiding && flag("settings_hide_buttons", "Show hide buttons", "Put a hide button beside each setting's name.", "hide hidden settings buttons eye"),
      settings.settings_allow_hiding && <SettingRow key="manage-hidden" label="Manage Hidden Settings" help="Restore settings hidden from the main window.">
        {submenuButton("hidden", "Manage")}
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
      const setting = row as ReactElement<{ label: ReactNode; hideId?: string }>;
      const id = String(row.key);
      if (hidden.has(id)) hiddenRows.set(id, typeof setting.props.label === "string" ? setting.props.label : id);
      return cloneElement(setting, { hideId: id });
    });
  }
  const hiddenSettings = settings.hidden_settings.map((id) => <SettingRow key={id} label={hiddenRows.get(id) ?? id.replaceAll("_", " ")}>
      <button type="button" className="pill outline" onClick={() => change({ hidden_settings: settings.hidden_settings.filter((item) => item !== id) })}>Show</button>
    </SettingRow>);

  const backdropClass = `modal-backdrop lyrics-settings-backdrop${settings.liquid_glass ? " liquid-glass" : ""}${settings.reduce_motion ? " reduce-motion" : ""}${tuning ? " lyssna-animator-backdrop" : ""}`;
  return <div className={backdropClass} data-theme={settings.theme} style={fonts}
    onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    {tuning ? <AnimatorPanel animator={settings.lyrics_animator} onChange={(lyrics_animator) => change({ lyrics_animator })}
      onBack={() => setTuning(false)} onClose={close} /> : <section className={`lyrics-settings plugin-settings${submenu ? " plugin-settings-submenu" : ""}`}
        role="dialog" aria-modal="true" aria-labelledby="lyssna-settings-title">
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
        {submenu === "builds" && <div className="lyrics-settings-group">
          {(Object.keys(options.channels) as Channel[]).map((channel) => <SettingRow key={channel} label={channelLabels[channel]}
            help={options.channels[channel] ? `v${options.channels[channel]}` : "No build published."}>
            <button type="button" className="pill outline" disabled={switching || channel === options.channel || !options.channels[channel]}
              onClick={() => void selectChannel(channel)}>{channel === options.channel ? "Current" : "Switch"}</button>
          </SettingRow>)}
        </div>}
        {submenu === "hidden" && (hiddenSettings.length ? <div className="lyrics-settings-group">{hiddenSettings}</div>
          : <p className="settings-submenu-empty">No hidden settings.</p>)}
        {!submenu && <HiddenSettings.Provider value={hiding}><SettingsQuery.Provider value={query}>
          <div id="lyssna-settings-content" role={searching ? "region" : "tabpanel"}
            aria-label={searching ? "Search results" : undefined} aria-labelledby={searching ? undefined : `lyssna-settings-tab-${tab}`}>
            {sections.filter(([key]) => searching || key === tab).map(([key, title, rows]) => (
              <section key={`${key}-${title}`} className="lyrics-settings-section">
                <h3>{title}</h3><div className="lyrics-settings-group">{rows}</div>
              </section>
            ))}
            {(searching || tab === "Enhancements") && <EnhancementsSection notice={setNotice} />}
            <p className="lyrics-settings-empty">No settings match.</p>
          </div>
        </SettingsQuery.Provider></HiddenSettings.Provider>}
        {notice && <p className="settings-alert" role="status">{notice}</p>}
      </div>
    </section>}
  </div>;
}

function boundedOffset(value: number) {
  return Math.max(-10_000, Math.min(10_000, value || 0));
}
