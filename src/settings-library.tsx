import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown } from "lucide-react";
import { downloadTtml, listLocalLyrics, lyricsChanged, removeLocalLyrics } from "./local-lyrics";
import { lyricSources, orderedSources } from "./lyric-sources";
import { SettingRow, Toggle } from "./lyssna/setting-row";
import type { TransferLyrics } from "./lyssna/transfer-format";
import { defaults, type Settings } from "./settings";

export function SourcesManager({ settings, change }: {
  settings: Settings;
  change: (patch: Partial<Settings>) => void;
}) {
  const [appleOptions, setAppleOptions] = useState(false);
  const order = orderedSources(settings.lyrics_source_order);
  return <div className="settings-source-manager">
    <ol className="settings-source-cards" aria-label="Lyric source priority">{order.map((id, index) => {
      const { name, help } = lyricSources[id];
      const enabled = !settings.lyrics_sources_disabled.includes(id);
      const configurable = id === "apple";
      function move(step: number) {
        const next = [...order];
        [next[index], next[index + step]] = [next[index + step], next[index]];
        change({ lyrics_source_order: next });
      }
      return <li key={id} className="settings-source-entry" data-disclosed={configurable && appleOptions || undefined}>
        <div className="settings-source-card" data-disabled={!enabled || undefined}>
          <span className="settings-source-rank" aria-hidden="true">{index + 1}</span>
          <span className="settings-source-summary"><strong>{name}</strong><span>{help}</span></span>
          <div className="settings-source-actions">
            {configurable && <button type="button" className="icon-button settings-source-expander"
              aria-label="Apple Music options" title="Apple Music options" aria-expanded={appleOptions}
              aria-controls="lyssna-source-apple-options" onClick={() => setAppleOptions(!appleOptions)}>
              <ChevronDown size={16} />
            </button>}
            <button type="button" className="icon-button" aria-label={`Move ${name} up`} title="Move up"
              disabled={index <= 2} onClick={() => move(-1)}><ArrowUp size={16} /></button>
            <button type="button" className="icon-button" aria-label={`Move ${name} down`} title="Move down"
              disabled={index < 2 || index === order.length - 1} onClick={() => move(1)}><ArrowDown size={16} /></button>
            <Toggle label={name} checked={enabled} onChange={(on) => change({
              lyrics_sources_disabled: on ? settings.lyrics_sources_disabled.filter((item) => item !== id) : [...settings.lyrics_sources_disabled, id],
            })} />
          </div>
        </div>
        {configurable && <div className="settings-source-options" id="lyssna-source-apple-options" hidden={!appleOptions}>
          <SettingRow label="Prioritize Apple Music quality" help="Prefer Apple Music timing among the fallback sources.">
            <Toggle label="Prioritize Apple Music quality" checked={settings.lyrics_prefer_apple}
              onChange={(lyrics_prefer_apple) => change({ lyrics_prefer_apple })} />
          </SettingRow>
        </div>}
      </li>;
    })}</ol>
    <footer className="settings-source-footer">
      <span className="settings-source-summary"><strong>Source priority</strong><span>Lyssna uses the first available source. Disabled sources are skipped.</span></span>
      <button type="button" className="pill outline" onClick={() => change({
        lyrics_sources_disabled: defaults.lyrics_sources_disabled,
        lyrics_source_order: defaults.lyrics_source_order,
        lyrics_prefer_apple: defaults.lyrics_prefer_apple,
      })}>Reset</button>
    </footer>
  </div>;
}

export function LyricsLibrary({ notice }: { notice: (message: string) => void }) {
  const [entries, setEntries] = useState<TransferLyrics[]>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    async function update() {
      try {
        const items = await listLocalLyrics();
        if (active) { setEntries(items); setFailed(false); }
      } catch {
        if (active) setFailed(true);
      }
    }
    window.addEventListener(lyricsChanged, update);
    void update();
    return () => { active = false; window.removeEventListener(lyricsChanged, update); };
  }, []);
  return entries?.length && !failed ? <ul className="settings-source-cards" aria-label="Imported lyrics">
    {entries.map((entry) => <li className="settings-source-card" key={entry.uri}>
      <span className="settings-source-summary"><strong>{entry.name || entry.uri}</strong>{entry.artists && <span>{entry.artists}</span>}</span>
      <div className="settings-source-actions">
        <button type="button" className="pill outline" onClick={() => downloadTtml(entry)}>Download</button>
        <button type="button" className="pill outline" onClick={() => {
          void removeLocalLyrics(entry.uri).then(() => notice("Removed saved lyrics."), () => notice("Could not remove saved lyrics."));
        }}>Remove</button>
      </div>
    </li>)}
  </ul> : <p className="settings-submenu-empty" role="status">
    {failed ? "Couldn’t read saved lyrics." : entries ? "No imported lyrics." : "Loading saved lyrics…"}
  </p>;
}
