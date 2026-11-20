// Load the single-threaded core only on clients that need the codec fallback.
const coreUrl = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js";
self.onmessage = async ({ data: input }) => {
  let lastProgress = -1;
  function reportProgress(value) {
    const progress = Math.floor(value);
    if (!Number.isFinite(progress) || progress <= lastProgress) return;
    lastProgress = progress;
    self.postMessage({ progress });
  }

  try {
    const wasmURL = coreUrl.replace(/\.js$/, ".wasm");
    reportProgress(25);
    const { default: createFFmpegCore } = await import(coreUrl);
    const ffmpeg = await createFFmpegCore({
      mainScriptUrlOrBlob: `${coreUrl}#${btoa(JSON.stringify({ wasmURL }))}`,
    });
    ffmpeg.setProgress(({ progress }) => reportProgress(25 + 74 * Math.max(0, Math.min(1, progress))));
    ffmpeg.FS.writeFile("cover.mp4", new Uint8Array(input));
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
