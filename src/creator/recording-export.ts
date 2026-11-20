import workerSource from "./flac-export-worker.js?raw";

export const recordingExportKey = "lyssna.ttml-recording-export";

export function recordingExportEnabled() {
  try { return localStorage.getItem(recordingExportKey) === "1"; }
  catch { return false; }
}

function encodeFlac(wav: Blob) {
  return new Promise<Blob>((resolve, reject) => {
    const script = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
    let worker: Worker;
    try { worker = new Worker(script, { type: "module" }); }
    finally { URL.revokeObjectURL(script); }
    const timeout = window.setTimeout(() => finish(), 60_000);
    function finish(data?: Uint8Array<ArrayBuffer> | null) {
      window.clearTimeout(timeout);
      worker.terminate();
      if (data?.length) resolve(new Blob([data], { type: "audio/flac" }));
      else reject(new Error("Couldn’t encode the recording as FLAC."));
    }
    worker.onmessage = ({ data }: MessageEvent<Uint8Array<ArrayBuffer> | null>) => finish(data);
    worker.onerror = () => finish();
    worker.postMessage(wav);
  });
}

export async function downloadRecording(wav: Blob, name: string, format: "wav" | "flac") {
  const blob = format === "flac" ? await encodeFlac(wav) : wav;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim().slice(0, 160) || "Spotify recording"}.${format}`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
