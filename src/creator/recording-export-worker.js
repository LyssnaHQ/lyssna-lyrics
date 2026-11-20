const coreUrl = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js";

async function vorbisPicture({ blob, type }) {
  const image = await createImageBitmap(blob).catch(() => undefined);
  const mime = new TextEncoder().encode(type);
  const header = new DataView(new ArrayBuffer(32 + mime.length));
  header.setUint32(0, 3); // Front cover.
  header.setUint32(4, mime.length);
  new Uint8Array(header.buffer).set(mime, 8);
  header.setUint32(12 + mime.length, image?.width ?? 0);
  header.setUint32(16 + mime.length, image?.height ?? 0);
  header.setUint32(28 + mime.length, blob.size);
  image?.close();
  const encoded = new FileReaderSync().readAsDataURL(new Blob([header.buffer, blob], { type: "application/octet-stream" }));
  return encoded.slice(encoded.indexOf(",") + 1);
}

self.onmessage = async ({ data: { wav, format, tags = [], cover } }) => {
  try {
    const wasmURL = coreUrl.replace(/\.js$/, ".wasm");
    const { default: createFFmpegCore } = await import(coreUrl);
    const ffmpeg = await createFFmpegCore({
      mainScriptUrlOrBlob: `${coreUrl}#${btoa(JSON.stringify({ wasmURL }))}`,
    });
    const pcm = new Uint8Array(await wav.arrayBuffer());
    const sampleFormat = new DataView(pcm.buffer).getUint16(34, true) === 24 ? "s32" : "s16";
    ffmpeg.FS.writeFile("recording.wav", pcm);
    const inputs = ["-f", "wav", "-i", "recording.wav"];
    const streams = ["-map", "0:a:0"];
    if (cover && format === "flac") {
      const file = cover.type === "image/png" ? "cover.png" : "cover.jpg";
      ffmpeg.FS.writeFile(file, new Uint8Array(await cover.blob.arrayBuffer()));
      inputs.push("-i", file);
      streams.push("-map", "1:v:0", "-c:v", "copy", "-disposition:v:0", "attached_pic",
        "-metadata:s:v:0", "comment=Cover (front)");
    }
    if (cover && format === "ogg") tags.push({ name: "METADATA_BLOCK_PICTURE", value: await vorbisPicture(cover) });
    const codecs = {
      flac: ["-c:a", "flac", "-sample_fmt:a", sampleFormat, "-compression_level", "5"],
      mp3: ["-c:a", "libmp3lame", "-q:a", "0", "-id3v2_version", "0"],
      ogg: ["-c:a", "libvorbis", "-q:a", "8"],
    };
    const output = `recording.${format}`;
    ffmpeg.exec("-loglevel", "error", ...inputs, ...streams, ...codecs[format],
      ...tags.flatMap(({ name, value }) => ["-metadata", `${name}=${value}`]), output);
    if (ffmpeg.ret !== 0) throw new Error("Audio encoding failed");
    const encoded = ffmpeg.FS.readFile(output);
    self.postMessage(encoded, [encoded.buffer]);
  } catch {
    self.postMessage(null);
  }
};
