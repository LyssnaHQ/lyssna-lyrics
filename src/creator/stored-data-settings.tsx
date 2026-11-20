import { useEffect, useState } from "react";
import { SettingRow } from "../lyssna/setting-row";
import { cachedMotionArtworkBytes, clearMotionArtworkCache } from "../motion-artwork";
import { stopCreatorCaptures } from "./capture-sessions";
import { clearRecordedAudio, savedAudioBytes } from "./captured-replay";
import { clearLiveSpectrograms, savedSpectrogramBytes } from "./spectrum-storage";

const rows = [
  { label: "Saved audio", help: "Recordings saved on this device for playback and export.", bytes: savedAudioBytes, clear: clearRecordedAudio, stopsCapture: true },
  { label: "Saved spectrograms", help: "Spectrograms captured from Spotify audio.", bytes: savedSpectrogramBytes, clear: clearLiveSpectrograms, stopsCapture: true },
  { label: "Animated cover art", help: "Animated covers Lyssna keeps in memory during this session.", bytes: cachedMotionArtworkBytes, clear: clearMotionArtworkCache, stopsCapture: false },
] as const;

type CacheLabel = (typeof rows)[number]["label"];
const units = ["B", "KiB", "MiB", "GiB"];
function formatBytes(bytes: number | null | undefined) {
  if (bytes === undefined) return "Calculating…";
  if (bytes === null) return "Size unavailable";
  const unit = Math.min(Math.floor(Math.log2(Math.max(bytes, 1)) / 10), units.length - 1);
  return `${(bytes / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unit]}`;
}

export function StoredDataSettings({ notice }: { notice(message: string): void }) {
  const [clearing, setClearing] = useState<CacheLabel>();
  const [sizes, setSizes] = useState<Partial<Record<CacheLabel, number | null>>>({});
  const [revision, refresh] = useState(0);
  useEffect(() => {
    let active = true;
    for (const row of rows) {
      void Promise.resolve().then(row.bytes).catch(() => null).then((bytes) => {
        if (active) setSizes((previous) => ({ ...previous, [row.label]: bytes }));
      });
    }
    return () => { active = false; };
  }, [revision]);

  async function clear(row: (typeof rows)[number]) {
    setClearing(row.label);
    notice("");
    try {
      if (row.stopsCapture) await stopCreatorCaptures();
      await row.clear();
      notice(`${row.label} cleared.`);
    } catch {
      notice(`Couldn’t clear ${row.label.toLowerCase()}.`);
    } finally {
      refresh((value) => value + 1);
      setClearing(undefined);
    }
  }

  return <div className="lyrics-settings-group">
    {rows.map((row) => <SettingRow key={row.label} label={row.label} help={row.help}>
      <div className="settings-actions">
        <span className="stored-data-size" aria-live="polite">{formatBytes(sizes[row.label])}</span>
        <button type="button" className="pill outline" aria-label={`Clear ${row.label.toLowerCase()}`} disabled={!!clearing}
          onClick={() => void clear(row)}>{clearing === row.label ? "Clearing…" : "Clear"}</button>
      </div>
    </SettingRow>)}
  </div>;
}
