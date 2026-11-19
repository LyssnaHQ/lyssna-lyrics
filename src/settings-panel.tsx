import { useState, type CSSProperties } from "react";
import { MicVocal, Search, Settings2, SlidersHorizontal, X } from "lucide-react";
import { AnimatorPanel } from "./lyssna/animator-settings";
import { SettingRow, SettingsQuery, Toggle } from "./lyssna/setting-row";
import { visualRows } from "./lyssna/visual-settings";
import type { Settings } from "./settings";

export type Channel = "stable" | "beta" | "canary";
export const channelLabels: Record<Channel, string> = { stable: "Stable", beta: "Beta", canary: "Canary" };
export type BuildOptions = {
  channel: Channel;
  channels: Record<Channel, string | null>;
  selectChannel: (channel: Channel) => Promise<void>;
};

export function SettingsPanel({ settings, change, close, options, trackId }: {
  settings: Settings;
  change: (patch: Partial<Settings>) => void;
  close: () => void;
  options: BuildOptions;
  trackId?: string;
}) {
  const [tab, setTab] = useState<"Lyrics" | "Effects" | "Layout" | "Advanced">("Lyrics");
  const [query, setQuery] = useState("");
  const [tuning, setTuning] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState(false);
  const offset = (trackId && settings.lyric_song_offsets[trackId]) || 0;
  const visuals = visualRows(settings, change, () => setTuning(true));

  async function select(channel: Channel) {
    setSwitching(true);
    try {
      await options.selectChannel(channel);
    } catch {
      setError(true);
    } finally {
      setSwitching(false);
    }
  }

  if (tuning) return <AnimatorPanel animator={settings.lyrics_animator}
    onChange={(lyrics_animator) => change({ lyrics_animator })}
    onBack={() => setTuning(false)} onClose={close} />;

  return <div className="modal-backdrop lyrics-settings-backdrop" onClick={close}>
    <section className="lyrics-settings" role="dialog" aria-modal="true" aria-label="Lyssna settings"
      onClick={(event) => event.stopPropagation()}>
      <header className="lyrics-settings-head">
        <h2><Settings2 size={20} />Lyssna settings</h2>
        <label className="lyrics-settings-search"><Search size={15} />
          <input aria-label="Search settings" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button type="button" className="icon-button" aria-label="Close settings" onClick={close}><X size={18} /></button>
      </header>
      <div className="lyrics-settings-tabs" role="tablist" aria-label="Settings categories">
        {(["Lyrics", "Effects", "Layout", "Advanced"] as const).map((name) => <button type="button" role="tab" aria-selected={!query && tab === name}
          className={!query && tab === name ? "active" : ""} key={name} onClick={() => { setTab(name); setQuery(""); }}>
          {name === "Lyrics" ? <MicVocal size={16} /> : <SlidersHorizontal size={16} />}{name}
        </button>)}
      </div>
      <div className="lyrics-settings-scroll">
        <SettingsQuery.Provider value={query}>
          {(query || tab === "Lyrics") && <section className="lyrics-settings-section">
            <h3>Lyrics</h3>
            <div className="lyrics-settings-group">
              <SettingRow label="Lyric font" keywords="typeface family">
                <input className="number-field" aria-label="Lyric font" placeholder="Default" value={settings.lyric_font}
                  onChange={(event) => change({ lyric_font: event.target.value })} />
              </SettingRow>
              <SettingRow label="Lyric timing offset" help="Adjust when lyrics appear. Positive values show them earlier." keywords="timing delay">
                <input className="number-field" aria-label="Global offset in milliseconds" type="number" min={-10000} max={10000} step={50} value={settings.lyric_offset_ms}
                  onChange={(event) => change({ lyric_offset_ms: Math.max(-10000, Math.min(10000, event.target.valueAsNumber || 0)) })} />
              </SettingRow>
              {trackId && <SettingRow label="This song's offset" help="Added to the global lyric timing offset.">
                <input className="number-field" aria-label="Song offset in milliseconds" type="number" min={-10000} max={10000} step={50} value={offset}
                  onChange={(event) => change({ lyric_song_offsets: { ...settings.lyric_song_offsets,
                    [trackId]: Math.max(-10000, Math.min(10000, event.target.valueAsNumber || 0)) } })} />
              </SettingRow>}
              {visuals.Look}
              {visuals.Display}
            </div>
          </section>}
          {(query || tab === "Effects") && <section className="lyrics-settings-section">
            <h3>Lyric effects</h3>
            <div className="lyrics-settings-group">{visuals.Effects}</div>
          </section>}
          {(query || tab === "Layout") && <section className="lyrics-settings-section">
            <h3>Lyrics layout</h3>
            <div className="lyrics-settings-group">
              {visuals.Layout}
              <SettingRow label="Animate closing full screen" help="Slide the lyrics away before full screen closes.">
                <Toggle label="Animate closing full screen" checked={settings.fullscreen_animate_close} onChange={(fullscreen_animate_close) => change({ fullscreen_animate_close })} />
              </SettingRow>
              <SettingRow label="Glass seek bar" help="Give the full screen seek bar a frosted glass track and a glowing fill.">
                <Toggle label="Glass seek bar" checked={settings.glass_seek} onChange={(glass_seek) => change({ glass_seek })} />
              </SettingRow>
              <SettingRow label="Cover art animation" help="Crossfade the artwork beside the lyrics when the song changes.">
                <Toggle label="Cover art animation" checked={settings.cover_animation} onChange={(cover_animation) => change({ cover_animation })} />
              </SettingRow>
              <SettingRow label="Canvas in lyrics" help="Play the track’s Canvas video when Spotify makes it available in Now playing.">
                <Toggle label="Canvas in lyrics" checked={settings.canvas_lyrics} onChange={(canvas_lyrics) => change({ canvas_lyrics })} />
              </SettingRow>
            </div>
          </section>}
          {(query || tab === "Advanced") && <section className="lyrics-settings-section">
            <h3>Advanced</h3>
            <div className="lyrics-settings-group">
              <SettingRow label="Reduce motion" help="Use still backgrounds and reduce lyric animation.">
                <Toggle label="Reduce motion" checked={settings.reduce_motion} onChange={(reduce_motion) => change({ reduce_motion })} />
              </SettingRow>
              <SettingRow label="Animation frame rate cap" help="Limit how often the lyrics and effects update.">
                <Toggle label="Animation frame rate cap" checked={settings.animation_fps_cap_enabled}
                  onChange={(animation_fps_cap_enabled) => change({ animation_fps_cap_enabled })} />
              </SettingRow>
              {settings.animation_fps_cap_enabled && <SettingRow label="Animation frame rate">
                <span className="settings-range"><input aria-label="Animation frame rate" type="range" min={15} max={240} step={1}
                  style={{ "--fill": `${(settings.animation_fps_cap - 15) / 225 * 100}%` } as CSSProperties}
                  value={settings.animation_fps_cap} onChange={(event) => change({ animation_fps_cap: event.target.valueAsNumber })} />
                  <output>{settings.animation_fps_cap} FPS</output></span>
              </SettingRow>}
              <SettingRow label="Build channel">
                <select className="settings-select" aria-label="Build channel" value={options.channel} disabled={switching}
                  onChange={(event) => void select(event.target.value as Channel)}>
                  {(Object.keys(options.channels) as Channel[]).map((channel) => <option key={channel} value={channel} disabled={!options.channels[channel]}>
                    {channelLabels[channel]}{options.channels[channel] ? "" : " (no build)"}
                  </option>)}
                </select>
                {error && <span role="alert">Couldn’t load that build.</span>}
              </SettingRow>
            </div>
          </section>}
        </SettingsQuery.Provider>
      </div>
      <footer className="lyrics-settings-footer"><span className="lyrics-settings-wordmark">Lyssna</span>
        <span className="lyrics-settings-build">{options.channels[options.channel]}</span></footer>
    </section>
  </div>;
}
