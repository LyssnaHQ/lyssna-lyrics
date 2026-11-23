import { useEffect, useState } from "react";
import { SettingRow } from "../lyssna/setting-row";
import type { Host, TtmlTrack } from "../host";
import { clearMotionArtworkCache, removeMotionArtworkCache } from "../motion-artwork";
import { cachedMotionArtworkBytes, listStoredMotionArtwork, motionArtworkBudget, readStoredMotionArtwork } from "../motion-artwork-storage";
import { stopCreatorCaptures } from "./capture-sessions";
import { clearRecordedAudio, deleteRecording, listRecordedTracks, readStoredRecording, savedAudioBytes } from "./captured-replay";
import { clearLiveSpectrograms, listSpectrogramTracks, savedSpectrogramBytes } from "./spectrum-storage";
import { downloadRecording, downloadStoredFile, recordingExportEnabled, recordingFormats, type RecordingFormat } from "./recording-export";
import { readRecordingMetadata } from "./recording-metadata";
import { exportSpectrogram } from "./spectrogram-export";
import { within } from "./current-lyrics";

const rows = [
  { id: "audio", label: "Saved audio", help: "Recordings saved on this device for playback and export.", bytes: savedAudioBytes, clear: clearRecordedAudio, list: listRecordedTracks, remove: deleteRecording, stopsCapture: true },
  { id: "spectrum", label: "Saved spectrograms", help: "Spectrograms captured from Spotify audio.", bytes: savedSpectrogramBytes, clear: clearLiveSpectrograms, list: listSpectrogramTracks, remove: clearLiveSpectrograms, stopsCapture: true },
  { id: "cover", label: "Animated cover art", help: `Up to ${motionArtworkBudget / 1_000_000_000} GB of animated covers saved on this device for reuse across restarts.`, bytes: cachedMotionArtworkBytes, clear: clearMotionArtworkCache, list: listStoredMotionArtwork, remove: removeMotionArtworkCache, stopsCapture: false },
] as const;

type Cache = (typeof rows)[number];
type CacheId = Cache["id"];
type Entry = { key: string; bytes?: number };
const pageSize = 10;
const units = ["B", "KiB", "MiB", "GiB"];
function formatBytes(bytes: number | null | undefined) {
  if (bytes === undefined) return "Calculating…";
  if (bytes === null) return "Size unavailable";
  const unit = Math.min(Math.floor(Math.log2(Math.max(bytes, 1)) / 10), units.length - 1);
  return `${(bytes / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unit]}`;
}

function StoredDataItem({ host, cache, entry, busy, format, changeFormat, remove, runExport }: {
  host: Host; cache: Cache; entry: Entry; busy: boolean; format: RecordingFormat;
  changeFormat(format: RecordingFormat): void; remove(): void; runExport(job: () => Promise<void>): void;
}) {
  const [details, setDetails] = useState<{ title: string; artists?: string; track?: TtmlTrack }>();
  const [albumId, extension] = entry.key.split(":");
  const trackId = entry.key.split(":").at(-1)!;
  useEffect(() => {
    let active = true;
    if (cache.id === "cover") {
      void within(host.lookupAlbum(`spotify:album:${albumId}`), 4000).then((album) => {
        if (active && album?.name) setDetails({ title: album.name, artists: album.artists?.map(({ name }) => name).join(", ") });
      });
    } else {
      void within(host.lookupTrack(trackId), 4000).then((track) => {
        if (active && track) setDetails({ title: track.name, artists: track.artists.map(({ name }) => name).join(", "), track });
      });
    }
    return () => { active = false; };
  }, [host, cache.id, trackId, albumId]);
  const title = details?.title || (cache.id === "cover" ? `Album ${albumId}` : `Track ${trackId}`);
  const filename = [title, details?.artists].filter(Boolean).join(" - ");
  async function exportItem() {
    if (!recordingExportEnabled()) return;
    if (cache.id === "cover") {
      const art = await readStoredMotionArtwork(entry.key);
      if (!art) throw new Error("This cover is no longer saved.");
      downloadStoredFile(art, filename, extension === "webm" ? "webm" : "mp4");
    } else if (cache.id === "spectrum") {
      downloadStoredFile(await exportSpectrogram(entry.key), `${filename} - Spectrogram`, "png");
    } else {
      const track = details?.track ?? await within(host.lookupTrack(trackId), 4000);
      const audio = await readStoredRecording(entry.key, track?.duration_ms);
      if (!audio) throw new Error("This audio is no longer saved.");
      const firstPartyTrack = host.track();
      const metadata = await readRecordingMetadata(host, firstPartyTrack?.id === trackId ? firstPartyTrack : {
        id: trackId, title: track?.name ?? title, artists: track?.artists.map(({ name }) => name).join(", ") ?? details?.artists ?? "",
        cover: track?.album?.images?.[0]?.url ?? "", album: track?.album?.name, albumUri: track?.album?.uri,
      });
      const name = [metadata.tags.find(({ name }) => name === "TITLE")?.value, metadata.tags.find(({ name }) => name === "ARTIST")?.value]
        .filter(Boolean).join(" - ");
      await downloadRecording(audio.blob, name || filename, format, metadata);
    }
  }
  return <li className="stored-data-item">
    <div><strong>{title}</strong>
      <small>{[details?.artists, cache.id === "cover" ? extension?.toUpperCase() : undefined,
        entry.bytes !== undefined ? formatBytes(entry.bytes) : undefined].filter(Boolean).join(" · ")}</small>
    </div>
    <div className="settings-actions">
      {recordingExportEnabled() && <>
        {cache.id === "audio" && <select aria-label={`Export format for ${title}`} value={format} disabled={busy}
          onChange={(event) => changeFormat(event.target.value as RecordingFormat)}>
          {Object.entries(recordingFormats).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>}
        <button type="button" className="pill outline" disabled={busy} aria-label={`Export ${title}`} onClick={() => runExport(exportItem)}>Export</button>
      </>}
      <button type="button" className="pill outline" disabled={busy} aria-label={`Delete ${title}`} onClick={remove}>Delete</button>
    </div>
  </li>;
}

export function StoredDataSettings({ host, notice }: { host: Host; notice(message: string): void }) {
  const [busy, setBusy] = useState<string>();
  const [sizes, setSizes] = useState<Partial<Record<CacheId, number | null>>>({});
  const [revision, refresh] = useState(0);
  const [selected, setSelected] = useState<Cache>();
  const [entries, setEntries] = useState<Entry[] | null>();
  const [limit, setLimit] = useState(pageSize);
  const [format, setFormat] = useState<RecordingFormat>("flac");
  useEffect(() => {
    let active = true;
    for (const row of rows) {
      void Promise.resolve().then(row.bytes).catch(() => null).then((bytes) => {
        if (active) setSizes((previous) => ({ ...previous, [row.id]: bytes }));
      });
    }
    return () => { active = false; };
  }, [revision]);
  const audioSize = selected?.id === "audio" ? sizes.audio : undefined;
  useEffect(() => {
    if (!selected) return;
    let active = true;
    void selected.list().then(
      (items) => { if (active) setEntries(items); },
      () => { if (active) setEntries(null); },
    );
    return () => { active = false; };
  }, [selected, revision, audioSize]);

  function manage(row: Cache) {
    setEntries(undefined);
    setLimit(pageSize);
    setSelected(selected === row ? undefined : row);
  }

  async function updateStorage(row: Cache, entry?: Entry) {
    setBusy(row.id);
    notice("");
    try {
      if (row.stopsCapture) await stopCreatorCaptures();
      if (entry) await row.remove(entry.key);
      else await row.clear();
      notice(entry ? "Saved item deleted." : `${row.label} cleared.`);
    } catch {
      notice(entry ? "Couldn’t delete the saved item." : `Couldn’t clear ${row.label.toLowerCase()}.`);
    } finally {
      refresh((value) => value + 1);
      setBusy(undefined);
    }
  }

  async function runExport(job: () => Promise<void>) {
    setBusy("export");
    notice("");
    try { await job(); }
    catch (error) { notice(error instanceof Error ? error.message : "Couldn’t export the saved item."); }
    finally { setBusy(undefined); }
  }

  return <>
    <div className="lyrics-settings-group">
    {rows.map((row) => <SettingRow key={row.id} label={row.label} help={row.help}>
      <div className="settings-actions">
        <span className="stored-data-size" aria-live="polite">{formatBytes(sizes[row.id])}</span>
        <button type="button" className="pill outline" aria-expanded={selected === row} disabled={!!busy}
          onClick={() => manage(row)}>{selected === row ? "Hide" : "Manage"}</button>
        <button type="button" className="pill outline" aria-label={`Clear ${row.label.toLowerCase()}`} disabled={!!busy}
          onClick={() => void updateStorage(row)}>{busy === row.id ? "Clearing…" : "Clear"}</button>
      </div>
    </SettingRow>)}
    </div>
    {selected && <section className="stored-data-items" aria-label={selected.label}>
      <h3>{selected.label}</h3>
      {entries?.length ? <>
        <ul>{entries.slice(0, limit).map((entry) => <StoredDataItem key={entry.key} host={host}
          cache={selected} entry={entry} busy={!!busy} format={format} changeFormat={setFormat}
          remove={() => void updateStorage(selected, entry)} runExport={(job) => void runExport(job)} />)}</ul>
        {entries.length > limit && <button type="button" className="pill outline"
          onClick={() => setLimit((value) => value + pageSize)}>Show more ({entries.length - limit})</button>}
      </> : <p role="status">{entries === undefined ? "Loading saved items…" : entries === null ? "Couldn’t list saved items." : "No saved items."}</p>}
    </section>}
  </>;
}
