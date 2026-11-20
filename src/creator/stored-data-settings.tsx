import { useState } from "react";
import { SettingRow } from "../lyssna/setting-row";
import { clearMotionArtworkCache } from "../motion-artwork";
import { stopCreatorCaptures } from "./capture-sessions";
import { clearRecordedAudio } from "./captured-replay";
import { clearLiveSpectrograms } from "./spectrum-storage";

const rows = [
  { label: "Saved audio", help: "Recordings saved on this device for playback and export.", clear: clearRecordedAudio, stopsCapture: true },
  { label: "Saved spectrograms", help: "Spectrograms captured from Spotify audio.", clear: clearLiveSpectrograms, stopsCapture: true },
  { label: "Animated cover art", help: "Animated covers cached by Lyssna during this session.", clear: clearMotionArtworkCache, stopsCapture: false },
] as const;

export function StoredDataSettings({ notice }: { notice(message: string): void }) {
  const [clearing, setClearing] = useState<(typeof rows)[number]["label"]>();

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
      setClearing(undefined);
    }
  }

  return <div className="lyrics-settings-group">
    {rows.map((row) => <SettingRow key={row.label} label={row.label} help={row.help}>
      <button type="button" className="pill outline" aria-label={`Clear ${row.label.toLowerCase()}`} disabled={!!clearing}
        onClick={() => void clear(row)}>{clearing === row.label ? "Clearing…" : "Clear"}</button>
    </SettingRow>)}
  </div>;
}
