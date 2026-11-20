import { cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { AlignLeft, AppWindow, ChevronDown, ChevronRight, ChevronUp, FileText, FlaskConical, LibraryBig, Palette, Search, Settings2, Wrench, X } from "lucide-react";
import { AnimatorPanel } from "./lyssna/animator-settings";
import { FontSettings, useAppFonts } from "./lyssna/custom-fonts";
import { HiddenSettings, SettingRow, SettingsQuery, Toggle } from "./lyssna/setting-row";
import { visualRows } from "./lyssna/visual-settings";
import { downloadTtml, listLocalLyrics, lyricsChanged, removeLocalLyrics } from "./local-lyrics";
import { lyricSources, orderedSources, refreshLyrics } from "./lyric-sources";
import { defaults, type Settings } from "./settings";
import { exportSettings, importSettings } from "./settings-transfer";
import type { TransferLyrics } from "./lyssna/transfer-format";
import { pictureInPicture } from "./popout";

export type Channel = "stable" | "beta" | "canary";
export const channelLabels: Record<Channel, string> = { stable: "Stable", beta: "Beta", canary: "Canary" };
export type BuildOptions = {
  channel: Channel;
  channels: Record<Channel, string | null>;
  selectChannel: (channel: Channel) => Promise<void>;
};

const tabs = [
  ["General", Settings2], ["Appearance", Palette], ["Library", LibraryBig], ["Lyrics", AlignLeft],
  ["Effects", FlaskConical], ["Layout", AppWindow], ["Sources", FileText], ["Advanced", Wrench],
] as const;
type Tab = (typeof tabs)[number][0] | "About";
type Section = [Tab, string, ReactNode[]];
const placeKey = "lyssna-lyrics.settings-place";

function readPlace(remember: boolean): { tab: Tab; scroll: number } {
  try {
    const place = remember && JSON.parse(localStorage.getItem(placeKey) ?? "null");
    if (place && (place.tab === "About" || tabs.some(([label]) => label === place.tab)) && Number.isFinite(place.scroll)) return place;
  } catch { /* Start at General if settings storage is unavailable. */ }
  return { tab: "General", scroll: 0 };
}

function writePlace(tab: Tab, scroll: number) {
  try { localStorage.setItem(placeKey, JSON.stringify({ tab, scroll })); } catch { /* Navigation still works. */ }
}

function LyricsLibrary({ notice }: { notice: (message: string) => void }) {
  const [entries, setEntries] = useState<TransferLyrics[]>();
  useEffect(() => {
    let active = true;
    const update = () => { void listLocalLyrics().then((items) => { if (active) setEntries(items); }).catch(() => {
      if (active) setEntries([]);
    }); };
    window.addEventListener(lyricsChanged, update);
    update();
    return () => { active = false; window.removeEventListener(lyricsChanged, update); };
  }, []);
  return <SettingRow stacked label="Browse TTML Database" help="Download and manage your imported lyrics." keywords="saved local lyrics database">
    {entries?.length ? <ul className="lyric-sources">{entries.map((entry) => <li key={entry.uri}>
      <span className="lyric-source-name"><strong>{entry.name || entry.uri}</strong>{entry.artists && <small>{entry.artists}</small>}</span>
      <button type="button" className="pill outline" onClick={() => downloadTtml(entry)}>Download</button>
      <button type="button" className="pill outline" onClick={() => {
        void removeLocalLyrics(entry.uri).then(() => notice("Removed saved lyrics."), () => notice("Could not remove saved lyrics."));
      }}>Remove</button>
    </li>)}</ul> : <p className="setting-help">{entries ? "No imported lyrics." : "Loading saved lyrics…"}</p>}
  </SettingRow>;
}

export function SettingsPanel({ settings, change, close, options, trackId, importTtml, notice, setNotice }: {
  settings: Settings;
  change: (patch: Partial<Settings>) => void;
  close: () => void;
  options: BuildOptions;
  trackId?: string;
  importTtml: () => void;
  notice: string;
  setNotice: (message: string) => void;
}) {
  const [initial] = useState(() => readPlace(settings.settings_remember_place));
  const [tab, setTab] = useState(initial.tab);
  const [query, setQuery] = useState("");
  const [tuning, setTuning] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [marker, setMarker] = useState<{ left: number; width: number }>();
  const scroll = useRef<HTMLDivElement>(null);
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const transferInput = useRef<HTMLInputElement>(null);
  const searching = !!query.trim();
  const about = tab === "About" && !searching;
  const visuals = visualRows(settings, change, () => setTuning(true));
  const fonts = useAppFonts(settings);
  const { flag, range } = visuals;
  const order = orderedSources(settings.lyrics_source_order);
  const version = options.channels[options.channel];
  const hidden = new Set(settings.hidden_settings);
  const hiding = {
    allow: settings.settings_allow_hiding,
    buttons: settings.settings_hide_buttons,
    hidden,
    hide: (id: string) => change({ hidden_settings: [...new Set([...hidden, id])] }),
  };

  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollTop = initial.scroll;
  }, [initial]);
  useLayoutEffect(() => {
    const button = tabButtons.current[tabs.findIndex(([label]) => label === tab)];
    const list = button?.parentElement;
    if (!button || !list || tuning) return;
    function measure() {
      if (button) setMarker({ left: button.offsetLeft, width: button.offsetWidth });
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [tab, tuning]);

  function select(tab: Tab) {
    setTab(tab);
    setQuery("");
    setNotice("");
    scroll.current?.scrollTo({ top: 0 });
    if (settings.settings_remember_place) writePlace(tab, 0);
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
  const sections: Section[] = [
    ["General", "Storage", [
      <SettingRow key="lyrics-cache" label="Lyrics cache" help="Clear lyrics cached by Lyssna. Imported lyrics are kept." keywords="lyrics cache clear refresh">
        <button type="button" className="pill outline" onClick={() => {
          refreshLyrics(undefined, "all");
          setNotice("Lyssna lyric cache cleared.");
        }}>Clear lyrics</button>
      </SettingRow>,
    ]],
    ["Appearance", "Theme", [
      <SettingRow key="theme" label="Theme" help="Light or dark, or match the system. Lyrics and artwork stay dark." keywords="theme light dark colour">
        <select className="settings-select" aria-label="Theme" value={settings.theme} onChange={(event) => change({ theme: event.target.value as Settings["theme"] })}>
          <option value="dark">Dark</option><option value="light">Light</option><option value="system">Match system</option>
        </select>
      </SettingRow>,
      flag("liquid_glass", "Liquid Glass", "Frosted, translucent panels that pick up colour from the artwork you're playing.", "theme glass blur translucent"),
      flag("reduce_motion", "Reduce motion", "Turn off animated backgrounds and word animations.", "animation accessibility"),
      flag("animation_fps_cap_enabled", "Limit animation frame rate", "Cap how often lyrics, scrolling and the moving background redraw, to save power.", "fps frame rate"),
      range("animation_fps_cap", "Animation frame rate", "The most frames per second animations draw while the limit is on.",
        "fps frame rate", [15, 240, 5], 60, " fps", !settings.animation_fps_cap_enabled),
    ]],
    ["Appearance", "Font", [<FontSettings key="app-font" field="ui_font" settings={settings} onSettings={change} onNotice={setNotice} />]],
    ["Library", "Your lyrics", [<LyricsLibrary key="ttml-library" notice={setNotice} />]],
    ["Lyrics", "Look", [visuals.Look[0], <FontSettings key="lyric-font" field="lyric_font" settings={settings} onSettings={change} onNotice={setNotice} />, ...visuals.Look.slice(1)]],
    ["Lyrics", "Display", [
      flag("lyrics_discord_usernames", "Discord usernames in credits", "Use Discord usernames when supplied with community lyric credits.", "credits contributor"),
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
    ["Effects", "Lyric effects", visuals.Effects],
    ["Layout", "Lyrics layout", [
      flag("cinema_lyrics", "Enable lyrics pop-out", "Show a toolbar button that opens lyrics in a floating window.",
        "cinema window external popup", pictureInPicture ? undefined : "This Spotify client does not support Picture-in-Picture windows."),
      ...visuals.Layout,
    ]],
    ["Sources", "Lyric sources", [
      <SettingRow key="source-order" stacked label="Lyric sources" help="Tried top to bottom until one has lyrics for the song." keywords="sources priority order">
        <ol className="lyric-sources">{order.map((id, index) => {
          const source = lyricSources[id];
          const move = (step: number) => {
            const next = [...order];
            [next[index], next[index + step]] = [next[index + step], next[index]];
            change({ lyrics_source_order: next });
          };
          return <li key={id} className={settings.lyrics_sources_disabled.includes(id) ? "off" : undefined}>
            <span className="lyric-source-name"><strong>{source.name}</strong><small>{source.help}</small></span>
            <button type="button" className="icon-button" aria-label={`Move ${source.name} up`} disabled={index === 0} onClick={() => move(-1)}><ChevronUp size={16} /></button>
            <button type="button" className="icon-button" aria-label={`Move ${source.name} down`} disabled={index === order.length - 1} onClick={() => move(1)}><ChevronDown size={16} /></button>
            <Toggle label={source.name} checked={!settings.lyrics_sources_disabled.includes(id)} onChange={(on) => change({
              lyrics_sources_disabled: on ? settings.lyrics_sources_disabled.filter((item) => item !== id) : [...settings.lyrics_sources_disabled, id],
            })} />
          </li>;
        })}</ol>
        <button type="button" className="text-link lyric-sources-reset" onClick={() => change({
          lyrics_sources_disabled: defaults.lyrics_sources_disabled, lyrics_source_order: defaults.lyrics_source_order,
        })}>Reset sources</button>
      </SettingRow>,
    ]],
    ["Sources", "Source options", [
      flag("lyrics_prefer_apple", "Prioritize Apple Music quality", "Use Apple Music's timed lyrics when Spicy Lyrics has them, ahead of other online sources.", "apple music quality priority source"),
    ]],
    ["Sources", "Your lyrics", [
      <SettingRow key="load-ttml" label="Load TTML" help="Use your own lyrics file for the playing song." keywords="import file" unavailable={emptyTrack}>
        <button type="button" className="pill outline" onClick={importTtml}>Load</button>
      </SettingRow>,
      flag("lyrics_cache_button", "Lyrics cache button", "Show the refresh button in the lyrics toolbar.", "cache refresh button toolbar clear reload"),
      <SettingRow key="cache-action" label="Lyrics cache button action" help="Choose what the toolbar refresh does to Lyssna's cache.">
        <select className="settings-select" aria-label="Lyrics cache button action" value={settings.lyrics_cache_action} onChange={(event) => change({ lyrics_cache_action: event.target.value as Settings["lyrics_cache_action"] })}>
          <option value="song">Clear current song</option><option value="reload">Reload current song</option><option value="all">Clear all saved lyrics</option>
        </select>
      </SettingRow>,
    ]],
    ["Advanced", "Builds", [
      <SettingRow key="channel" label="Build channel" keywords="version canary stable beta">
        <select className="settings-select" aria-label="Build channel" value={options.channel} disabled={switching} onChange={(event) => void selectChannel(event.target.value as Channel)}>
          {(Object.keys(options.channels) as Channel[]).map((channel) => <option key={channel} value={channel} disabled={!options.channels[channel]}>
            {channelLabels[channel]}{options.channels[channel] ? "" : " (no build)"}
          </option>)}
        </select>
      </SettingRow>,
    ]],
    ["Advanced", "Settings window", [
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
      flag("settings_allow_hiding", "Allow hiding settings", "Hide settings you never change. Restore them from Hidden settings.", "hide manage"),
      settings.settings_allow_hiding && flag("settings_hide_buttons", "Show hide buttons", "Put a hide button beside each setting's name.", "hide hidden settings buttons eye"),
    ]],
  ];
  const hiddenRows = new Map<string, string>();
  for (const section of sections) {
    if (section[0] === "Advanced") continue;
    section[2] = section[2].map((row) => {
      if (!isValidElement(row) || row.type !== SettingRow || row.key === null) return row;
      const setting = row as ReactElement<{ label: ReactNode; hideId?: string }>;
      const id = String(row.key);
      if (hidden.has(id)) hiddenRows.set(id, typeof setting.props.label === "string" ? setting.props.label : id);
      return cloneElement(setting, { hideId: id });
    });
  }
  if (hiding.allow) sections.push(["Advanced", "Hidden settings", hidden.size
    ? settings.hidden_settings.map((id) => <SettingRow key={id} label={hiddenRows.get(id) ?? id.replaceAll("_", " ")}>
      <button type="button" className="pill outline" onClick={() => change({ hidden_settings: settings.hidden_settings.filter((item) => item !== id) })}>Show</button>
    </SettingRow>)
    : [<SettingRow key="empty" label="No hidden settings" help="Use the hide button beside a setting's name to hide it." />]]);

  const backdropClass = `modal-backdrop lyrics-settings-backdrop${settings.liquid_glass ? " liquid-glass" : ""}${settings.reduce_motion ? " reduce-motion" : ""}${tuning ? " lyssna-animator-backdrop" : ""}`;
  return <div className={backdropClass} data-theme={settings.theme} style={fonts}
    onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    {tuning ? <AnimatorPanel animator={settings.lyrics_animator} onChange={(lyrics_animator) => change({ lyrics_animator })}
      onBack={() => setTuning(false)} onClose={close} /> : <section className="lyrics-settings" role="dialog" aria-modal="true" aria-labelledby="lyssna-settings-title">
      <header className="lyrics-settings-head">
        <h2 id="lyssna-settings-title"><Settings2 size={20} />Lyssna settings</h2>
        <label className="lyrics-settings-search"><Search size={15} /><input aria-label="Search settings" placeholder="Search" value={query}
          onChange={(event) => { setQuery(event.target.value); scroll.current?.scrollTo({ top: 0 }); }} /></label>
        <button type="button" className="icon-button" aria-label="Close settings" onClick={close}><X size={18} /></button>
      </header>
      <div className="lyrics-settings-tabs" role="tablist" aria-label="Settings categories">
        <span className="lyrics-settings-marker" aria-hidden="true" style={marker && !searching && !about
          ? { opacity: 1, transform: `translateX(${marker.left}px)`, width: marker.width } : { opacity: 0 }} />
        {tabs.map(([label, Icon], index) => <button type="button" key={label} ref={(element) => { tabButtons.current[index] = element; }}
          role="tab" aria-selected={tab === label && !searching} className={tab === label && !searching ? "active" : ""}
          onClick={() => select(label)} onKeyDown={(event) => {
            const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
            if (!step) return;
            event.preventDefault();
            const next = (index + step + tabs.length) % tabs.length;
            select(tabs[next][0]);
            tabButtons.current[next]?.focus();
          }}><Icon size={16} />{label}</button>)}
      </div>
      <div className="lyrics-settings-scroll" ref={scroll} onScroll={(event) => {
        if (!searching && settings.settings_remember_place) writePlace(tab, event.currentTarget.scrollTop);
      }}>
        <HiddenSettings.Provider value={hiding}><SettingsQuery.Provider value={query}>
          <div role="tabpanel">
            {about ? <section className="lyrics-settings-section"><h3>Credits and licences</h3><div className="lyrics-settings-group">
              <SettingRow label="Inter" help="Lyrics typeface by the Inter Project Authors. SIL Open Font License." />
              <SettingRow label="Metropolis" help="Interface typeface by Chris Simpson. Unlicense." />
              <SettingRow label="Kawarp" help="Artwork ambience by Better Lyrics. MIT." />
              <SettingRow label="Lucide" help="Interface icons by the Lucide contributors. ISC and MIT." />
            </div></section> : sections.filter(([key]) => searching || key === tab).map(([key, title, rows]) => (
              <section key={`${key}-${title}`} className="lyrics-settings-section">
                <h3>{title}</h3><div className="lyrics-settings-group">{rows}</div>
              </section>
            ))}
            <p className="lyrics-settings-empty">No settings match.</p>
          </div>
        </SettingsQuery.Provider></HiddenSettings.Provider>
        {notice && <p className="settings-alert" role="status">{notice}</p>}
        <footer className="lyrics-settings-footer">
          <button type="button" className="lyrics-settings-about-link" aria-pressed={about} onClick={() => select(about ? "General" : "About")}>
            <span className="lyrics-settings-wordmark">Lyssna</span>
            {version && <span className="lyrics-settings-version">v{version}</span>}
            <span className="lyrics-settings-about-hint">{about ? "Back to settings" : "About and credits"}<ChevronRight size={14} /></span>
          </button>
          <span className="lyrics-settings-build">{channelLabels[options.channel]} build</span>
        </footer>
      </div>
    </section>}
  </div>;
}

function boundedOffset(value: number) {
  return Math.max(-10_000, Math.min(10_000, value || 0));
}
