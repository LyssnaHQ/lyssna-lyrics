import workerSource from "./recording-export-worker.js?raw";
import type { RecordingMetadata } from "./recording-metadata";
import { id3Tag, tagWav } from "./recording-tags";

export const recordingExportKey = "lyssna.ttml-recording-export";
export const recordingFormats = { flac: "FLAC", wav: "WAV", mp3: "MP3", ogg: "Ogg Vorbis" } as const;
export type RecordingFormat = keyof typeof recordingFormats;
const mediaTypes = { flac: "audio/flac", mp3: "audio/mpeg", ogg: "audio/ogg" } as const;

export function recordingExportEnabled() {
  try { return localStorage.getItem(recordingExportKey) === "1"; }
  catch { return false; }
}

function encode(wav: Blob, format: Exclude<RecordingFormat, "wav">, metadata: RecordingMetadata) {
  return new Promise<Blob>((resolve, reject) => {
    const script = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
    let worker: Worker;
    try { worker = new Worker(script, { type: "module" }); }
    finally { URL.revokeObjectURL(script); }
    const timeout = window.setTimeout(() => finish(), 60_000);
    function finish(data?: Uint8Array<ArrayBuffer> | null) {
      window.clearTimeout(timeout);
      worker.terminate();
      if (data?.length) resolve(new Blob(format === "mp3" ? [id3Tag(metadata), data] : [data], { type: mediaTypes[format] }));
      else reject(new Error(`Couldn’t encode the recording as ${recordingFormats[format]}.`));
    }
    worker.onmessage = ({ data }: MessageEvent<Uint8Array<ArrayBuffer> | null>) => finish(data);
    worker.onerror = () => finish();
    worker.postMessage({ wav, format, ...(format !== "mp3" && metadata) });
  });
}

export async function downloadRecording(wav: Blob, name: string, format: RecordingFormat, metadata: RecordingMetadata) {
  const blob = format === "wav" ? tagWav(wav, metadata) : await encode(wav, format, metadata);
  downloadStoredFile(blob, name, format);
}

export function downloadStoredFile(blob: Blob, name: string, extension: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim().slice(0, 160) || "Lyssna export"}.${extension}`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
