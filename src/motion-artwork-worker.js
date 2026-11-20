// Load the single-threaded core only on clients that need the codec fallback.
const coreUrl = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js";
const maxInput = 24 * 1024 * 1024;

async function download(url) {
  const response = await fetch(url, { credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
  if (!response.ok || !response.body || Number(response.headers.get("Content-Length")) > maxInput) {
    throw new Error("Apple Music cover is unavailable");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxInput) {
        await reader.cancel();
        throw new Error("Apple Music cover is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

self.onmessage = async ({ data: input }) => {
  try {
    const wasmURL = coreUrl.replace(/\.js$/, ".wasm");
    const [{ default: createFFmpegCore }, mp4] = await Promise.all([import(coreUrl), download(input)]);
    const ffmpeg = await createFFmpegCore({
      mainScriptUrlOrBlob: `${coreUrl}#${btoa(JSON.stringify({ wasmURL }))}`,
    });
    ffmpeg.FS.writeFile("cover.mp4", mp4);
    ffmpeg.exec(
      "-loglevel", "error", "-protocol_whitelist", "file", "-threads", "1",
      "-f", "mov", "-i", "cover.mp4", "-map", "0:v:0", "-an", "-sn", "-dn", "-t", "60",
      "-pix_fmt", "yuv420p",
      "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-threads", "1",
      "-crf", "10", "-b:v", "6M", "cover.webm",
    );
    if (ffmpeg.ret !== 0) throw new Error("Could not convert Apple Music cover to WebM");
    const output = ffmpeg.FS.readFile("cover.webm");
    self.postMessage(output, [output.buffer]);
  } catch (error) {
    console.debug("[Lyssna Lyrics] Motion cover conversion failed", error);
    self.postMessage(null);
  }
};
