const coreUrl = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js";

self.onmessage = async ({ data: wav }) => {
  try {
    const wasmURL = coreUrl.replace(/\.js$/, ".wasm");
    const { default: createFFmpegCore } = await import(coreUrl);
    const ffmpeg = await createFFmpegCore({
      mainScriptUrlOrBlob: `${coreUrl}#${btoa(JSON.stringify({ wasmURL }))}`,
    });
    ffmpeg.FS.writeFile("recording.wav", new Uint8Array(await wav.arrayBuffer()));
    ffmpeg.exec("-loglevel", "error", "-f", "wav", "-i", "recording.wav",
      "-c:a", "flac", "-compression_level", "5", "recording.flac");
    if (ffmpeg.ret !== 0) throw new Error("FLAC encoding failed");
    const flac = ffmpeg.FS.readFile("recording.flac");
    self.postMessage(flac, [flac.buffer]);
  } catch {
    self.postMessage(null);
  }
};
